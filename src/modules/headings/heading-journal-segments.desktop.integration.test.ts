/**
 * @file
 *
 * A burst of heading edits with **Sync between devices** on rewrites this device's open journal segment and
 * creates no new `log-<n>` file per save. Before `@mnaoumov/obsidian-lib` 11 every save created a file,
 * each one a vault event (issue #1), so this pins the fix in a real Obsidian.
 *
 * Each edit waits until the index is clean again and the journal changed on disk, so every edit is its own
 * save. It runs in its own `evalInObsidian` call, because a save can wait out the 5 s debounce and the
 * transport caps how long one command may hold `Runtime.evaluate` open.
 */
import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

import type { PluginDataSync } from '../../persistence/plugin-data-sync.ts';

import { applyPluginSettings } from '../../../scripts/helpers/names-module.ts';

interface HeadingApiPersistence {
  readonly headingTimesIndex: HeadingIndexState;
}

interface HeadingIndexState {
  readonly isDirty: boolean;
}

/**
 * This device's journal segment files, and a signature of their sizes and modification times.
 */
interface JournalListing {
  readonly logFiles: string[];
  readonly signature: string;
}

/**
 * What one edit left on disk.
 */
interface SaveResult {
  readonly error: null | string;
  readonly logFiles: string[];
  readonly signature: string;
}

interface SyncPlugin {
  readonly pluginApi: HeadingApiPersistence;
  readonly pluginDataSync: PluginDataSync;
}

interface SyncSwitchResult {
  readonly error: null | string;
  readonly wasSyncEnabled: boolean;
}

const NOTE_PATH = 'heading-journal-segments.md';
const EDIT_COUNT = 4;
const STORE_ID = 'heading-observations-v1';
// One save waits out the 5 s non-resetting debounce; the rest is slack for a loaded machine.
const SAVE_WAIT_IN_MS = 12_000;
const POLL_IN_MS = 200;
const SCENARIO_TIMEOUT_IN_MS = 180_000;

describe('Headings module with sync between devices on', () => {
  let wasSyncEnabled = false;

  beforeAll(async () => {
    const settingsResult = await applyPluginSettings({ isHeadingsModuleEnabled: true });
    expect(settingsResult.error).toBeNull();
    const syncResult = await setSyncEnabled(true);
    expect(syncResult.error).toBeNull();
    wasSyncEnabled = syncResult.wasSyncEnabled;
  }, SCENARIO_TIMEOUT_IN_MS);

  afterAll(async () => {
    // The vault is shared with every other suite in this project, and both switches are off by default.
    await setSyncEnabled(wasSyncEnabled);
    await applyPluginSettings({ isHeadingsModuleEnabled: false });
  }, SCENARIO_TIMEOUT_IN_MS);

  it('rewrites the open journal segment on every save instead of creating a file per save', async () => {
    const saves: SaveResult[] = [];
    let signature = '';

    for (let index = 0; index < EDIT_COUNT; index++) {
      const result = await editAndWaitForSave(index, signature);
      expect(result.error).toBeNull();
      saves.push(result);
      signature = result.signature;
    }

    const [first, ...rest] = saves;
    expect(first?.logFiles.length).toBeGreaterThan(0);

    for (const save of rest) {
      expect(save.logFiles).toEqual(first?.logFiles);
    }
  }, SCENARIO_TIMEOUT_IN_MS);
});

/**
 * Writes the note with one more heading and waits until this device's journal changes on disk.
 *
 * @param index - Which edit of the burst this is.
 * @param previousSignature - The journal's signature after the previous save, or empty before the first.
 * @returns The journal segment files after the save, and their new signature.
 */
async function editAndWaitForSave(index: number, previousSignature: string): Promise<SaveResult> {
  return evalInObsidian({
    async callback({
      app,
      INDEX: editIndex,
      lib: { waitUntil },
      NOTE_PATH: notePath,
      POLL_IN_MS: pollMs,
      PREVIOUS_SIGNATURE: previous,
      SAVE_WAIT_IN_MS: saveWaitMs,
      STORE_ID: storeId
    }) {
      const plugin = app.plugins.getPlugin('advanced-metadata-cache') as null | SyncPlugin;

      if (!plugin) {
        return { error: 'Plugin not loaded', logFiles: [], signature: '' };
      }

      const root = `${plugin.pluginDataSync.anchorFolder}/advanced-metadata-cache/${storeId}`;

      async function listLogFiles(): Promise<JournalListing> {
        const entries: string[] = [];
        const logFiles: string[] = [];
        const folders = [root];

        while (folders.length > 0) {
          const folder = folders.pop() ?? '';

          if (!await app.vault.adapter.exists(folder)) {
            continue;
          }

          const listing = await app.vault.adapter.list(folder);
          folders.push(...listing.folders);

          for (const file of listing.files) {
            if (!/\/log-\d+\.(?:md|json)$/.test(file)) {
              continue;
            }

            const stat = await app.vault.adapter.stat(file);
            logFiles.push(file);
            entries.push(`${file}:${String(stat?.size)}:${String(stat?.mtime)}`);
          }
        }

        return { logFiles: logFiles.sort(), signature: entries.sort().join('\n') };
      }

      try {
        const headings = Array.from({ length: editIndex + 2 }, (_, headingIndex) => `# Heading ${String(headingIndex)}\nbody ${String(headingIndex)}\n`);
        const content = headings.join('\n');
        const existing = app.vault.getFileByPath(notePath);

        if (existing) {
          await app.vault.modify(existing, content);
        } else {
          await app.vault.create(notePath, content);
        }

        // Wait for the edit to mark the index dirty, so the save waited on below is the one this edit asked for.
        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: `edit ${String(editIndex)} to reach the heading index`,
          predicate: () => plugin.pluginApi.headingTimesIndex.isDirty,
          timeoutInMilliseconds: saveWaitMs
        });
        let current = await listLogFiles();
        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: `the heading journal under ${root} to change after edit ${String(editIndex)}`,
          predicate: async () => {
            if (plugin.pluginApi.headingTimesIndex.isDirty) {
              return false;
            }
            current = await listLogFiles();
            return current.logFiles.length > 0 && current.signature !== previous;
          },
          timeoutInMilliseconds: saveWaitMs
        });

        return { error: null, ...current };
      } catch (error) {
        return { error: String(error), logFiles: [], signature: '' };
      }
    },
    input: {
      INDEX: index,
      NOTE_PATH,
      POLL_IN_MS,
      PREVIOUS_SIGNATURE: previousSignature,
      SAVE_WAIT_IN_MS,
      STORE_ID
    },
    vaultPath: getTemporaryVault().path
  });
}

/**
 * Turns sync between devices on or off for this device.
 *
 * @param isEnabled - Whether sync should be on.
 * @returns Whether sync was on before, and what went wrong, or `null`.
 */
async function setSyncEnabled(isEnabled: boolean): Promise<SyncSwitchResult> {
  return evalInObsidian({
    async callback({ app, IS_ENABLED: shouldEnable }) {
      const plugin = app.plugins.getPlugin('advanced-metadata-cache') as null | SyncPlugin;

      if (!plugin) {
        return { error: 'Plugin not loaded', wasSyncEnabled: false };
      }

      const sync = plugin.pluginDataSync;
      await sync.ensureLoaded();
      const wasEnabled = sync.isSyncEnabled;
      await sync.setSyncEnabled(shouldEnable);
      return { error: null, wasSyncEnabled: wasEnabled };
    },
    input: { IS_ENABLED: isEnabled },
    vaultPath: getTemporaryVault().path
  });
}
