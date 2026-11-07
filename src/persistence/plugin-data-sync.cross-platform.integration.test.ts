import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginDataSync } from './plugin-data-sync.ts';

interface PersistenceApi {
  readonly getPathsByPropertyValueSafe: (name: string, value: string) => Promise<null | string[]>;
}

interface SyncPlugin {
  readonly pluginApi: PersistenceApi;
  readonly pluginDataSync: PluginDataSync;
}

const NOTE_PATH = 'sync-switch.md';
const TIMEOUT_IN_MILLISECONDS = 120_000;

describe('sync between devices', () => {
  it('writes nothing to the vault until this device turns sync on, then explains and excludes it, and stops on turning it off', async () => {
    const vaultPath = getTemporaryVault().path;
    const before = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, NOTE_PATH: notePath }) {
        const plugin = app.plugins.getPlugin('advanced-metadata-cache') as null | SyncPlugin;
        if (!plugin) {
          throw new Error('Plugin not loaded');
        }
        const sync = plugin.pluginDataSync;
        await sync.ensureLoaded();
        const wasSyncEnabled = sync.isSyncEnabled;
        if (wasSyncEnabled) {
          await sync.setSyncEnabled(false);
        }
        // Another suite in the same vault may already have synced, so compare what is there before and after.
        async function listFiles(): Promise<string[]> {
          const files: string[] = [];
          const folders = [sync.anchorFolder];
          while (folders.length > 0) {
            const folder = folders.pop() ?? '';
            if (!await app.vault.adapter.exists(folder)) {
              continue;
            }
            const listing = await app.vault.adapter.list(folder);
            files.push(...listing.files);
            folders.push(...listing.folders);
          }
          return files.sort();
        }
        const filesBefore = await listFiles();
        // A date property is registered automatically, which is what used to create the folder in every vault.
        await app.vault.create(notePath, '---\ndate: 2026-11-07\n---\n');
        await waitUntil({
          predicate: async () => {
            const paths = await plugin.pluginApi.getPathsByPropertyValueSafe('date', '2026-11-07');
            return paths?.includes(notePath) === true;
          },
          timeoutInMilliseconds: 10_000
        });
        const filesAfter = await listFiles();
        await sync.setSyncEnabled(true);
        return { filesAfter, filesBefore, folder: sync.anchorFolder, wasSyncEnabled };
      },
      input: { NOTE_PATH },
      vaultPath
    });

    const after = await evalInObsidian({
      async callback({ app, folder: anchorFolder, lib: { waitUntil }, NOTE_PATH: notePath, wasSyncEnabled: shouldRestoreSync }) {
        const plugin = app.plugins.getPlugin('advanced-metadata-cache') as null | SyncPlugin;
        if (!plugin) {
          throw new Error('Plugin not loaded');
        }
        const sync = plugin.pluginDataSync;
        const ownFolder = `${anchorFolder}/advanced-metadata-cache`;
        function getFilters(): string[] {
          return app.vault.getConfig('userIgnoreFilters') ?? [];
        }
        try {
          await waitUntil({
            predicate: async () => await app.vault.adapter.exists(`${ownFolder}/README.md`) && getFilters().includes(`${anchorFolder}/`),
            timeoutInMilliseconds: 10_000
          });
          const ownReadme = await app.vault.adapter.read(`${ownFolder}/README.md`);
          const sharedReadme = await app.vault.adapter.read(`${anchorFolder}/README.md`);
          const hasPropertyJournal = await app.vault.adapter.exists(`${ownFolder}/property-names-v1`);

          await sync.setSyncEnabled(false);
          await waitUntil({ predicate: () => !getFilters().includes(`${anchorFolder}/`), timeoutInMilliseconds: 5000 });
          const isKeptAfterOff = await app.vault.adapter.exists(`${ownFolder}/property-names-v1`);
          return { hasPropertyJournal, isKeptAfterOff, ownReadme, sharedReadme };
        } finally {
          const note = app.vault.getFileByPath(notePath);
          if (note) {
            await app.fileManager.trashFile(note);
          }
          await sync.setSyncEnabled(shouldRestoreSync);
        }
      },
      input: { folder: before.folder, NOTE_PATH, wasSyncEnabled: before.wasSyncEnabled },
      vaultPath
    });

    expect(before.filesAfter).toEqual(before.filesBefore);
    expect(after.hasPropertyJournal).toBe(true);
    expect(after.ownReadme).toContain('do not remove');
    expect(after.sharedReadme).toContain('do not remove');
    // Turning sync off deletes nothing: the devices that still sync keep reading the folder.
    expect(after.isKeptAfterOff).toBe(true);
  }, TIMEOUT_IN_MILLISECONDS);
});
