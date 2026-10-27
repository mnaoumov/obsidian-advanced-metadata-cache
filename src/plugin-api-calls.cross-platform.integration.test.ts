/**
 * @file
 *
 * Integration suite that exercises every backlinks and names call docs/api.md documents on the
 * published API (contract `1.3.0`), the replacements for the members once grafted onto the patched
 * core methods:
 *
 * - `getBacklinksForFile`, `getBacklinksForFileSafe` and `getBacklinksForFileOriginal`, by path and by file.
 * - `getLinkSuggestions`, `getLinkSuggestionsSafe` and `getLinkSuggestionsOriginal`, which agree entry for
 *   entry with `shouldOfferTitlesInLinkSuggestions` off, its default.
 * - `getPathsByName` and `getPathsByNameSafe`, by basename and by alias.
 * - `null` from every module-backed member while its module is off, and an answer from the `Original` ones.
 *
 * Named `*.cross-platform.integration.test.ts`, so the desktop AND android projects both collect it.
 */

import type { LinkSuggestion } from '@obsidian-typings/obsidian-public-latest';
import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

import type { SettingsEditorPlugin } from '../scripts/helpers/names-module.ts';

import { applyPluginSettings } from '../scripts/helpers/names-module.ts';

/**
 * The slice of the published API this suite calls, as a consumer compiles against it - the shape the
 * root `api.d.ts` declares, with the backlinks dictionary narrowed to what the suite reads.
 *
 * Declared here rather than imported, because an `evalInObsidian` closure is type-checked in this
 * module's scope but cannot carry a value across.
 */
interface AdvancedMetadataCacheApi {
  getBacklinksForFile: (pathOrFile: string | TFile) => BacklinksDict | null;
  getBacklinksForFileOriginal: (file: TFile) => BacklinksDict;
  getBacklinksForFileSafe: (pathOrFile: string | TFile) => Promise<BacklinksDict | null>;
  getLinkSuggestions: () => LinkSuggestion[] | null;
  getLinkSuggestionsOriginal: () => LinkSuggestion[];
  getLinkSuggestionsSafe: () => Promise<LinkSuggestion[] | null>;
  getPathsByName: (name: string) => null | string[];
  getPathsByNameSafe: (name: string) => Promise<null | string[]>;
}

/**
 * What one scenario answered, projected to something JSON can carry back.
 */
interface ApiCallsResult {
  readonly backlinkKeys: string[][];
  readonly error: null | string;
  readonly fastCount: number;
  readonly offAnswers: unknown[];
  readonly originalCount: number;
  readonly originalCountWhileOff: number;
  readonly pathsByAlias: null | string[];
  readonly pathsByAliasSafe: null | string[];
  readonly pathsByBasename: null | string[];
  readonly safeCount: number;
}

interface BacklinksDict {
  keys: () => string[];
}

interface ObsidianLibStateBag {
  readonly pluginApiRegistry?: PluginApiRegistryWrapper;
}

/**
 * The registry record, as the published wire protocol carries it. Read directly, as in the titles
 * suite: this is the documented route for a consumer that does not use `@mnaoumov/obsidian-lib`.
 */
interface PluginApiRecord {
  readonly api: AdvancedMetadataCacheApi;
  readonly apiVersion: string;
  readonly isRevoked: boolean;
}

interface PluginApiRegistry {
  readonly records?: Record<string, PluginApiRecord[] | undefined>;
}

interface PluginApiRegistryHolder {
  readonly __obsidianLib?: ObsidianLibStateBag;
}

interface PluginApiRegistryWrapper {
  readonly value?: PluginApiRegistry;
}

const TARGET_PATH = 'plugin-api-calls-target.md';
const SOURCE_PATH = 'plugin-api-calls-source.md';
const TARGET_BASENAME = 'plugin-api-calls-target';
const TARGET_ALIAS = 'Plugin Api Calls Alias';
const TARGET_CONTENT = `---\naliases:\n  - ${TARGET_ALIAS}\n---\n# Target\n`;
const SOURCE_CONTENT = `Link to [[${TARGET_BASENAME}]].`;

// Their sum stays under the transport's per-command cap, since one closure runs the whole scenario.
const API_WAIT_IN_MS = 5000;
const INDEX_WAIT_IN_MS = 10_000;
const POLL_IN_MS = 100;
const SCENARIO_TIMEOUT_IN_MS = 120_000;

describe('README plugin API calls for backlinks and names', () => {
  beforeAll(async () => {
    const result = await applyPluginSettings({ isNamesModuleEnabled: true });
    expect(result.error).toBeNull();
  }, SCENARIO_TIMEOUT_IN_MS);

  afterAll(async () => {
    // The vault is shared with every other suite in this project, and `Names` is off by default.
    await applyPluginSettings({ isNamesModuleEnabled: false });
  }, SCENARIO_TIMEOUT_IN_MS);

  it('answers every documented call, and null from the module-backed ones while the module is off', async () => {
    const result = await runScenario();

    expect(result.error).toBeNull();

    for (const keys of result.backlinkKeys) {
      expect(keys).toContain(SOURCE_PATH);
    }

    expect(result.pathsByBasename).toEqual([TARGET_PATH]);
    expect(result.pathsByAlias).toEqual([TARGET_PATH]);
    expect(result.pathsByAliasSafe).toEqual([TARGET_PATH]);

    // `getLinkSuggestionsOriginal` is Obsidian's own walk: this is the parity check docs/api.md offers it for.
    expect(result.fastCount).toBe(result.originalCount);
    expect(result.safeCount).toBe(result.originalCount);

    expect(result.offAnswers).toEqual([null, null, null, null]);
    expect(result.originalCountWhileOff).toBe(result.originalCount);
  }, SCENARIO_TIMEOUT_IN_MS);
});

