/**
 * @file
 *
 * Integration suite for the `Link texts` module, against a real Obsidian:
 *
 * - A written display text makes a note and an attachment answer to it, from a body link, a wikilink, an embed and a
 *   frontmatter value; a bare link and one that only repeats the file's name add nothing.
 * - Editing the linking note changes the answer, and a subscriber is told which file changed.
 * - Switching the module off answers `null`.
 *
 * Named `*.cross-platform.integration.test.ts` so the desktop AND android projects both collect it: none of this is
 * platform-specific, and the API is the one a consumer calls on either.
 */

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
  readonly getLinkTexts: (pathOrFile: string) => LinkText[] | null;
  readonly getLinkTextsSafe: (pathOrFile: string) => Promise<LinkText[] | null>;
  readonly onLinkTextsChanged: (callback: (targetPaths: null | readonly string[]) => void) => () => void;
}

interface LinkText {
  readonly count: number;
  readonly sourcePaths: readonly string[];
  readonly text: string;
}

/**
 * What one run of the scenario answered.
 */
interface LinkTextsResult {
  readonly attachmentTexts: LinkText[] | null;
  readonly changedPaths: (null | readonly string[])[];
  readonly error: null | string;
  readonly noteTexts: LinkText[] | null;
  readonly noteTextsAfterEdit: LinkText[] | null;
}

interface ObsidianLibStateBag {
  readonly pluginApiRegistry?: PluginApiRegistryWrapper;
}

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

const FOLDER_PATH = 'link-texts';
const TARGET_PATH = `${FOLDER_PATH}/bravo.md`;
const ATTACHMENT_PATH = `${FOLDER_PATH}/scan-0042.pdf`;
const SOURCE_PATH = `${FOLDER_PATH}/charlie.md`;
const SOURCE_CONTENT = [
  '---',
  'related: "[[bravo|from frontmatter]]"',
  '---',
  '[alpha](bravo.md) and [[bravo|alpha]] and [[bravo]] and [bravo](bravo.md)',
  '',
  '![[scan-0042.pdf|March invoice]]',
  ''
].join('\n');
const EDITED_SOURCE_CONTENT = '[[bravo|delta]]\n';

/*
 * Every wait is for work already in flight, so they are generous, not budgets. Their SUM has to stay under the
 * transport's per-command cap, since this closure holds one `Runtime.evaluate` open for the whole scenario.
 */
const API_WAIT_IN_MS = 5000;
const INDEX_WAIT_IN_MS = 10_000;
const POLL_IN_MS = 100;
const SCENARIO_TIMEOUT_IN_MS = 120_000;

describe('Link texts module', () => {
  afterAll(async () => {
    // The vault is shared with every other suite in this project, and the module is on by default.
    await applyPluginSettings({ isLinkTextsModuleEnabled: true });
  }, SCENARIO_TIMEOUT_IN_MS);

  it('answers by written link texts for a note and an attachment, and follows an edit', async () => {
    const switchOn = await applyPluginSettings({ isLinkTextsModuleEnabled: true });
    expect(switchOn.error).toBeNull();

    const result = await runScenario();

    expect(result.error).toBeNull();
    expect(result.noteTexts).toEqual([
      { count: 2, sourcePaths: [SOURCE_PATH], text: 'alpha' },
      { count: 1, sourcePaths: [SOURCE_PATH], text: 'from frontmatter' }
    ]);
    expect(result.attachmentTexts).toEqual([{ count: 1, sourcePaths: [SOURCE_PATH], text: 'March invoice' }]);
    expect(result.noteTextsAfterEdit).toEqual([{ count: 1, sourcePaths: [SOURCE_PATH], text: 'delta' }]);
    expect(result.changedPaths).toContainEqual(expect.arrayContaining([TARGET_PATH, ATTACHMENT_PATH]));
  }, SCENARIO_TIMEOUT_IN_MS);

  it('answers null while the module is off', async () => {
    const switchOff = await applyPluginSettings({ isLinkTextsModuleEnabled: false });
    expect(switchOff.error).toBeNull();

    const result = await evalInObsidian({
      callback({ TARGET_PATH: targetPath }) {
        const records = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records;
        const record = (records?.['advanced-metadata-cache'] ?? []).find((candidate) => !candidate.isRevoked);
        return record ? record.api.getLinkTexts(targetPath) : 'no record';
      },
      input: { TARGET_PATH },
      vaultPath: getTemporaryVault().path
    });

    expect(result).toBeNull();
  }, SCENARIO_TIMEOUT_IN_MS);
});

