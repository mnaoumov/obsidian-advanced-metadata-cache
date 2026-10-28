import type { LocalDataStore } from '@mnaoumov/obsidian-lib/data-stores/local-data-store';

import {
  evalInObsidian,
  pollInObsidian
} from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { SettingsEditorPlugin } from '../../../scripts/helpers/names-module.ts';
import type { PluginApiRegistryHolder } from '../../../scripts/helpers/plugin-api-registry.ts';

/*
 * What the `Unlinked mentions` module costs to build on a vault whose notes hold real text, which the generated
 * performance vault's filler notes cannot say. Opt-in: `integration-tests:real-vault` (desktop) and
 * `integration-tests:android-real-vault` copy the notes of the vault named by `AMC_REAL_VAULT_PATH`, and this suite
 * prints the numbers the demo vault's 09 Unlinked mentions note quotes.
 *
 * - `readAllMs`: `cachedRead` of every note in the module's own batch size, the floor of a build that reads them all.
 *   It runs FIRST, so every timing after it is taken with the notes already read once (OS file cache warm).
 * - `cold`: the module switched on for the first time, with no saved records. `buildMs` is switch-on to the end of the
 *   build (what `isBuilt` waits for), `firstQueryMs` the first `getUnlinkedMentions` answer after it, and `saveMs` /
 *   `savedPayloadBytes` the IndexedDB commit the switch-off makes, from the call to its transaction's completion.
 * - `savedRecordBytes`: the records read back, serialized; logical bytes, not the physical database size.
 * - `warm`: switched on again, which is what the next start of Obsidian pays. `readSavedMs` is the read of the saved
 *   records inside that build.
 *
 * The work runs in the background of the page and is POLLED from Node: one `evalInObsidian` holding a multi-minute
 * build would be past the transport's per-command cap.
 */

interface BuildTimings {
  readonly cold: ColdTimings;
  readonly error: null | string;
  readonly fileCount: number;
  readonly readAllMs: number;
  readonly savedRecordBytes: number;
  readonly totalBytes: number;
  readonly warm: WarmTimings;
}
interface CacheApi {
  readonly getUnlinkedMentionsComponent: () => CacheOwner | null;
}
interface CacheConnections {
  readonly connections: readonly LocalDataStore[];
}
interface CacheOwner {
  readonly ensureBuilt: () => Promise<void>;
  readonly storage: CacheStorage;
}
interface CachePlugin extends SettingsEditorPlugin {
  readonly pluginApi: CacheApi;
}
interface CacheStorage {
  readonly close: () => Promise<void>;
  readonly opened: CacheConnections | null;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The benchmark wraps the storage's own methods to time them.
  read: () => Promise<null | string>;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The benchmark wraps the storage's own methods to time them.
  write: (json: string) => Promise<void>;
}
interface ColdTimings {
  readonly buildMs: number;
  readonly firstQueryMs: number;
  readonly savedPayloadBytes: number;
  readonly saveMs: number;
}
interface TimingsHolder {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The benchmark replaces and clears its shared run state.
  __amcRealVaultRun?: Promise<void>;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The benchmark replaces and clears its shared run state.
  __amcRealVaultTimings?: BuildTimings;
}
interface VaultScanStatus {
  readonly fileCount: number;
  readonly isCacheSettled: boolean;
}
interface WarmTimings {
  readonly buildMs: number;
  readonly firstQueryMs: number;
  readonly readSavedMs: number;
}

const PLUGIN_ID = 'advanced-metadata-cache';
const READ_BATCH_SIZE = 20;
const POLL_IN_MS = 2000;
const SCAN_WAIT_IN_MS = 1_800_000;
const BUILD_WAIT_IN_MS = 3_600_000;
const STABLE_POLLS_REQUIRED = 3;
const SCENARIO_TIMEOUT_IN_MS = 7_200_000;

