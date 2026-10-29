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

/*
 * What the `Link texts` module costs to build on a vault whose notes hold real links. Opt-in, like the unlinked mentions
 * suite beside it: `integration-tests:real-vault` copies the notes of the vault named by `AMC_REAL_VAULT_PATH`. Only
 * notes are copied, so a link to an attachment resolves to nothing there and the attachment half is not measured.
 *
 * - `buildMs`: switch-on to the end of the build, what `getLinkTextsSafe` waits for. The best of three, each after
 *   switching the module off, so it is a rebuild over a metadata cache Obsidian has already settled.
 * - `heapDeltaBytes`: `performance.memory.usedJSHeapSize` after the build minus before it, after a forced collection
 *   when the page exposes `gc`; a rough figure, since other work shares the heap.
 * - `jsonBytes`: the index serialized, a stable proxy for its size that does not depend on the collector.
 */

interface BuildTimings {
  readonly buildMs: number[];
  readonly error: null | string;
  readonly fileCount: number;
  readonly heapDeltaBytes: null | number;
  readonly jsonBytes: number;
  readonly sourceCount: number;
  readonly targetCount: number;
  readonly textCount: number;
}
interface BuildWaiter {
  readonly waitForBuild: () => Promise<void>;
}
interface HeapMemory {
  readonly usedJSHeapSize: number;
}
interface IndexInternals {
  readonly bySource: Map<string, unknown>;
  readonly byTarget: Map<string, Map<string, Map<string, number>>>;
}
interface LinkTextsApi {
  readonly getLinkTextIndexComponent: () => BuildWaiter | null;
  readonly linkTextIndex: IndexInternals;
}
interface LinkTextsPlugin extends SettingsEditorPlugin {
  readonly pluginApi: LinkTextsApi;
}
interface MemoryPerformance {
  readonly memory?: HeapMemory;
}
interface TimingsHolder {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The benchmark replaces and clears its shared run state.
  __amcLinkTextsRun?: Promise<void>;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The benchmark replaces and clears its shared run state.
  __amcLinkTextsTimings?: BuildTimings;
  readonly gc?: () => void;
}
interface VaultScanStatus {
  readonly fileCount: number;
  readonly isCacheSettled: boolean;
}

const PLUGIN_ID = 'advanced-metadata-cache';
const BUILD_RUNS = 3;
const POLL_IN_MS = 2000;
const SCAN_WAIT_IN_MS = 1_800_000;
const BUILD_WAIT_IN_MS = 600_000;
const STABLE_POLLS_REQUIRED = 3;
const SCENARIO_TIMEOUT_IN_MS = 3_600_000;

describe('the link texts module on a real vault', () => {
  it('prints what its build costs', async () => {
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
      callback({ app, BUILD_RUNS: buildRuns, PLUGIN_ID: pluginId }) {
        const holder = window as TimingsHolder;
        delete holder.__amcLinkTextsTimings;
        // Kept, not awaited: the run outlasts this eval, and the polls below read what it leaves behind.
        holder.__amcLinkTextsRun = run();

        async function run(): Promise<void> {
          const empty: BuildTimings = { buildMs: [], error: null, fileCount: 0, heapDeltaBytes: null, jsonBytes: 0, sourceCount: 0, targetCount: 0, textCount: 0 };
          try {
            const plugin = app.plugins.getPlugin(pluginId) as LinkTextsPlugin | null;
            if (!plugin) {
              holder.__amcLinkTextsTimings = { ...empty, error: 'Plugin missing' };
              return;
            }

            const buildMs: number[] = [];
            let heapDeltaBytes: null | number = null;

            for (let runIndex = 0; runIndex < buildRuns; runIndex++) {
              await setEnabled(false);
              holder.gc?.();
              const heapBefore = (performance as MemoryPerformance).memory?.usedJSHeapSize;
              const start = performance.now();
              await setEnabled(true);
              await plugin.pluginApi.getLinkTextIndexComponent()?.waitForBuild();
              buildMs.push(performance.now() - start);
              holder.gc?.();
              const heapAfter = (performance as MemoryPerformance).memory?.usedJSHeapSize;
              if (heapBefore !== undefined && heapAfter !== undefined) {
                heapDeltaBytes = heapAfter - heapBefore;
              }
            }

            const index = plugin.pluginApi.linkTextIndex;
            let textCount = 0;
            const serialized: [string, [string, [string, number][]][]][] = [];
            for (const [targetPath, texts] of index.byTarget) {
              textCount += texts.size;
              serialized.push([targetPath, [...texts].map(([text, sources]) => [text, [...sources]])]);
            }

            holder.__amcLinkTextsTimings = {
              buildMs,
              error: null,
              fileCount: app.vault.getMarkdownFiles().length,
              heapDeltaBytes,
              jsonBytes: new TextEncoder().encode(JSON.stringify(serialized)).byteLength,
              sourceCount: index.bySource.size,
              targetCount: index.byTarget.size,
              textCount
            };

            async function setEnabled(isEnabled: boolean): Promise<void> {
              await plugin?.pluginSettingsComponent.editAndSave((settings) => {
                settings.isLinkTextsModuleEnabled = isEnabled;
              });
            }
          } catch (error) {
            holder.__amcLinkTextsTimings = { ...empty, error: String(error) };
          }
        }
      },
      input: { BUILD_RUNS, PLUGIN_ID },
      vaultPath
    });

    const timings = await pollInObsidian({
      intervalInMilliseconds: POLL_IN_MS,
      poll(): BuildTimings | null {
        return (window as TimingsHolder).__amcLinkTextsTimings ?? null;
      },
      timeoutInMilliseconds: BUILD_WAIT_IN_MS,
      timeoutMessage: 'the link texts builds to finish',
      until(status: BuildTimings | null): boolean {
        return status !== null;
      },
      vaultPath
    });

    console.warn(
      '[link texts build on a real vault]',
      JSON.stringify({
        bestBuildMs: Math.min(...timings?.buildMs ?? []).toFixed(0),
        buildMs: timings?.buildMs.map((ms) => ms.toFixed(0)),
        fileCount: timings?.fileCount,
        heapDeltaMegabytes: timings?.heapDeltaBytes === null || timings?.heapDeltaBytes === undefined ? null : toMegabytes(timings.heapDeltaBytes),
        jsonMegabytes: toMegabytes(timings?.jsonBytes ?? 0),
        sourceCount: timings?.sourceCount,
        targetCount: timings?.targetCount,
        textCount: timings?.textCount
      })
    );

    expect(timings?.error).toBeNull();
  }, SCENARIO_TIMEOUT_IN_MS);
});

function toMegabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}
