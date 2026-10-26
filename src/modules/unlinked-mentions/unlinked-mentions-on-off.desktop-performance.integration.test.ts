import type { BacklinkView } from '@obsidian-typings/obsidian-public-latest';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { SettingsEditorPlugin } from '../../../scripts/helpers/names-module.ts';
import type { PluginApiRegistryHolder } from '../../../scripts/helpers/plugin-api-registry.ts';

import { PERFORMANCE_VAULT_TARGET } from '../../../scripts/helpers/generate-performance-vault.ts';
import { waitForPerformanceVaultScan } from '../../../scripts/helpers/wait-for-performance-vault-scan.ts';

/*
 * The tripwire for the `Unlinked mentions` module: the Backlinks pane's `Unlinked mentions` section for one note is
 * filled faster from the module's index than by Obsidian's own scan of every note, and lists the same mentions; and
 * the module's own lookup, which is what a consumer of the API pays, costs a small fraction of Obsidian's section.
 * The section is timed the way a user meets it, from `recomputeUnlinked` to its loader stopping, both ways, in the
 * same process seconds apart.
 *
 * It also prints what the module costs to build, one read of every note, so the README's numbers have a source to be
 * re-measured from.
 */

/**
 * How long the section took to fill, averaged, and how many notes it then listed.
 */
interface SectionTiming {
  readonly count: number;
  readonly ms: number;
}

const PLUGIN_ID = 'advanced-metadata-cache';
const ITERATIONS = 3;
const SCENARIO_TIMEOUT_IN_MS = 900_000;
const PANE_SETTLE_IN_MS = 3000;
const PANE_POLL_IN_MS = 5;
const PANE_TIMEOUT_IN_MS = 240_000;

/**
 * How much faster the whole section has to fill from the index.
 *
 * Deliberately low. Rendering the listed notes costs the same on both sides and, in the generated vault, whose filler
 * notes are empty and so cost Obsidian's scan almost nothing each, it is most of the indexed time: measured 3.0-3.9x
 * at 23k and 3.2x at 40k notes. A real vault's notes hold text, which only Obsidian's scan pays for.
 */
const MINIMUM_SECTION_SPEEDUP = 1.5;

/**
 * How much cheaper the module's own lookup, without rendering, has to be than Obsidian's whole section. Measured
 * 26x at 23k notes and 60x at 40k; the gap grows with the vault, since the lookup reads only the mentioning notes.
 */
const MINIMUM_LOOKUP_SPEEDUP = 10;

describe('the unlinked mentions module fills the Unlinked mentions section faster', () => {
  it('fills it faster than Obsidian\'s own scan, with the same mentions, and looks them up far faster', async () => {
    await waitForPerformanceVaultScan();

    const result = await evalInObsidian({
      async callback({
        app,
        ITERATIONS: iterations,
        PANE_POLL_IN_MS: panePollMs,
        PANE_SETTLE_IN_MS: paneSettleMs,
        PANE_TIMEOUT_IN_MS: paneTimeoutMs,
        PERFORMANCE_VAULT_TARGET: targetPath,
        PLUGIN_ID: pluginId
      }) {
        const emptyResult = { apiMs: 0, buildMs: 0, error: '', fileCount: 0, indexedCount: 0, indexedMs: 0, nativeCount: 0, nativeMs: 0 };
        const plugin = app.plugins.getPlugin(pluginId) as null | SettingsEditorPlugin;
        const target = app.vault.getFileByPath(targetPath);
        if (!plugin || !target) {
          return { ...emptyResult, error: 'Plugin or target note missing' };
        }

        await app.workspace.getLeaf(false).openFile(target);
        app.internalPlugins.getPluginById('backlink')?.instance.openBacklinksForActiveFile(true);
        await sleep(paneSettleMs);
        const backlinkLeaf = app.workspace.getLeavesOfType('backlink')[0];
        if (!backlinkLeaf) {
          return { ...emptyResult, error: 'No backlink side panel leaf' };
        }

        const backlinkComponent = (backlinkLeaf.view as BacklinkView).backlink;
        await backlinkComponent.setUnlinkedCollapsed(false, false);

        try {
          const native = await timeSection();

          await plugin.pluginSettingsComponent.editAndSave((settings) => {
            settings.isUnlinkedMentionsModuleEnabled = true;
          });

          const records = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records;
          const api = (records?.[pluginId] ?? []).find((record) => !record.isRevoked)?.api;
          if (!api) {
            return { ...emptyResult, error: 'No live API record' };
          }

          // The first call waits for the build, which is one read of every note.
          const buildStart = performance.now();
          await api.getUnlinkedMentions(targetPath);
          const buildMs = performance.now() - buildStart;

          const indexed = await timeSection();

          // The API alone, without the section's rendering, which costs the same on both sides.
          const apiStart = performance.now();
          for (let iteration = 0; iteration < iterations; iteration++) {
            await api.getUnlinkedMentions(targetPath);
          }
          const apiMs = (performance.now() - apiStart) / iterations;

          return {
            apiMs,
            buildMs,
            error: null,
            fileCount: app.vault.getMarkdownFiles().length,
            indexedCount: indexed.count,
            indexedMs: indexed.ms,
            nativeCount: native.count,
            nativeMs: native.ms
          };
        } finally {
          // The performance vault is shared with every other performance suite, and this module is off by default.
          await plugin.pluginSettingsComponent.editAndSave((settings) => {
            settings.isUnlinkedMentionsModuleEnabled = false;
          });
        }

        async function timeSection(): Promise<SectionTiming> {
          let totalMs = 0;
          for (let iteration = 0; iteration < iterations; iteration++) {
            const start = performance.now();
            backlinkComponent.recomputeUnlinked(target);
            let hasStarted = false;
            while (performance.now() - start < paneTimeoutMs) {
              const isWorking = backlinkComponent.unlinkedDom.working;
              hasStarted ||= isWorking;
              if (hasStarted && !isWorking) {
                break;
              }

              await sleep(panePollMs);
            }

            totalMs += performance.now() - start;
          }

          return { count: backlinkComponent.unlinkedDom.resultDomLookup.size, ms: totalMs / iterations };
        }
      },
      input: {
        ITERATIONS,
        PANE_POLL_IN_MS,
        PANE_SETTLE_IN_MS,
        PANE_TIMEOUT_IN_MS,
        PERFORMANCE_VAULT_TARGET,
        PLUGIN_ID
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result.error).toBeNull();

    console.warn('[unlinked mentions module on/off]', {
      apiMs: result.apiMs.toFixed(1),
      buildMs: result.buildMs.toFixed(0),
      fileCount: result.fileCount,
      indexedCount: result.indexedCount,
      indexedMs: result.indexedMs.toFixed(1),
      lookupSpeedup: (result.nativeMs / result.apiMs).toFixed(1),
      nativeCount: result.nativeCount,
      nativeMs: result.nativeMs.toFixed(1),
      sectionSpeedup: (result.nativeMs / result.indexedMs).toFixed(1)
    });

    expect(result.nativeCount).toBeGreaterThan(0);
    expect(result.indexedCount).toBe(result.nativeCount);
    expect(result.nativeMs / result.indexedMs).toBeGreaterThan(MINIMUM_SECTION_SPEEDUP);
    expect(result.nativeMs / result.apiMs).toBeGreaterThan(MINIMUM_LOOKUP_SPEEDUP);
  }, SCENARIO_TIMEOUT_IN_MS);
});