/**
 * Creates the fixtures and asks every documented question about them.
 *
 * @returns What the plugin answered.
 */
async function runScenario(): Promise<ApiCallsResult> {
  return evalInObsidian({
    async callback({
      API_WAIT_IN_MS: apiWaitMs,
      app,
      INDEX_WAIT_IN_MS: indexWaitMs,
      lib: { waitUntil },
      obsidianModule,
      POLL_IN_MS: pollMs,
      SOURCE_CONTENT: sourceContent,
      SOURCE_PATH: sourcePath,
      TARGET_ALIAS: targetAlias,
      TARGET_BASENAME: targetBasename,
      TARGET_CONTENT: targetContent,
      TARGET_PATH: targetPath
    }) {
      const empty: ApiCallsResult = {
        backlinkKeys: [],
        error: null,
        fastCount: 0,
        offAnswers: [],
        originalCount: 0,
        originalCountWhileOff: 0,
        pathsByAlias: null,
        pathsByAliasSafe: null,
        pathsByBasename: null,
        safeCount: 0
      };

      for (const path of [targetPath, sourcePath]) {
        const existing = app.vault.getAbstractFileByPath(path);
        if (existing) {
          await app.fileManager.trashFile(existing);
        }
      }

      await app.vault.create(targetPath, targetContent);
      await app.vault.create(sourcePath, sourceContent);

      /**
       * Reads this plugin's live API record straight out of the published registry.
       *
       * @returns The record, or nothing while none is published.
       */
      function readLiveRecord(): PluginApiRecord | undefined {
        const records = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records;
        return (records?.['advanced-metadata-cache'] ?? []).find((record) => !record.isRevoked);
      }

      try {
        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the plugin to publish its API to the registry',
          predicate: () => readLiveRecord() !== undefined,
          timeoutInMilliseconds: apiWaitMs
        });

        const record = readLiveRecord();

        if (!record) {
          return { ...empty, error: 'No live API record' };
        }

        if (!record.apiVersion.startsWith('1.') || Number(record.apiVersion.split('.', 2)[1]) < 3) {
          return { ...empty, error: `Unexpected API contract version ${record.apiVersion}` };
        }

        const api = record.api;
        const targetFile = app.vault.getAbstractFileByPath(targetPath);

        if (!(targetFile instanceof obsidianModule.TFile)) {
          return { ...empty, error: `Target file not found: ${targetPath}` };
        }

        /**
         * Projects a backlinks answer to its keys, so a `null` reads as none.
         *
         * @param dict - The answer.
         * @returns The paths of the linking notes.
         */
        function keysOf(dict: BacklinksDict | null): string[] {
          return dict?.keys() ?? [];
        }

        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the backlink cache and the name index to pick up the new notes',
          predicate: async () => {
            const backlinks = await api.getBacklinksForFileSafe(targetPath);
            const paths = await api.getPathsByNameSafe(targetAlias);
            return keysOf(backlinks).includes(sourcePath) && (paths ?? []).includes(targetPath);
          },
          timeoutInMilliseconds: indexWaitMs
        });

        const safeBacklinksByFile = await api.getBacklinksForFileSafe(targetFile);
        const safeBacklinksByPath = await api.getBacklinksForFileSafe(targetPath);
        const backlinkKeys = [
          keysOf(api.getBacklinksForFile(targetFile)),
          keysOf(api.getBacklinksForFile(targetPath)),
          keysOf(safeBacklinksByFile),
          keysOf(safeBacklinksByPath),
          keysOf(api.getBacklinksForFileOriginal(targetFile))
        ];

        const safeSuggestions = await api.getLinkSuggestionsSafe();
        const fastCount = api.getLinkSuggestions()?.length ?? -1;
        const safeCount = safeSuggestions?.length ?? -1;
        const originalCount = api.getLinkSuggestionsOriginal().length;
        const pathsByBasename = api.getPathsByName(targetBasename);
        const pathsByAlias = api.getPathsByName(targetAlias);
        const pathsByAliasSafe = await api.getPathsByNameSafe(targetAlias);

        const plugin = app.plugins.getPlugin('advanced-metadata-cache') as null | SettingsEditorPlugin;
        await plugin?.pluginSettingsComponent.editAndSave((settings) => {
          settings.isNamesModuleEnabled = false;
        });

        const offAnswers = [
          api.getLinkSuggestions(),
          await api.getLinkSuggestionsSafe(),
          api.getPathsByName(targetAlias),
          await api.getPathsByNameSafe(targetAlias)
        ];
        const originalCountWhileOff = api.getLinkSuggestionsOriginal().length;

        return {
          backlinkKeys,
          error: null,
          fastCount,
          offAnswers,
          originalCount,
          originalCountWhileOff,
          pathsByAlias,
          pathsByAliasSafe,
          pathsByBasename,
          safeCount
        };
      } catch (error) {
        return { ...empty, error: String(error) };
      }
    },
    input: {
      API_WAIT_IN_MS,
      INDEX_WAIT_IN_MS,
      POLL_IN_MS,
      SOURCE_CONTENT,
      SOURCE_PATH,
      TARGET_ALIAS,
      TARGET_BASENAME,
      TARGET_CONTENT,
      TARGET_PATH
    },
    vaultPath: getTemporaryVault().path
  });
}
