/**
 * Android's harness can lose its WebView before layout readiness on OIT 17.7.0; that startup failure
 * precedes this scenario. Manual fallback: enable both modules, create/edit/rename a heading note,
 * restart the modules and sync the vault to a second device; creation times and registrations must
 * survive, derived values must rebuild locally, and legacy files must disappear without note edits.
 */
import type {
  App,
  Vault
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsEditor } from '../../scripts/helpers/names-module.ts';
import type { HeadingTimes } from '../plugin-api.ts';
import type { IndexStorage } from './index-storage.ts';

interface PersistenceApi {
  readonly getHeadingTimes: (path: string) => HeadingTimes[];
  readonly getPathsByPropertyValueSafe: (name: string, value: string) => Promise<null | string[]>;
  readonly headingTimesIndex: StorageOwner;
  readonly propertyValueIndex: StorageOwner;
}

interface PersistencePlugin {
  readonly manifest: PluginFolder;
  readonly pluginApi: PersistenceApi;
  readonly pluginSettingsComponent: PluginSettingsEditor;
}

interface PluginFolder {
  // eslint-disable-next-line unicorn/name-replacements -- Obsidian PluginManifest uses this member name.
  readonly dir?: string;
}

interface StorageApp {
  readonly appId: App['appId'];
  readonly vault: Vault;
}

type StorageConstructor = new (params: StorageConstructorParams) => IndexStorage;

interface StorageConstructorParams {
  readonly app: StorageApp;
  readonly getLegacyPath: () => string;
  readonly kind: 'headings' | 'properties';
  readonly pluginId: string;
}

interface StorageOwner {
  readonly storage: IndexStorage;
}

const TIMEOUT_IN_MILLISECONDS = 120_000;

describe('legacy persistence migration', () => {
  it('migrates without changing notes and makes authoritative state available in a second local replica', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil } }) {
        const plugin = app.plugins.getPlugin('advanced-metadata-cache') as null | PersistencePlugin;
        if (!plugin?.manifest.dir) {
          throw new Error('Plugin not loaded');
        }
        const api = plugin.pluginApi;
        await plugin.pluginSettingsComponent.editAndSave((settings) => {
          Object.assign(settings, { isHeadingsModuleEnabled: false, isPropertiesModuleEnabled: false });
        });
        await api.headingTimesIndex.storage.close?.();
        await api.propertyValueIndex.storage.close?.();
        const content = '---\nlegacyProperty: current\n---\n# Legacy heading\nbody\n';
        const note = await app.vault.create('legacy-migration.md', content);
        await waitUntil({ predicate: () => app.metadataCache.getFileCache(note)?.headings?.length === 1, timeoutInMilliseconds: 5000 });
        const headingPath = `${plugin.manifest.dir}/heading-times.json`;
        const propertyPath = `${plugin.manifest.dir}/property-values.json`;
        await app.vault.adapter.write(
          headingPath,
          JSON.stringify({
            notes: {
              [note.path]: {
                headings: [{ bodyHash: 'legacy', created: 111, level: 1, line: 3, modified: 222, seen: 333, subtreeHash: 'legacy', text: 'Legacy heading' }],
                mtime: note.stat.mtime
              }
            },
            version: 1
          })
        );
        await app.vault.adapter.write(propertyPath, JSON.stringify({ properties: { legacyProperty: { [note.path]: ['stale'] } }, version: 1 }));
        await plugin.pluginSettingsComponent.editAndSave((settings) => {
          Object.assign(settings, { isHeadingsModuleEnabled: true, isPropertiesModuleEnabled: true });
        });
        await waitUntil({ predicate: () => api.getHeadingTimes(note.path)[0]?.created === 111, timeoutInMilliseconds: 5000 });
        const paths = await api.getPathsByPropertyValueSafe('legacyProperty', 'current');
        const isSourceRemoved = !await app.vault.adapter.exists(headingPath) && !await app.vault.adapter.exists(propertyPath);
        const isNoteUnchanged = await app.vault.read(note) === content;
        const HeadingStorage = api.headingTimesIndex.storage.constructor as StorageConstructor;
        const PropertyStorage = api.propertyValueIndex.storage.constructor as StorageConstructor;
        const secondApp = { appId: `${app.appId}-second-device`, vault: app.vault };
        const headings = new HeadingStorage({ app: secondApp, getLegacyPath: (): string => 'no-legacy-headings.json', kind: 'headings', pluginId: 'advanced-metadata-cache' });
        const properties = new PropertyStorage({ app: secondApp, getLegacyPath: (): string => 'no-legacy-properties.json', kind: 'properties', pluginId: 'advanced-metadata-cache' });
        try {
          return { headingReplica: await headings.read(), noteUnchanged: isNoteUnchanged, paths, propertyReplica: await properties.read(), sourceRemoved: isSourceRemoved };
        } finally {
          await headings.close?.();
          await properties.close?.();
          await plugin.pluginSettingsComponent.editAndSave((settings) => {
            Object.assign(settings, { isHeadingsModuleEnabled: false });
          });
        }
      },
      vaultPath: getTemporaryVault().path
    });
    expect(result.sourceRemoved).toBe(true);
    expect(result.noteUnchanged).toBe(true);
    expect(result.paths).toEqual(['legacy-migration.md']);
    expect(JSON.parse(result.headingReplica ?? 'null')).toMatchObject({ notes: { 'legacy-migration.md': { headings: [{ created: 111, modified: 222, seen: 333 }] } } });
    expect(JSON.parse(result.propertyReplica ?? 'null')).toMatchObject({ properties: { legacyProperty: {} } });
  }, TIMEOUT_IN_MILLISECONDS);
});
