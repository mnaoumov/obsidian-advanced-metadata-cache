import type { LinkSuggestion } from '@obsidian-typings/obsidian-public-latest';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import { waitForPerformanceVaultScan } from '../../../scripts/helpers/wait-for-performance-vault-scan.ts';

/*
 * The PREMISE GATE for the `names` module: what Obsidian's own
 * `metadataCache.getLinkSuggestions()` costs at vault scale, and whether the `[[` autocomplete
 * really pays that cost on every open.
 *
 * Read out of Obsidian 1.13.7's own `app.js`:
 *
 * - `MetadataCache.getLinkSuggestions` walks `vault.getFiles()` in full, calls `isSupportedFile`
 *   and `getFileCache` per file, parses each file's frontmatter aliases, then walks the whole
 *   `unresolvedLinks` map — building a flat, unkeyed array with no memoization of its own.
 * - `FileSuggestManager.getFileSuggestions` memoizes that array in `this.fileSuggestions`, and
 *   the link suggester's `close()` sets `suggestManager.fileSuggestions = null`.
 *
 * So the memo lives exactly as long as one open popover, and the whole walk is re-run on the
 * next `[[`. This suite measures that empirically rather than trusting the reading: the first
 * test prices the call, the second drives the real editor with trusted input and counts the
 * calls the suggester actually makes.
 *
 * It is written to survive the module it justifies: if the numbers ever say core is cheap enough,
 * this file is the record of why the module should not exist.
 */

const PLUGIN_ID = 'advanced-metadata-cache';
const PROBE_NOTE_PATH = 'names-suggestion-probe.md';

/**
 * Enough calls to average out scheduling noise, few enough that the measuring closure stays far
 * inside the per-command budget at 90k files, where one call is ~110 ms.
 */
const ITERATIONS = 20;

const SUGGESTER_WAIT_IN_MS = 10_000;
const SUGGESTER_POLL_IN_MS = 100;
const OPEN_COUNT = 2;
const SCENARIO_TIMEOUT_IN_MS = 600_000;

/**
 * What one `[[` open cost, as counted from inside `getLinkSuggestions` itself.
 */
interface SuggesterOpen {
  readonly callCountAfter: number;
  readonly msInGetLinkSuggestions: number;
}

