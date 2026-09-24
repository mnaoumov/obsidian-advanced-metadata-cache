/**
 * @file
 *
 * Integration suite that exercises every `app.metadataCache.getLinkSuggestions` usage documented in
 * `README.md`:
 *
 * - Fast version, answered from the index.
 * - Safe version, which waits for the index to be built.
 * - Original (built-in) version.
 * - The reverse lookup, `getPathsByName` and `getPathsByNameSafe`, by basename and by alias.
 *
 * The fast and original answers are asserted to agree entry for entry, which is true with
 * `shouldOfferTitlesInLinkSuggestions` off — its default, and what this suite runs under.
 *
 * Named `*.cross-platform.integration.test.ts`, so the desktop AND android projects both collect it
 * and the same flow is verified on each — the API is the same on both.
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

import type { ReadyGetLinkSuggestions } from '../../../scripts/helpers/names-module.ts';

import { setNamesModuleEnabled } from '../../../scripts/helpers/names-module.ts';

/**
 * What one documented call answered, projected to something JSON can carry back.
 */
interface NameCallResult {
  readonly displayPaths: string[];
  readonly pathsByAlias: string[];
  readonly pathsByAliasSafe: string[];
  readonly pathsByBasename: string[];
  readonly suggestionCount: number;
}

const NOTE_BASENAME = 'readme-name-calls-target';
const NOTE_PATH = `${NOTE_BASENAME}.md`;
const NOTE_ALIAS = 'Readme Name Calls Alias';
const NOTE_CONTENT = `---\naliases:\n  - ${NOTE_ALIAS}\n---\n# Target\n`;

const MODULE_WAIT_IN_MS = 20_000;
const MODULE_POLL_IN_MS = 100;
const SCENARIO_TIMEOUT_IN_MS = 120_000;

describe('README getLinkSuggestions calls', () => {
  beforeAll(async () => {
    const result = await setNamesModuleEnabled(true);
    expect(result.error).toBeNull();
  }, SCENARIO_TIMEOUT_IN_MS);

  afterAll(async () => {
    // The vault is shared with every other suite in this project, and this module is off by default.
    await setNamesModuleEnabled(false);
  }, SCENARIO_TIMEOUT_IN_MS);

  it('answers the documented calls, and answers them the same way as the built-in implementation', async () => {
    const result = await evalInObsidian({
      async callback({
        app,
        lib: { waitUntil },
        MODULE_POLL_IN_MS: pollMs,
        MODULE_WAIT_IN_MS: waitMs,
        NOTE_ALIAS: noteAlias,
        NOTE_BASENAME: noteBasename,
        NOTE_CONTENT: noteContent,
        NOTE_PATH: notePath
      }) {
        const existing = app.vault.getAbstractFileByPath(notePath);

        if (existing) {
          await app.fileManager.trashFile(existing);
        }

        await app.vault.create(notePath, noteContent);

        const getLinkSuggestions = app.metadataCache.getLinkSuggestions as ReadyGetLinkSuggestions;

        // The README's own recipe for "I may be asked early": wait for the index rather than for
        // the patch, which is installed first and answers from Obsidian until the build lands.
        await getLinkSuggestions.safe();

        // The note itself is created after the build, so its entry arrives with the `changed` event.
        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the name index to pick up the newly created note',
          predicate: () => getLinkSuggestions.getPathsByName(noteAlias).includes(notePath),
          timeoutInMilliseconds: waitMs
        });

        const fast = getLinkSuggestions();
        const safe = await getLinkSuggestions.safe();
        const original = getLinkSuggestions.originalFn();

        return {
          displayPaths: fast.filter((suggestion) => suggestion.path === noteBasename).map((suggestion) => suggestion.alias ?? ''),
          fastCount: fast.length,
          originalCount: original.length,
          pathsByAlias: getLinkSuggestions.getPathsByName(noteAlias),
          pathsByAliasSafe: await getLinkSuggestions.getPathsByNameSafe(noteAlias),
          pathsByBasename: getLinkSuggestions.getPathsByName(noteBasename),
          safeCount: safe.length,
          suggestionCount: fast.length
        };
      },
      input: {
        MODULE_POLL_IN_MS,
        MODULE_WAIT_IN_MS,
        NOTE_ALIAS,
        NOTE_BASENAME,
        NOTE_CONTENT,
        NOTE_PATH
      },
      vaultPath: getTemporaryVault().path
    });

    assertNameCalls(result);

    /*
     * The three suggestion calls agree entry for entry. `originalFn` is Obsidian's own walk, so this
     * is the parity check that the index is not quietly offering a different set of link targets.
     *
     * It holds WITH `shouldOfferTitlesInLinkSuggestions` OFF, which is its default and which this
     * suite never changes. Switching it on is the one supported way to make these counts differ, and
     * it differs by a suffix: `titles.cross-platform.integration.test.ts` owns both halves of that.
     */
    expect(result.fastCount).toBe(result.originalCount);
    expect(result.safeCount).toBe(result.originalCount);
  }, SCENARIO_TIMEOUT_IN_MS);
});

/**
 * Asserts the documented answers about the fixture note.
 *
 * @param result - What the documented calls answered.
 */
function assertNameCalls(result: NameCallResult): void {
  // One entry for the note, one for its alias, both at its display path.
  expect(result.displayPaths).toEqual(['', NOTE_ALIAS]);
  expect(result.suggestionCount).toBeGreaterThanOrEqual(1);

  expect(result.pathsByBasename).toEqual([NOTE_PATH]);
  expect(result.pathsByAlias).toEqual([NOTE_PATH]);
  expect(result.pathsByAliasSafe).toEqual([NOTE_PATH]);
}
