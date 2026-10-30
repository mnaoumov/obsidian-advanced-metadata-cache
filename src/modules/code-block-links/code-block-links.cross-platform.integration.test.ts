/**
 * @file
 *
 * Integration suite for the `Code block links` module, against a real Obsidian and its own metadata worker:
 *
 * - A link inside a block of a listed language (`ad-*`) reaches `resolvedLinks` and core `getBacklinksForFile`; a link
 *   inside a block of another language does not.
 * - A language registered through the API joins, and leaves again when unregistered.
 * - Renaming the target rewrites the link INSIDE the block, at the right offset, through Obsidian's own updater.
 * - Switching the module off takes the links out again, and the API answers `null`.
 *
 * Named `*.cross-platform.integration.test.ts` so the desktop AND android projects both collect it.
 */

import dedent from 'dedent';
import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterAll,
  describe,
  expect,
  it
} from 'vitest';

import { applyPluginSettings } from '../../../scripts/helpers/names-module.ts';

/**
 * The published API, as a consumer compiles against it, narrowed to what this suite calls.
 */
interface AdvancedMetadataCacheApi {
  readonly getCodeBlockReferences: (pathOrFile: string) => CodeBlockReference[] | null;
  readonly getCodeBlockReferencesSafe: (pathOrFile: string) => Promise<CodeBlockReference[] | null>;
  readonly registerCodeBlockLanguage: (language: string) => () => void;
}

/**
 * What one run of the scenario answered.
 */
interface CodeBlockLinksResult {
  readonly backlinkSources: string[];
  readonly contentAfterRename: string;
  readonly error: null | string;
  readonly references: string[];
  readonly resolvedAfterRegister: string[];
  readonly resolvedAfterUnregister: string[];
  readonly resolvedAtStart: string[];
}

interface CodeBlockReference {
  readonly isEmbed: boolean;
  readonly language: string;
  readonly reference: CodeBlockReferenceCache;
}

interface CodeBlockReferenceCache {
  readonly link: string;
  readonly original: string;
}

interface ObsidianLibStateBag {
  readonly pluginApiRegistry?: PluginApiRegistryWrapper;
}

interface PluginApiRecord {
  readonly api: AdvancedMetadataCacheApi;
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

/**
 * What the API and Obsidian answer once the module is switched off.
 */
interface SwitchedOffResult {
  readonly error: null | string;
  readonly references: 'no record' | CodeBlockReference[] | null;
  readonly resolved: string[];
}

const FOLDER_PATH = 'code-block-links';
const ALPHA_PATH = `${FOLDER_PATH}/alpha.md`;
const ALPHA_RENAMED_PATH = `${FOLDER_PATH}/alpha-renamed.md`;
const BRAVO_PATH = `${FOLDER_PATH}/bravo.md`;
const CHARLIE_PATH = `${FOLDER_PATH}/charlie.md`;
const SOURCE_PATH = `${FOLDER_PATH}/source.md`;
const SOURCE_CONTENT = dedent`
  # Source

  \`\`\`ad-note Title
  Line one

  See [[alpha]] here.
  \`\`\`

  \`\`\`js
  // [[bravo]]
  \`\`\`

  ~~~tabs
  [[charlie]]
  ~~~\n
`;

/*
 * Every wait is for work already in flight, so they are generous, not budgets. Their SUM has to stay under the
 * transport's per-command cap, since one closure holds one `Runtime.evaluate` open.
 */
const API_WAIT_IN_MS = 3000;
const INDEX_WAIT_IN_MS = 4000;
const POLL_IN_MS = 100;
const SCENARIO_TIMEOUT_IN_MS = 120_000;

describe('Code block links module', () => {
  afterAll(async () => {
    // The vault is shared with every other suite in this project: the module is on by default, with no language.
    await applyPluginSettings({ codeBlockLinkLanguages: [], isCodeBlockLinksModuleEnabled: true });
  }, SCENARIO_TIMEOUT_IN_MS);

  it('counts the links of listed and registered languages, rewrites them on a rename, and takes them out when off', async () => {
    const switchOn = await applyPluginSettings({ codeBlockLinkLanguages: ['ad-*'], isCodeBlockLinksModuleEnabled: true });
    expect(switchOn.error).toBeNull();

    const result = await runScenario();

    expect(result.error).toBeNull();
    expect(result.resolvedAtStart).toEqual([ALPHA_PATH]);
    expect(result.backlinkSources).toEqual([SOURCE_PATH]);
    expect(result.references).toEqual(['alpha|ad-note']);
    expect(result.resolvedAfterRegister).toEqual([ALPHA_PATH, CHARLIE_PATH]);
    expect(result.resolvedAfterUnregister).toEqual([ALPHA_PATH]);
    expect(result.contentAfterRename).toBe(SOURCE_CONTENT.replace('[[alpha]]', '[[alpha-renamed]]'));

    const switchOff = await applyPluginSettings({ isCodeBlockLinksModuleEnabled: false });
    expect(switchOff.error).toBeNull();

    const switchedOff = await readSwitchedOff();
    expect(switchedOff).toEqual({ error: null, references: null, resolved: [] });
  }, SCENARIO_TIMEOUT_IN_MS);
});

/**
 * Waits for the links to leave `resolvedLinks` once the module is off, and asks the API.
 *
 * @returns What Obsidian and the plugin answered.
 */
async function readSwitchedOff(): Promise<SwitchedOffResult> {
  return evalInObsidian({
    async callback({
      app,
      INDEX_WAIT_IN_MS: indexWaitMs,
      lib: { waitUntil },
      POLL_IN_MS: pollMs,
      SOURCE_PATH: sourcePath
    }) {
      function getResolved(): string[] {
        return Object.keys(app.metadataCache.resolvedLinks[sourcePath] ?? {}).sort();
      }

      try {
        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the links to go when the module is off',
          predicate: () => getResolved().length === 0,
          timeoutInMilliseconds: indexWaitMs
        });
      } catch (error) {
        return { error: String(error), references: 'no record', resolved: getResolved() };
      }

      const records = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records;
      const record = (records?.['advanced-metadata-cache'] ?? []).find((candidate) => !candidate.isRevoked);
      return { error: null, references: record ? record.api.getCodeBlockReferences(sourcePath) : 'no record', resolved: getResolved() };
    },
    input: { INDEX_WAIT_IN_MS, POLL_IN_MS, SOURCE_PATH },
    vaultPath: getTemporaryVault().path
  });
}

