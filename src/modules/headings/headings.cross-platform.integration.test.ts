/**
 * @file
 *
 * Integration suite for the `Headings` module, against a real Obsidian:
 *
 * - A note created while the module is on has every heading stamped `created` and `modified`.
 * - Moving a section does not make it modified; renaming its heading keeps its `created` and makes it
 *   modified; a heading added later is created later.
 * - Renaming the note takes the history with it.
 * - Switching the module off saves the index to `heading-times.json` in the plugin folder and takes the
 *   answer away.
 *
 * The `seen` time is not driven here: it needs the window to have focus, which a test transport cannot
 * give a real Obsidian reliably, and its arithmetic is covered by the unit suites.
 *
 * Named `*.cross-platform.integration.test.ts` so the desktop AND android projects both collect it: the
 * API is the one a consumer calls on either.
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

import { applyPluginSettings } from '../../../scripts/helpers/names-module.ts';

/**
 * The published API, as a consumer compiles against it - the slice of the root `api.d.ts` this suite
 * calls. Declared here because an `evalInObsidian` closure cannot carry a value across.
 */
interface AdvancedMetadataCacheApi {
  getHeadingTimes: (pathOrFile: string) => HeadingTimes[];
}

interface HeadingsModuleSettings {
  isHeadingsModuleEnabled: boolean;
}

/**
 * What one run of the scenario answered.
 */
interface HeadingsResult {
  readonly afterAdd: HeadingTimes[];
  readonly afterEdit: HeadingTimes[];
  readonly afterNoteRename: HeadingTimes[];
  readonly created: HeadingTimes[];
  readonly error: null | string;
  readonly savedJson: string;
}

interface HeadingsSettingsComponent {
  editAndSave: (editor: (settings: HeadingsModuleSettings) => void) => Promise<void>;
}

interface HeadingTimes {
  readonly created: null | number;
  readonly heading: string;
  readonly level: number;
  readonly line: number;
  readonly modified: null | number;
  readonly seen: null | number;
}

interface ObsidianDevUtilsStateBag {
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
  readonly __obsidianDevUtils?: ObsidianDevUtilsStateBag;
}

interface PluginApiRegistryWrapper {
  readonly value?: PluginApiRegistry;
}

interface PluginManifestWithFolder {
  // eslint-disable-next-line unicorn/name-replacements -- Obsidian's own PluginManifest member.
  readonly dir?: string;
}

interface SettingsPlugin {
  readonly manifest: PluginManifestWithFolder;
  readonly pluginSettingsComponent: HeadingsSettingsComponent;
}

const NOTE_PATH = 'headings-target.md';
const RENAMED_NOTE_PATH = 'headings-target-renamed.md';
const CREATED_CONTENT = '# Alpha\nalpha body\n\n# Beta\nbeta body\n';
const EDITED_CONTENT = '# Beta renamed\nbeta body\n\n# Alpha\nalpha body\n';
const ADDED_CONTENT = '# Beta renamed\nbeta body\n\n# Alpha\nalpha body\n\n# Gamma\ngamma body\n';

/*
 * Every wait is for work already in flight, so they are generous rather than budgets. Their sum has to
 * stay under the transport's per-command cap, since the closure holds one `Runtime.evaluate` open.
 */
const API_WAIT_IN_MS = 2000;
const PARSE_WAIT_IN_MS = 5000;
const POLL_IN_MS = 100;
const SCENARIO_TIMEOUT_IN_MS = 120_000;

describe('Headings module', () => {
  beforeAll(async () => {
    const result = await applyPluginSettings({ isHeadingsModuleEnabled: true });
    expect(result.error).toBeNull();
  }, SCENARIO_TIMEOUT_IN_MS);

  afterAll(async () => {
    // The vault is shared with every other suite in this project, and the module is off by default.
    await applyPluginSettings({ isHeadingsModuleEnabled: false });
  }, SCENARIO_TIMEOUT_IN_MS);

  it('tracks created and modified times across a move, a rename, an addition and a note rename', async () => {
    const result = await runScenario();

    expect(result.error).toBeNull();

    const [alpha, beta] = result.created;
    expect(result.created.map((heading) => heading.heading)).toEqual(['Alpha', 'Beta']);
    expect(alpha?.created).toEqual(expect.any(Number));
    expect(alpha?.modified).toBe(alpha?.created);
    expect(beta?.created).toEqual(expect.any(Number));

    const [betaRenamed, alphaMoved] = result.afterEdit;
    expect(result.afterEdit.map((heading) => heading.heading)).toEqual(['Beta renamed', 'Alpha']);
    // Moved, its own text untouched: the same heading, and not modified.
    expect(alphaMoved?.created).toBe(alpha?.created);
    expect(alphaMoved?.modified).toBe(alpha?.modified);
    // Renamed in the same edit, recognized by its body: the same heading, and modified.
    expect(betaRenamed?.created).toBe(beta?.created);
    expect(betaRenamed?.modified).toBeGreaterThan(beta?.modified ?? Infinity);

    const gamma = result.afterAdd[2];
    expect(gamma?.heading).toBe('Gamma');
    expect(gamma?.created).toBeGreaterThan(betaRenamed?.modified ?? Infinity);
    expect(result.afterAdd[1]?.created).toBe(alpha?.created);

    expect(result.afterNoteRename).toEqual(result.afterAdd);

    expect(result.savedJson).toContain(RENAMED_NOTE_PATH);
    expect(result.savedJson).not.toContain(`"${NOTE_PATH}"`);
  }, SCENARIO_TIMEOUT_IN_MS);
});

