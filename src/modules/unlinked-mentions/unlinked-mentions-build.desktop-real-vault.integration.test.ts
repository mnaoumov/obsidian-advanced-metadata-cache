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
 * performance vault's empty filler notes cannot say. Opt-in: `integration-tests:real-vault` copies the notes of the
 * vault named by `AMC_REAL_VAULT_PATH`, and this suite prints the numbers the demo vault's 09 Unlinked mentions note quotes.
 *
 * Three timings, each to the first answer of `getUnlinkedMentions`, which waits for the build:
 *
 * - `readAllMs`: `cachedRead` of every note in the module's own batches, the floor of a build that reads them all.
 * - `coldBuildMs`: the module switched on for the first time.
 * - `warmBuildMs`: switched off, which saves `unlinked-mentions.json`, and on again, which is what the next start of
 *   Obsidian pays.
 *
 * The work runs in the background of the page and is POLLED from Node: one `evalInObsidian` holding a multi-minute
 * build would be past the transport's per-command cap.
 */

interface BuildTimings {
  readonly coldBuildMs: number;
  readonly error: null | string;
  readonly fileCount: number;
  readonly readAllMs: number;
  readonly savedBytes: number;
  readonly totalBytes: number;
  readonly warmBuildMs: number;
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

const PLUGIN_ID = 'advanced-metadata-cache';
const READ_BATCH_SIZE = 20;
const SAVE_SETTLE_IN_MS = 10_000;
const POLL_IN_MS = 2000;
const SCAN_WAIT_IN_MS = 1_800_000;
const BUILD_WAIT_IN_MS = 1_800_000;
const STABLE_POLLS_REQUIRED = 3;
const SCENARIO_TIMEOUT_IN_MS = 3_600_000;

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
      callback({ app, PLUGIN_ID: pluginId, READ_BATCH_SIZE: readBatchSize, SAVE_SETTLE_IN_MS: saveSettleMs }) {
        const holder = window as TimingsHolder;
        delete holder.__amcRealVaultTimings;
        // Kept, not awaited: the run outlasts this eval, and the polls below read what it leaves behind.
        holder.__amcRealVaultRun = run();

        async function run(): Promise<void> {
          const emptyTimings = { coldBuildMs: 0, fileCount: 0, readAllMs: 0, savedBytes: 0, totalBytes: 0, warmBuildMs: 0 };
          try {
            const plugin = app.plugins.getPlugin(pluginId) as null | SettingsEditorPlugin;
            const files = app.vault.getMarkdownFiles();
            const target = files[0];
            const dataFilePath = `${app.vault.configDir}/plugins/${pluginId}/unlinked-mentions.json`;
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

            const coldBuildMs = await timeBuild();
            // Switching off saves the index; the wait lets that write land, as it has by the next start of Obsidian.
            await setEnabled(false);
            await sleep(saveSettleMs);
            const savedStat = await app.vault.adapter.stat(dataFilePath);
            const savedBytes = savedStat?.size ?? 0;
            const warmBuildMs = await timeBuild();
            await setEnabled(false);

            holder.__amcRealVaultTimings = { coldBuildMs, error: null, fileCount: files.length, readAllMs, savedBytes, totalBytes, warmBuildMs };

            async function setEnabled(isEnabled: boolean): Promise<void> {
              await plugin?.pluginSettingsComponent.editAndSave((settings) => {
                settings.isUnlinkedMentionsModuleEnabled = isEnabled;
              });
            }

            async function timeBuild(): Promise<number> {
              await setEnabled(true);
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
      input: { PLUGIN_ID, READ_BATCH_SIZE, SAVE_SETTLE_IN_MS },
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

    console.warn('[unlinked mentions build on a real vault]', {
      coldBuildMs: timings?.coldBuildMs.toFixed(0),
      fileCount: timings?.fileCount,
      readAllMs: timings?.readAllMs.toFixed(0),
      savedMegabytes: ((timings?.savedBytes ?? 0) / 1024 / 1024).toFixed(1),
      totalMegabytes: ((timings?.totalBytes ?? 0) / 1024 / 1024).toFixed(1),
      warmBuildMs: timings?.warmBuildMs.toFixed(0)
    });

    expect(timings?.error).toBeNull();
  }, SCENARIO_TIMEOUT_IN_MS);
});
