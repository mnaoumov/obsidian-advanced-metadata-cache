import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type {
  PatchedGetLinkSuggestions,
  ReadyGetLinkSuggestions,
  SettingsEditorPlugin
} from '../../../scripts/helpers/names-module.ts';

import { waitForPerformanceVaultScan } from '../../../scripts/helpers/wait-for-performance-vault-scan.ts';

/*
 * The tripwire for the `names` module: with it on, `getLinkSuggestions()` must be far cheaper than
 * the implementation it replaces, measured against that implementation in the same process, on the
 * same vault, seconds apart.
 *
 * It is deliberately a RATIO rather than an absolute ceiling. The baseline suite beside this one
 * prices the native call (~108 ms at 90k files, ~23 ms at 20k); an absolute number would either
 * pass trivially at the small size this normally runs at, or fail on a slower machine at the large
 * one. The ratio holds at both, because both sides move together.
 *
 * `originalFn` is what makes this measurable at all: the patch keeps Obsidian's own implementation
 * reachable, so the comparison needs no plugin disable and no second vault.
 */

const PLUGIN_ID = 'advanced-metadata-cache';
const ITERATIONS = 20;
const SCENARIO_TIMEOUT_IN_MS = 600_000;
/*
 * Kept under the transport's 30 s per-command cap: everything this closure waits for is the module
 * loading off a settings save, which is a matter of milliseconds. The vault scan, the wait that
 * genuinely takes minutes, happens in Node before the closure is sent.
 */
const INDEX_WAIT_IN_MS = 20_000;
const INDEX_POLL_IN_MS = 500;

/**
 * How much cheaper the indexed answer has to be than Obsidian's own, per call.
 *
 * Measured at 5-30x depending on vault size (the bigger the vault, the wider the gap, since the
 * index turns a per-file `getFileCache` + alias parse into a map lookup). Four is the floor a
 * regression would have to cross, leaving room for a loaded machine.
 */
const MINIMUM_SPEEDUP = 4;

describe('the names module makes getLinkSuggestions cheaper', () => {
  it('answers far faster than the implementation it replaces, with the same entries', async () => {
    await waitForPerformanceVaultScan();

    const result = await evalInObsidian({
      async callback({
        app,
        INDEX_POLL_IN_MS: indexPollMs,
        INDEX_WAIT_IN_MS: indexWaitMs,
        ITERATIONS: iterations,
        lib: { waitUntil },
        PLUGIN_ID: pluginId
      }) {
        const metadataCache = app.metadataCache;
        const plugin = app.plugins.getPlugin(pluginId) as null | SettingsEditorPlugin;

        if (!plugin) {
          return { error: 'Plugin not loaded', fileCount: 0, indexedCount: 0, indexedPerCallMs: 0, nativeCount: 0, nativePerCallMs: 0 };
        }

        try {
          await plugin.pluginSettingsComponent.editAndSave((settings) => {
            settings.isNamesModuleEnabled = true;
          });

          /*
           * Two steps, and both are needed. The module loads asynchronously off the settings save,
           * so the patch is not there yet; and the patch is installed BEFORE the index is built, so
           * its mere presence says nothing about whether an ordinary call is yet answered from the
           * index. `safe()` is the documented way to wait for the second — this is the README's own
           * recipe, run as written.
           */
          await waitUntil({
            intervalInMilliseconds: indexPollMs,
            message: 'the names module to install its patch',
            predicate: () => (metadataCache.getLinkSuggestions as PatchedGetLinkSuggestions).safe !== undefined,
            timeoutInMilliseconds: indexWaitMs
          });

          const patched = metadataCache.getLinkSuggestions as ReadyGetLinkSuggestions;
          await patched.safe();
          const builtIn = patched.originalFn.bind(metadataCache);

          const indexedMs = measure(() => metadataCache.getLinkSuggestions());
          const nativeMs = measure(builtIn);

          return {
            error: null,
            fileCount: app.vault.getFiles().length,
            indexedCount: metadataCache.getLinkSuggestions().length,
            indexedPerCallMs: indexedMs / iterations,
            nativeCount: builtIn().length,
            nativePerCallMs: nativeMs / iterations
          };
        } finally {
          // The performance vault is shared with every other performance suite, and this module is
          // off by default.
          await plugin.pluginSettingsComponent.editAndSave((settings) => {
            settings.isNamesModuleEnabled = false;
          });
        }

        function measure(action: () => unknown): number {
          action();

          const start = performance.now();
          for (let iteration = 0; iteration < iterations; iteration++) {
            action();
          }
          return performance.now() - start;
        }
      },
      input: {
        INDEX_POLL_IN_MS,
        INDEX_WAIT_IN_MS,
        ITERATIONS,
        PLUGIN_ID
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result.error).toBeNull();

    console.warn('[names module on/off]', {
      fileCount: result.fileCount,
      indexedPerCallMs: result.indexedPerCallMs.toFixed(3),
      nativePerCallMs: result.nativePerCallMs.toFixed(3),
      speedup: (result.nativePerCallMs / result.indexedPerCallMs).toFixed(1)
    });

    // Same answer, not just a faster one: an index that offered fewer link targets would be a
    // regression the timing alone would happily report as an improvement.
    expect(result.indexedCount).toBe(result.nativeCount);
    expect(result.nativePerCallMs / result.indexedPerCallMs).toBeGreaterThan(MINIMUM_SPEEDUP);
  }, SCENARIO_TIMEOUT_IN_MS);
});