/**
 * Creates the fixture note, edits it the ways the module claims to follow, and reads the answer after
 * each step.
 *
 * @returns What the plugin answered.
 */
async function runScenario(): Promise<HeadingsResult> {
  return evalInObsidian({
    async callback({
      ADDED_CONTENT: addedContent,
      API_WAIT_IN_MS: apiWaitMs,
      app,
      CREATED_CONTENT: createdContent,
      EDITED_CONTENT: editedContent,
      lib: { waitUntil },
      NOTE_PATH: notePath,
      PARSE_WAIT_IN_MS: parseWaitMs,
      POLL_IN_MS: pollMs,
      RENAMED_NOTE_PATH: renamedNotePath
    }) {
      const empty: HeadingsResult = {
        afterAdd: [],
        afterEdit: [],
        afterNoteRename: [],
        created: [],
        error: null,
        savedJson: ''
      };

      for (const path of [notePath, renamedNotePath]) {
        const existing = app.vault.getAbstractFileByPath(path);

        if (existing) {
          await app.fileManager.trashFile(existing);
        }
      }

      function readLiveRecord(): PluginApiRecord | undefined {
        const records = (window as PluginApiRegistryHolder).__obsidianDevUtils?.pluginApiRegistry?.value?.records;
        return (records?.['advanced-metadata-cache'] ?? []).find((record) => !record.isRevoked);
      }

      async function waitForHeadings(api: AdvancedMetadataCacheApi, path: string, headings: readonly string[]): Promise<HeadingTimes[]> {
        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: `the headings of ${path} to read ${headings.join(', ')}`,
          predicate: () => api.getHeadingTimes(path).map((heading) => heading.heading).join('\n') === headings.join('\n'),
          timeoutInMilliseconds: parseWaitMs
        });

        return api.getHeadingTimes(path);
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

        if (!record.apiVersion.startsWith('1.') || Number(record.apiVersion.split('.', 2)[1]) < 2) {
          return { ...empty, error: `Unexpected API contract version ${record.apiVersion}` };
        }

        const api = record.api;
        const file = await app.vault.create(notePath, createdContent);
        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the new note`s headings to be stamped',
          predicate: () => api.getHeadingTimes(notePath).length === 2 && api.getHeadingTimes(notePath).every((heading) => heading.created !== null),
          timeoutInMilliseconds: parseWaitMs
        });
        const created = api.getHeadingTimes(notePath);

        await app.vault.modify(file, editedContent);
        const afterEdit = await waitForHeadings(api, notePath, ['Beta renamed', 'Alpha']);

        await app.vault.modify(file, addedContent);
        const afterAdd = await waitForHeadings(api, notePath, ['Beta renamed', 'Alpha', 'Gamma']);

        await app.fileManager.renameFile(file, renamedNotePath);
        const afterNoteRename = await waitForHeadings(api, renamedNotePath, ['Beta renamed', 'Alpha', 'Gamma']);

        // Switching the module off writes what it holds; the suite's `afterAll` would do it too, but the
        // file has to be read from inside this closure.
        const plugin = app.plugins.getPlugin('advanced-metadata-cache') as null | SettingsPlugin;

        if (!plugin?.manifest.dir) {
          return { ...empty, error: 'Plugin not loaded' };
        }

        await plugin.pluginSettingsComponent.editAndSave((settings) => {
          settings.isHeadingsModuleEnabled = false;
        });
        const dataFilePath = `${plugin.manifest.dir}/heading-times.json`;
        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the index to be saved',
          predicate: async () => {
            if (!await app.vault.adapter.exists(dataFilePath)) {
              return false;
            }

            const json = await app.vault.adapter.read(dataFilePath);
            return json.includes(renamedNotePath);
          },
          timeoutInMilliseconds: parseWaitMs
        });
        const savedJson = await app.vault.adapter.read(dataFilePath);
        const isAnswerGone = api.getHeadingTimes(renamedNotePath).length === 0;

        await plugin.pluginSettingsComponent.editAndSave((settings) => {
          settings.isHeadingsModuleEnabled = true;
        });

        return isAnswerGone
          ? { afterAdd, afterEdit, afterNoteRename, created, error: null, savedJson }
          : { ...empty, error: 'The module answered while off' };
      } catch (error) {
        return { ...empty, error: String(error) };
      }
    },
    input: {
      ADDED_CONTENT,
      API_WAIT_IN_MS,
      CREATED_CONTENT,
      EDITED_CONTENT,
      NOTE_PATH,
      PARSE_WAIT_IN_MS,
      POLL_IN_MS,
      RENAMED_NOTE_PATH
    },
    vaultPath: getTemporaryVault().path
  });
}
