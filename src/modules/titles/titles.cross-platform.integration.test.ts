/**
 * @file
 *
 * Integration suite for the `Titles` module, against a real Obsidian:
 *
 * - The published API answers the per-note read and names the configured properties.
 * - A title joins the name index's reverse lookup, and a second configured property does too.
 * - A title is NOT offered by `getLinkSuggestions()`, which stays entry-for-entry Obsidian's.
 * - Switching the module off takes both answers with it.
 *
 * Named `*.cross-platform.integration.test.ts` so the desktop AND android projects both collect it:
 * none of this is platform-specific, and the API is the one a consumer calls on either.
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

import { applyPluginSettings } from '../../../scripts/helpers/names-module.ts';

/**
 * The published API, as a consumer compiles against it — the shape the root `api.d.ts` declares.
 *
 * Declared here rather than imported, because an `evalInObsidian` closure is type-checked in this
 * module's scope but cannot carry a value across.
 */
interface AdvancedMetadataCacheApi {
  getTitlePropertyNames(): string[];
  getTitles(pathOrFile: string): string[];
}

interface ObsidianDevUtilsStateBag {
  readonly pluginApiRegistry?: PluginApiRegistryWrapper;
}

/**
 * The registry record, as the published wire protocol carries it.
 *
 * The suite reads the registry directly rather than through `watchPluginApi`, for two reasons: the
 * serialized renderer closure cannot import a value, and this IS the documented route for a consumer
 * that does not use `obsidian-dev-utils` — so the check covers the protocol as well as the answers.
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
  readonly __obsidianDevUtils?: ObsidianDevUtilsStateBag;
}

interface PluginApiRegistryWrapper {
  readonly value?: PluginApiRegistry;
}

/**
 * What one run of the scenario answered.
 */
interface TitlesResult {
  readonly error: null | string;
  readonly isTitleOfferedAsSuggestion: boolean;
  readonly pathsByHeading: string[];
  readonly pathsByOwnName: string[];
  readonly pathsByTitle: string[];
  readonly propertyNames: string[];
  readonly titles: string[];
}

const NOTE_BASENAME = 'titles-target';
const NOTE_PATH = `${NOTE_BASENAME}.md`;
const NOTE_TITLE = 'Titles Integration Real Name';
const NOTE_HEADING = 'Titles Integration Second Name';
const NOTE_CONTENT = `---\ntitle: ${NOTE_TITLE}\nheading: ${NOTE_HEADING}\n---\n# Target\n`;

/*
 * Every wait is for work already in flight - the plugin loaded before this suite ran, and the note
 * is created a few lines above - so they are generous, not budgets. Their SUM (25 s) has to stay
 * under the transport's per-command cap, since this closure holds one `Runtime.evaluate` open for
 * the whole scenario.
 */
const API_WAIT_IN_MS = 5000;
const FRONTMATTER_WAIT_IN_MS = 10_000;
const INDEX_WAIT_IN_MS = 10_000;
const POLL_IN_MS = 100;
const SCENARIO_TIMEOUT_IN_MS = 120_000;

describe('Titles module', () => {
  beforeAll(async () => {
    const result = await applyPluginSettings({
      isNamesModuleEnabled: true,
      isTitlesModuleEnabled: true,
      titlePropertyNames: ['title', 'heading']
    });
    expect(result.error).toBeNull();
  }, SCENARIO_TIMEOUT_IN_MS);

  afterAll(async () => {
    // The vault is shared with every other suite in this project, and both modules are off by
    // default.
    await applyPluginSettings({
      isNamesModuleEnabled: false,
      isTitlesModuleEnabled: false,
      titlePropertyNames: ['title']
    });
  }, SCENARIO_TIMEOUT_IN_MS);

  it('answers by title through the API and through the name index, and offers none of it to the autocomplete', async () => {
    const result = await runScenario();

    expect(result.error).toBeNull();
    expect(result.propertyNames).toEqual(['title', 'heading']);
    expect(result.titles).toEqual([NOTE_TITLE, NOTE_HEADING]);

    expect(result.pathsByTitle).toEqual([NOTE_PATH]);
    expect(result.pathsByHeading).toEqual([NOTE_PATH]);
    expect(result.pathsByOwnName).toEqual([NOTE_PATH]);

    // The one thing the module deliberately does NOT do: the `[[` list stays Obsidian's own.
    expect(result.isTitleOfferedAsSuggestion).toBe(false);
  }, SCENARIO_TIMEOUT_IN_MS);

  it('takes both answers away when the module is switched off', async () => {
    const switchOff = await applyPluginSettings({ isTitlesModuleEnabled: false });
    expect(switchOff.error).toBeNull();

    const result = await runScenario();

    expect(result.error).toBeNull();
    expect(result.propertyNames).toEqual([]);
    expect(result.titles).toEqual([]);
    expect(result.pathsByTitle).toEqual([]);

    // The note's own name is not the module's to take away.
    expect(result.pathsByOwnName).toEqual([NOTE_PATH]);
  }, SCENARIO_TIMEOUT_IN_MS);
});