describe('the unlinked mentions module on a real vault', () => {
  it('prints what its build costs, cold and warm', async () => {
    const vaultPath = getTemporaryVault().path;

    let previousFileCount = -1;
    let stablePolls = 0;
    await pollInObsidian({
      intervalInMilliseconds: POLL_IN_MS,
      poll({ app }): VaultScanStatus {
        return { fileCount: app.vault.getFiles().length, isCacheSettled: app.metadataCache.inProgressTaskCount === 0 };
      },
      timeoutInMilliseconds: SCAN_WAIT_IN_MS,
      timeoutMessage: 'the real vault to finish its startup scan',
      until(status: VaultScanStatus): boolean {
        stablePolls = status.fileCount > 0 && status.fileCount === previousFileCount ? stablePolls + 1 : 0;
        previousFileCount = status.fileCount;
        return stablePolls >= STABLE_POLLS_REQUIRED && status.isCacheSettled;
      },
      vaultPath
    });

    await evalInObsidian({
      callback({ app, PLUGIN_ID: pluginId, READ_BATCH_SIZE: readBatchSize }) {
        const holder = window as TimingsHolder;
        delete holder.__amcRealVaultTimings;
        // Kept, not awaited: the run outlasts this eval, and the polls below read what it leaves behind.
        holder.__amcRealVaultRun = run();

        async function run(): Promise<void> {
          const emptyTimings = {
            cold: { buildMs: 0, firstQueryMs: 0, savedPayloadBytes: 0, saveMs: 0 },
            fileCount: 0,
            readAllMs: 0,
            savedRecordBytes: 0,
            totalBytes: 0,
            warm: { buildMs: 0, firstQueryMs: 0, readSavedMs: 0 }
          };
          try {
            const plugin = app.plugins.getPlugin(pluginId) as CachePlugin | null;
            const files = app.vault.getMarkdownFiles();
            const target = files[0];

            if (!plugin || !target) {
              holder.__amcRealVaultTimings = { ...emptyTimings, error: 'Plugin or notes missing' };
              return;
            }

            let totalBytes = 0;
            const readStart = performance.now();
            for (let start = 0; start < files.length; start += readBatchSize) {
              const contents = await Promise.all(files.slice(start, start + readBatchSize).map(async (file) => await app.vault.cachedRead(file)));
              totalBytes += contents.reduce((sum, content) => sum + content.length, 0);
            }
            const readAllMs = performance.now() - readStart;

            const coldStart = performance.now();
            const coldOwner = await switchOn();
            const writes: Promise<void>[] = [];
            let saveMs = 0;
            let savedPayloadBytes = 0;
            const coldStorage = coldOwner.storage;
            const originalWrite = coldStorage.write.bind(coldStorage);
            // Wrapped before the build can save anything: no save runs until the index is built.
            coldStorage.write = async (json: string): Promise<void> => {
              const writeStart = performance.now();
              const write = originalWrite(json);
              writes.push(write);
              await write;
              saveMs = performance.now() - writeStart;
              savedPayloadBytes = new TextEncoder().encode(json).byteLength;
            };
            await coldOwner.ensureBuilt();
            const coldBuildMs = performance.now() - coldStart;
            const coldFirstQueryMs = await timeFirstQuery();

            // Switching off saves the index; every write it started is awaited, so the commit has landed.
            await setEnabled(false);
            await Promise.all(writes);
            await coldOwner.storage.read();
            const savedRecords = await coldOwner.storage.opened?.connections[0]?.entries();
            const savedRecordBytes = new TextEncoder().encode(JSON.stringify(savedRecords)).byteLength;
            await coldOwner.storage.close();

            const warmStart = performance.now();
            const warmOwner = await switchOn();
            let readSavedMs = 0;
            const warmStorage = warmOwner.storage;
            const originalRead = warmStorage.read.bind(warmStorage);
            // The build waits for the metadata cache before it reads, so the read starts after this wrap.
            warmStorage.read = async (): Promise<null | string> => {
              const readSavedStart = performance.now();
              const json = await originalRead();
              readSavedMs = performance.now() - readSavedStart;
              return json;
            };
            await warmOwner.ensureBuilt();
            const warmBuildMs = performance.now() - warmStart;
            const warmFirstQueryMs = await timeFirstQuery();
            await setEnabled(false);

            holder.__amcRealVaultTimings = {
              cold: { buildMs: coldBuildMs, firstQueryMs: coldFirstQueryMs, savedPayloadBytes, saveMs },
              error: null,
              fileCount: files.length,
              readAllMs,
              savedRecordBytes,
              totalBytes,
              warm: { buildMs: warmBuildMs, firstQueryMs: warmFirstQueryMs, readSavedMs }
            };

            async function setEnabled(isEnabled: boolean): Promise<void> {
              await plugin?.pluginSettingsComponent.editAndSave((settings) => {
                settings.isUnlinkedMentionsModuleEnabled = isEnabled;
              });
            }

            async function switchOn(): Promise<CacheOwner> {
              await setEnabled(true);
              const owner = plugin?.pluginApi.getUnlinkedMentionsComponent();
              if (!owner) {
                throw new Error('No unlinked mentions component after switching the module on');
              }
              return owner;
            }

            async function timeFirstQuery(): Promise<number> {
              const records = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records;
              const api = (records?.[pluginId] ?? []).find((record) => !record.isRevoked)?.api;
              if (!api || !target) {
                throw new Error('No live API record');
              }

              const start = performance.now();
              await api.getUnlinkedMentions(target.path);
              return performance.now() - start;
            }
          } catch (error) {
            holder.__amcRealVaultTimings = { ...emptyTimings, error: String(error) };
          }
        }
      },
      input: { PLUGIN_ID, READ_BATCH_SIZE },
      vaultPath
    });

    const timings = await pollInObsidian({
      intervalInMilliseconds: POLL_IN_MS,
      poll(): BuildTimings | null {
        return (window as TimingsHolder).__amcRealVaultTimings ?? null;
      },
      timeoutInMilliseconds: BUILD_WAIT_IN_MS,
      timeoutMessage: 'the unlinked mentions builds to finish',
      until(status: BuildTimings | null): boolean {
        return status !== null;
      },
      vaultPath
    });

    console.warn(
      '[unlinked mentions build on a real vault]',
      JSON.stringify({
        coldBuildMs: timings?.cold.buildMs.toFixed(0),
        coldFirstQueryMs: timings?.cold.firstQueryMs.toFixed(0),
        fileCount: timings?.fileCount,
        readAllMs: timings?.readAllMs.toFixed(0),
        savedPayloadMegabytes: toMegabytes(timings?.cold.savedPayloadBytes),
        savedRecordMegabytes: toMegabytes(timings?.savedRecordBytes),
        saveMs: timings?.cold.saveMs.toFixed(0),
        totalMegabytes: toMegabytes(timings?.totalBytes),
        warmBuildMs: timings?.warm.buildMs.toFixed(0),
        warmFirstQueryMs: timings?.warm.firstQueryMs.toFixed(0),
        warmReadSavedMs: timings?.warm.readSavedMs.toFixed(0)
      })
    );

    expect(timings?.error).toBeNull();
  }, SCENARIO_TIMEOUT_IN_MS);
});

function toMegabytes(bytes: number | undefined): string {
  return ((bytes ?? 0) / 1024 / 1024).toFixed(1);
}
