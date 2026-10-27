import type { LocalDataStore } from '@mnaoumov/obsidian-lib/data-stores/local-data-store';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsEditor } from '../../scripts/helpers/names-module.ts';
import type { IndexStorage } from './index-storage.ts';

interface MeasuredStorage extends IndexStorage {
  readonly opened: null | OpenStores;
}

interface OpenStores {
  readonly connections: readonly LocalDataStore[];
}

interface PersistenceApi {
  readonly getUnlinkedMentionsComponent: () => null | StoredIndex;
  readonly headingTimesIndex: StoredIndex;
  readonly propertyValueIndex: StoredIndex;
}

interface PersistencePlugin {
  readonly pluginApi: PersistenceApi;
  readonly pluginSettingsComponent: PluginSettingsEditor;
}

interface StoredIndex {
  readonly storage: MeasuredStorage;
}

const FILE_COUNT = 35_000;
const TIMEOUT_IN_MILLISECONDS = 600_000;

describe('record storage at large-vault scale', () => {
  it('keeps derived records local and authoritative transport files bounded', async () => {
    const result = await evalInObsidian({
      async callback({ app, FILE_COUNT: count }) {
        const plugin = app.plugins.getPlugin('advanced-metadata-cache') as null | PersistencePlugin;
        if (!plugin) {
          throw new Error('Plugin not loaded');
        }
        await plugin.pluginSettingsComponent.editAndSave((settings) => {
          Object.assign(settings, { isPropertiesModuleEnabled: false, isUnlinkedMentionsModuleEnabled: true });
        });
        const mentions = plugin.pluginApi.getUnlinkedMentionsComponent()?.storage;
        if (!mentions) {
          throw new Error('Unlinked mentions module not available');
        }
        await plugin.pluginSettingsComponent.editAndSave((settings) => {
          settings.isUnlinkedMentionsModuleEnabled = false;
        });
        const headings = plugin.pluginApi.headingTimesIndex.storage;
        const properties = plugin.pluginApi.propertyValueIndex.storage;
        try {
          const paths = Array.from({ length: count }, (_, index) => `Scale/${String(index)}.md`);
          const headingNotes = Object.fromEntries(paths.map((path, index) => [path, {
            headings: [{ bodyHash: String(index), created: index, level: 1, line: 0, modified: index, seen: null, subtreeHash: String(index), text: `Heading ${String(index)}` }],
            mtime: 1
          }]));
          const names = Array.from({ length: 1000 }, (_, index) => `name-${String(index)}`);
          const mentionNotes = Object.fromEntries(paths.map((path, index) => [path, { keys: Array.from({ length: 20 }, (_, offset) => (index + offset) % names.length), mtime: 1, size: 1000 }]));
          await mentions.write(JSON.stringify({ cleanKeys: names.map((_, index) => index), keys: names, notes: mentionNotes, version: 1 }));
          await properties.write(JSON.stringify({ properties: { fixtureTag: Object.fromEntries(paths.map((path) => [path, ['local-only-cache-value']])) }, version: 1 }));
          await headings.write(JSON.stringify({ notes: headingNotes, version: 1 }));
          const mentionsRecords = await mentions.opened?.connections[0]?.entries();
          const propertyRecords = await properties.opened?.connections[0]?.entries();
          const encoder = new TextEncoder();
          const folders = ['Plugin data/advanced-metadata-cache'];
          let journalBytes = 0;
          let largestFileBytes = 0;
          let fileCount = 0;
          let hasDerivedValue = false;
          while (folders.length > 0) {
            const folder = folders.pop();
            if (!folder) {
              continue;
            }
            const listing = await app.vault.adapter.list(folder);
            folders.push(...listing.folders);
            for (const path of listing.files) {
              const text = await app.vault.adapter.read(path);
              const size = encoder.encode(text).byteLength;
              journalBytes += size;
              largestFileBytes = Math.max(largestFileBytes, size);
              fileCount++;
              hasDerivedValue ||= text.includes('local-only-cache-value');
            }
          }
          return {
            fileCount,
            fixtureNotes: count,
            hasDerivedValue,
            journalBytes,
            largestFileBytes,
            mentionsRecordBytes: encoder.encode(JSON.stringify(mentionsRecords)).byteLength,
            propertyRecordBytes: encoder.encode(JSON.stringify(propertyRecords)).byteLength
          };
        } finally {
          await mentions.close?.();
          await properties.close?.();
          await headings.close?.();
          await plugin.pluginSettingsComponent.editAndSave((settings) => {
            Object.assign(settings, { isPropertiesModuleEnabled: true });
          });
        }
      },
      input: { FILE_COUNT },
      vaultPath: getTemporaryVault().path
    });
    console.warn('Synthetic 35k-note storage bytes (local records are serialized logical sizes, excluding IndexedDB overhead):', result);
    expect(result.fixtureNotes).toBe(FILE_COUNT);
    expect(result.hasDerivedValue).toBe(false);
    expect(result.largestFileBytes).toBeLessThanOrEqual(1_000_000);
    expect(result.journalBytes).toBeGreaterThan(0);
    expect(result.mentionsRecordBytes).toBeGreaterThan(0);
    expect(result.propertyRecordBytes).toBeGreaterThan(0);
  }, TIMEOUT_IN_MILLISECONDS);
});