/**
 * Creates the fixture note and asks every documented question about it.
 *
 * @returns What the plugin answered.
 */
async function runScenario(): Promise<TitlesResult> {
  return evalInObsidian({
    async callback({
      API_WAIT_IN_MS: apiWaitMs,
      app,
      FRONTMATTER_WAIT_IN_MS: frontmatterWaitMs,
      INDEX_WAIT_IN_MS: indexWaitMs,
      lib: { waitUntil },
      NOTE_BASENAME: noteBasename,
      NOTE_CONTENT: noteContent,
      NOTE_HEADING: noteHeading,
      NOTE_PATH: notePath,
      NOTE_TITLE: noteTitle,
      POLL_IN_MS: pollMs
    }) {
      const empty: TitlesResult = {
        error: null,
        isTitleOfferedAsSuggestion: false,
        pathsByHeading: [],
        pathsByOwnName: [],
        pathsByTitle: [],
        propertyNames: [],
        titles: []
      };

      const existing = app.vault.getAbstractFileByPath(notePath);

      if (existing) {
        await app.fileManager.trashFile(existing);
      }

      await app.vault.create(notePath, noteContent);

      /**
       * Reads this plugin's live API record straight out of the published registry.
       *
       * @returns The record, or nothing while none is published.
       */
      function readLiveRecord(): PluginApiRecord | undefined {
        const records = (window as PluginApiRegistryHolder).__obsidianDevUtils?.pluginApiRegistry?.value?.records;
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

        if (!record.apiVersion.startsWith('1.')) {
          return { ...empty, error: `Unexpected API contract version ${record.apiVersion}` };
        }

        const api = record.api;
        const getLinkSuggestions = app.metadataCache.getLinkSuggestions as ReadyGetLinkSuggestions;

        await getLinkSuggestions.safe();

        // The note is created after the eager build, so its entry arrives with the `changed` event.
        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the name index to pick up the newly created note',
          predicate: () => getLinkSuggestions.getPathsByName(noteBasename).includes(notePath),
          timeoutInMilliseconds: indexWaitMs
        });

        /*
         * And a SECOND wait, for the frontmatter specifically. `vault.create` resolves before the
         * metadata cache has parsed the note, and the wait above cannot stand in for this one: a
         * note's basename is known from the `create` event alone, so it lands in the name index
         * while its `title` is still unparsed — which is a read of an empty frontmatter dressed up
         * as a failing assertion.
         */
        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'Obsidian to parse the new note`s frontmatter',
          predicate: () => app.metadataCache.getCache(notePath)?.frontmatter?.['title'] === noteTitle,
          timeoutInMilliseconds: frontmatterWaitMs
        });

        return {
          ...empty,
          isTitleOfferedAsSuggestion: getLinkSuggestions().some((suggestion) => suggestion.alias === noteTitle),
          pathsByHeading: getLinkSuggestions.getPathsByName(noteHeading),
          pathsByOwnName: getLinkSuggestions.getPathsByName(noteBasename),
          pathsByTitle: getLinkSuggestions.getPathsByName(noteTitle),
          propertyNames: api.getTitlePropertyNames(),
          titles: api.getTitles(notePath)
        };
      } catch (error) {
        return { ...empty, error: String(error) };
      }
    },
    input: {
      API_WAIT_IN_MS,
      FRONTMATTER_WAIT_IN_MS,
      INDEX_WAIT_IN_MS,
      NOTE_BASENAME,
      NOTE_CONTENT,
      NOTE_HEADING,
      NOTE_PATH,
      NOTE_TITLE,
      POLL_IN_MS
    },
    vaultPath: getTemporaryVault().path
  });
}