describe('getLinkSuggestions baseline at vault scale', () => {
  it('walks the whole vault on every call, with and without the plugin loaded', async () => {
    await waitForPerformanceVaultScan();

    const result = await evalInObsidian({
      async callback({
        app,
        ITERATIONS: iterations,
        PLUGIN_ID: pluginId
      }) {
        const metadataCache = app.metadataCache;
        const fileCount = app.vault.getFiles().length;

        const enabledMs = measure();
        const suggestionCount = metadataCache.getLinkSuggestions().length;

        await app.plugins.disablePlugin(pluginId);
        const nativeMs = measure();
        const nativeSuggestionCount = metadataCache.getLinkSuggestions().length;
        await app.plugins.enablePlugin(pluginId);

        return {
          enabledPerCallMs: enabledMs / iterations,
          fileCount,
          nativePerCallMs: nativeMs / iterations,
          nativeSuggestionCount,
          suggestionCount
        };

        function measure(): number {
          // One warm-up call, so the FIRST measurement does not also pay for JIT-compiling a walk
          // that has never run. Without it the enabled/native comparison reads whichever ran first
          // as the slower of the two.
          metadataCache.getLinkSuggestions();

          const start = performance.now();
          for (let iteration = 0; iteration < iterations; iteration++) {
            metadataCache.getLinkSuggestions();
          }
          return performance.now() - start;
        }
      },
      input: {
        ITERATIONS,
        PLUGIN_ID
      },
      vaultPath: getTemporaryVault().path
    });

    console.warn('[getLinkSuggestions baseline]', {
      enabledPerCallMs: result.enabledPerCallMs.toFixed(3),
      fileCount: result.fileCount,
      msPerThousandFiles: (result.nativePerCallMs / (result.fileCount / 1000)).toFixed(3),
      nativePerCallMs: result.nativePerCallMs.toFixed(3),
      suggestionCount: result.suggestionCount
    });

    /*
     * The vault really is at scale. Without the performance `globalSetup` wired into the
     * project this opens an EMPTY vault, and every number above would be a measurement of
     * nothing — the failure mode this assertion exists to name.
     */
    expect(result.fileCount).toBeGreaterThan(1000);

    /*
     * One entry per supported file, plus one per frontmatter alias and per unresolved link. That
     * the array is at least as long as the vault is what makes this call O(vault) BY CONSTRUCTION
     * rather than by timing — the size-independent half of the premise.
     */
    expect(result.suggestionCount).toBeGreaterThanOrEqual(result.fileCount);
    expect(result.nativeSuggestionCount).toBeGreaterThanOrEqual(result.fileCount);
  }, SCENARIO_TIMEOUT_IN_MS);

  it('is re-run by the link suggester on every `[[` open, never amortized across opens', async () => {
    await waitForPerformanceVaultScan();

    const result = await evalInObsidian({
      async callback({
        app,
        lib: {
          createNote,
          pressKey,
          typeIntoEditor,
          waitUntil
        },
        OPEN_COUNT: openCount,
        PROBE_NOTE_PATH: probeNotePath,
        SUGGESTER_POLL_IN_MS: suggesterPollMs,
        SUGGESTER_WAIT_IN_MS: suggesterWaitMs
      }) {
        const metadataCache = app.metadataCache;
        const editorSuggest = app.workspace.editorSuggest;

        const probeFile = await createNote({ content: '', path: probeNotePath });
        const leaf = app.workspace.getLeaf(false);
        await leaf.openFile(probeFile);

        const editor = app.workspace.activeEditor?.editor;
        if (!editor) {
          return { error: 'No active editor for the probe note', opens: [] as SuggesterOpen[] };
        }

        let callCount = 0;
        let totalMs = 0;
        const originalGetLinkSuggestions = metadataCache.getLinkSuggestions;
        metadataCache.getLinkSuggestions = (): LinkSuggestion[] => {
          const start = performance.now();
          try {
            return originalGetLinkSuggestions.call(metadataCache);
          } finally {
            callCount++;
            totalMs += performance.now() - start;
          }
        };

        const opens: SuggesterOpen[] = [];

        try {
          for (let openIndex = 0; openIndex < openCount; openIndex++) {
            editor.setValue('');
            const msBefore = totalMs;

            await typeIntoEditor({ editor, text: '[[' });
            await waitUntil({
              intervalInMilliseconds: suggesterPollMs,
              message: 'the `[[` link suggester to open',
              predicate: () => editorSuggest.isShowingSuggestion(),
              timeoutInMilliseconds: suggesterWaitMs
            });

            opens.push({ callCountAfter: callCount, msInGetLinkSuggestions: totalMs - msBefore });

            await pressKey({ key: 'Escape' });
            await waitUntil({
              intervalInMilliseconds: suggesterPollMs,
              message: 'the `[[` link suggester to close',
              predicate: () => !editorSuggest.isShowingSuggestion(),
              timeoutInMilliseconds: suggesterWaitMs
            });
          }
        } finally {
          metadataCache.getLinkSuggestions = originalGetLinkSuggestions;
          editor.setValue('');
        }

        return { error: null, opens };
      },
      input: {
        OPEN_COUNT,
        PROBE_NOTE_PATH,
        SUGGESTER_POLL_IN_MS,
        SUGGESTER_WAIT_IN_MS
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result.error).toBeNull();
    console.warn('[getLinkSuggestions per `[[` open]', result.opens);

    /*
     * The first open builds the memo, the second rebuilds it from scratch: `close()` nulled
     * `suggestManager.fileSuggestions`. A call count that stayed at 1 would mean Obsidian
     * amortizes the walk across opens, and the whole module would be answering a question
     * nobody asks.
     */
    expect(result.opens).toHaveLength(OPEN_COUNT);
    expect(result.opens[0]?.callCountAfter).toBe(1);
    expect(result.opens[1]?.callCountAfter).toBe(2);
  }, SCENARIO_TIMEOUT_IN_MS);
});