/**
 * Creates the fixture notes and walks the module through registration and a rename.
 *
 * @returns What the plugin and Obsidian answered.
 */
async function runScenario(): Promise<CodeBlockLinksResult> {
  return evalInObsidian({
    async callback({
      ALPHA_PATH: alphaPath,
      ALPHA_RENAMED_PATH: alphaRenamedPath,
      API_WAIT_IN_MS: apiWaitMs,
      app,
      BRAVO_PATH: bravoPath,
      CHARLIE_PATH: charliePath,
      FOLDER_PATH: folderPath,
      INDEX_WAIT_IN_MS: indexWaitMs,
      lib: { waitUntil },
      POLL_IN_MS: pollMs,
      SOURCE_CONTENT: sourceContent,
      SOURCE_PATH: sourcePath
    }) {
      const empty: CodeBlockLinksResult = {
        backlinkSources: [],
        contentAfterRename: '',
        error: null,
        references: [],
        resolvedAfterRegister: [],
        resolvedAfterUnregister: [],
        resolvedAtStart: []
      };

      const existingFolder = app.vault.getAbstractFileByPath(folderPath);
      if (existingFolder) {
        await app.fileManager.trashFile(existingFolder);
      }

      function readLiveRecord(): PluginApiRecord | undefined {
        const records = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records;
        return (records?.['advanced-metadata-cache'] ?? []).find((record) => !record.isRevoked);
      }

      function getResolved(): string[] {
        return Object.keys(app.metadataCache.resolvedLinks[sourcePath] ?? {}).sort();
      }

      async function waitForResolved(expected: readonly string[], message: string): Promise<void> {
        await waitUntil({
          intervalInMilliseconds: pollMs,
          message,
          predicate: () => JSON.stringify(getResolved()) === JSON.stringify(expected),
          timeoutInMilliseconds: indexWaitMs
        });
      }

      try {
        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the plugin to publish its API to the registry',
          predicate: () => readLiveRecord() !== undefined,
          timeoutInMilliseconds: apiWaitMs
        });

        const api = readLiveRecord()?.api;
        if (!api) {
          return { ...empty, error: 'No live API record' };
        }

        app.vault.setConfig('alwaysUpdateLinks', true);
        await app.vault.createFolder(folderPath);
        await app.vault.create(alphaPath, '# Alpha\n');
        await app.vault.create(bravoPath, '# Bravo\n');
        await app.vault.create(charliePath, '# Charlie\n');
        await app.vault.create(sourcePath, sourceContent);

        await waitForResolved([alphaPath], 'the link inside the ad-note block to resolve');
        const resolvedAtStart = getResolved();

        const alphaFile = app.vault.getFileByPath(alphaPath);
        if (!alphaFile) {
          return { ...empty, error: 'The target note is missing' };
        }
        // Answered by the `Backlinks` module's index, which follows the re-fired `changed` on its own schedule.
        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the backlinks of the target to list the source',
          predicate: () => app.metadataCache.getBacklinksForFile(alphaFile).keys().length > 0,
          timeoutInMilliseconds: indexWaitMs
        });
        const backlinkSources = app.metadataCache.getBacklinksForFile(alphaFile).keys();
        const references = (await api.getCodeBlockReferencesSafe(sourcePath) ?? []).map(({ language, reference }) => `${reference.link}|${language}`);

        const unregister = api.registerCodeBlockLanguage('tabs');
        await waitForResolved([alphaPath, charliePath], 'the registered language to count');
        const resolvedAfterRegister = getResolved();

        unregister();
        await waitForResolved([alphaPath], 'the unregistered language to stop counting');
        const resolvedAfterUnregister = getResolved();

        await app.fileManager.renameFile(alphaFile, alphaRenamedPath);
        const sourceFile = app.vault.getFileByPath(sourcePath);
        if (!sourceFile) {
          return { ...empty, error: 'The source note is missing' };
        }
        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the rename to rewrite the link inside the block',
          predicate: async () => {
            const content = await app.vault.read(sourceFile);
            return content.includes('[[alpha-renamed]]');
          },
          timeoutInMilliseconds: indexWaitMs
        });
        const contentAfterRename = await app.vault.read(sourceFile);

        await waitForResolved([alphaRenamedPath], 'the renamed link to resolve');

        return {
          backlinkSources,
          contentAfterRename,
          error: null,
          references,
          resolvedAfterRegister,
          resolvedAfterUnregister,
          resolvedAtStart
        };
      } catch (error) {
        return { ...empty, error: String(error) };
      }
    },
    input: {
      ALPHA_PATH,
      ALPHA_RENAMED_PATH,
      API_WAIT_IN_MS,
      BRAVO_PATH,
      CHARLIE_PATH,
      FOLDER_PATH,
      INDEX_WAIT_IN_MS,
      POLL_IN_MS,
      SOURCE_CONTENT,
      SOURCE_PATH
    },
    vaultPath: getTemporaryVault().path
  });
}