/**
 * Creates the fixture notes, asks the API about them, edits the linking note and asks again.
 *
 * @returns What the plugin answered.
 */
async function runScenario(): Promise<LinkTextsResult> {
  return evalInObsidian({
    async callback({
      API_WAIT_IN_MS: apiWaitMs,
      app,
      ATTACHMENT_PATH: attachmentPath,
      EDITED_SOURCE_CONTENT: editedSourceContent,
      FOLDER_PATH: folderPath,
      INDEX_WAIT_IN_MS: indexWaitMs,
      lib: { waitUntil },
      POLL_IN_MS: pollMs,
      SOURCE_CONTENT: sourceContent,
      SOURCE_PATH: sourcePath,
      TARGET_PATH: targetPath
    }) {
      const empty: LinkTextsResult = { attachmentTexts: null, changedPaths: [], error: null, noteTexts: null, noteTextsAfterEdit: null };

      const existingFolder = app.vault.getAbstractFileByPath(folderPath);
      if (existingFolder) {
        await app.fileManager.trashFile(existingFolder);
      }

      function readLiveRecord(): PluginApiRecord | undefined {
        const records = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records;
        return (records?.['advanced-metadata-cache'] ?? []).find((record) => !record.isRevoked);
      }

      const changedPaths: (null | readonly string[])[] = [];
      let unsubscribe: (() => void) | null = null;

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

        const api = record.api;
        await api.getLinkTextsSafe(targetPath);

        await app.vault.createFolder(folderPath);
        await app.vault.create(targetPath, '# Bravo\n');
        await app.vault.createBinary(attachmentPath, new Uint8Array([37, 80, 68, 70]).buffer);
        await app.vault.create(sourcePath, sourceContent);

        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the link texts of the new note to be indexed',
          predicate: () => (api.getLinkTexts(attachmentPath) ?? []).length > 0 && (api.getLinkTexts(targetPath) ?? []).length === 2,
          timeoutInMilliseconds: indexWaitMs
        });

        const noteTexts = api.getLinkTexts(targetPath);
        const attachmentTexts = api.getLinkTexts(attachmentPath);

        unsubscribe = api.onLinkTextsChanged((targetPaths) => {
          changedPaths.push(targetPaths);
        });

        const sourceFile = app.vault.getFileByPath(sourcePath);
        if (!sourceFile) {
          return { ...empty, error: 'The source note is missing' };
        }
        await app.vault.modify(sourceFile, editedSourceContent);

        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the edit to reach the link texts',
          predicate: () => api.getLinkTexts(targetPath)?.[0]?.text === 'delta',
          timeoutInMilliseconds: indexWaitMs
        });

        return { attachmentTexts, changedPaths, error: null, noteTexts, noteTextsAfterEdit: api.getLinkTexts(targetPath) };
      } catch (error) {
        return { ...empty, changedPaths, error: String(error) };
      } finally {
        unsubscribe?.();
      }
    },
    input: {
      API_WAIT_IN_MS,
      ATTACHMENT_PATH,
      EDITED_SOURCE_CONTENT,
      FOLDER_PATH,
      INDEX_WAIT_IN_MS,
      POLL_IN_MS,
      SOURCE_CONTENT,
      SOURCE_PATH,
      TARGET_PATH
    },
    vaultPath: getTemporaryVault().path
  });
}
