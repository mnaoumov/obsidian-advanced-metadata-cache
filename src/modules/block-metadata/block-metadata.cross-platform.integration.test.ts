/**
 * @file
 *
 * Integration suite for the `Block metadata` module, against a real Obsidian:
 *
 * - Obsidian's half of the contract: a fence right under a heading is a `code` section of its own, after the
 *   `heading` section, and a fence inside a list item is not a section at all, so it is not read.
 * - A fence describes the heading or block above it, two fences in a row share it, and a fence whose YAML fails is
 *   listed with the reason.
 * - A `[[link]]` written as a property value is a link Obsidian counts, through `Code block links`.
 * - A lookup by property and value follows an edit, a rename and a delete.
 * - Switching the module off answers `null`.
 *
 * Named `*.cross-platform.integration.test.ts` so the desktop AND android projects both collect it.
 */

import type { Pos } from 'obsidian';

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
  readonly getBlockMetadata: (path: string) => BlockMetadata[] | null;
  readonly getBlockMetadataSafe: (path: string) => Promise<BlockMetadata[] | null>;
  readonly getBlockMetadataWithProperty: (propertyName: string, value?: string) => BlockMetadataMatch[] | null;
}

interface BlockMetadata {
  readonly error: null | string;
  readonly position: Pos;
  readonly properties: null | Record<string, unknown>;
  readonly target: BlockMetadataTarget | null;
}

interface BlockMetadataMatch {
  readonly blockMetadata: BlockMetadata;
  readonly path: string;
}

/**
 * What one run of the scenario answered.
 */
interface BlockMetadataResult {
  readonly afterEdits: string[];
  readonly beforeEdits: string[];
  readonly blocks: BlockMetadata[];
  readonly error: null | string;
  readonly linkingPaths: string[];
  readonly sectionTypes: string[];
}

interface BlockMetadataTarget {
  readonly blockId: null | string;
  readonly heading: null | string;
  readonly level: null | number;
  readonly type: string;
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

const FOLDER_PATH = 'block-metadata';
const PLAN_PATH = `${FOLDER_PATH}/plan.md`;
const OTHER_PATH = `${FOLDER_PATH}/other.md`;
const RENAMED_PATH = `${FOLDER_PATH}/renamed.md`;
const TARGET_PATH = `${FOLDER_PATH}/target.md`;
const PLAN_CONTENT = dedent`
  ---
  kind: plan
  ---
  # Tasks

  \`\`\`advanced-metadata-cache
  status: open
  \`\`\`

  \`\`\`advanced-metadata-cache
  owner: me
  \`\`\`

  A paragraph. ^para

  \`\`\`advanced-metadata-cache
  status: [done, archived]
  \`\`\`

  - item

    \`\`\`advanced-metadata-cache
    status: open
    \`\`\`

  ## Broken

  \`\`\`advanced-metadata-cache
  status: [
  \`\`\`\n
`;
const OTHER_CONTENT = dedent`
  # Other

  \`\`\`advanced-metadata-cache
  status: open
  related: "[[target]]"
  \`\`\`\n
`;

const API_WAIT_IN_MS = 5000;
/*
 * Every wait is for work already in flight, so they are generous, not budgets. Their SUM has to stay under the
 * transport's per-command cap, since this closure holds one Runtime.evaluate open for the whole scenario.
 */
const INDEX_WAIT_IN_MS = 7000;
const POLL_IN_MS = 100;
const SCENARIO_TIMEOUT_IN_MS = 120_000;

describe('Block metadata module', () => {
  afterAll(async () => {
    // The vault is shared with every other suite in this project, and the module is off by default.
    await applyPluginSettings({ isBlockMetadataModuleEnabled: false });
  }, SCENARIO_TIMEOUT_IN_MS);

  it('reads each fence with the section above it, and follows edits, renames and deletes', async () => {
    const switchOn = await applyPluginSettings({ isBlockMetadataModuleEnabled: true });
    expect(switchOn.error).toBeNull();

    const result = await runScenario();

    expect(result.error).toBeNull();
    // Obsidian's half: the heading and each top-level fence are sections of their own; the fence in the list item is not.
    expect(result.sectionTypes).toEqual(['yaml', 'heading', 'code', 'code', 'paragraph', 'code', 'list', 'heading', 'code']);
    expect(result.blocks.map((block) => block.properties)).toEqual([{ status: 'open' }, { owner: 'me' }, { status: ['done', 'archived'] }, null]);
    expect(result.blocks.map((block) => block.target)).toMatchObject([
      { heading: 'Tasks', level: 1, type: 'heading' },
      { heading: 'Tasks', level: 1, type: 'heading' },
      { blockId: 'para', heading: null, type: 'paragraph' },
      { heading: 'Broken', level: 2, type: 'heading' }
    ]);
    expect(result.blocks[3]?.error).toEqual(expect.any(String));
    expect(result.beforeEdits).toEqual([OTHER_PATH, PLAN_PATH]);
    expect(result.afterEdits).toEqual([RENAMED_PATH]);
    expect(result.linkingPaths).toEqual([OTHER_PATH]);
  }, SCENARIO_TIMEOUT_IN_MS);

  it('answers null while the module is off', async () => {
    const switchOff = await applyPluginSettings({ isBlockMetadataModuleEnabled: false });
    expect(switchOff.error).toBeNull();

    const result = await evalInObsidian({
      callback() {
        const records = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records;
        const record = (records?.['advanced-metadata-cache'] ?? []).find((candidate) => !candidate.isRevoked);
        return record ? record.api.getBlockMetadataWithProperty('status') : 'no record';
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result).toBeNull();
  }, SCENARIO_TIMEOUT_IN_MS);
});

/**
 * Creates the fixture notes, reads them, edits, renames and deletes, and reads again.
 *
 * @returns What Obsidian and the plugin answered.
 */
async function runScenario(): Promise<BlockMetadataResult> {
  return evalInObsidian({
    async callback({
      API_WAIT_IN_MS: apiWaitMs,
      app,
      FOLDER_PATH: folderPath,
      INDEX_WAIT_IN_MS: indexWaitMs,
      lib: { waitUntil },
      OTHER_CONTENT: otherContent,
      OTHER_PATH: otherPath,
      PLAN_CONTENT: planContent,
      PLAN_PATH: planPath,
      POLL_IN_MS: pollMs,
      RENAMED_PATH: renamedPath,
      TARGET_PATH: targetPath
    }) {
      const empty: BlockMetadataResult = { afterEdits: [], beforeEdits: [], blocks: [], error: null, linkingPaths: [], sectionTypes: [] };

      const existingFolder = app.vault.getAbstractFileByPath(folderPath);
      if (existingFolder) {
        await app.fileManager.trashFile(existingFolder);
      }

      function readLiveRecord(): PluginApiRecord | undefined {
        const records = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records;
        return (records?.['advanced-metadata-cache'] ?? []).find((record) => !record.isRevoked);
      }

      function getOpenPaths(api: AdvancedMetadataCacheApi): string[] {
        return (api.getBlockMetadataWithProperty('status', 'open') ?? []).map((match) => match.path).filter((path) => path.startsWith(`${folderPath}/`));
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

        const api = record.api;
        await api.getBlockMetadataSafe(planPath);

        await app.vault.createFolder(folderPath);
        const planFile = await app.vault.create(planPath, planContent);
        const targetFile = await app.vault.create(targetPath, 'Target');
        const otherFile = await app.vault.create(otherPath, otherContent);
        function getLinkingPaths(): string[] {
          return app.metadataCache.getBacklinksForFile(targetFile).keys();
        }

        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the new notes to be indexed',
          predicate: () => getOpenPaths(api).length === 2 && (api.getBlockMetadata(planPath) ?? []).length === 4 && getLinkingPaths().length === 1,
          timeoutInMilliseconds: indexWaitMs
        });

        const sectionTypes = (app.metadataCache.getFileCache(planFile)?.sections ?? []).map((section) => section.type);
        const blocks = api.getBlockMetadata(planPath) ?? [];
        const beforeEdits = getOpenPaths(api);
        const linkingPaths = getLinkingPaths();

        await app.vault.modify(planFile, planContent.replace('status: open', 'status: done'));
        await app.fileManager.renameFile(otherFile, renamedPath);

        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the edit and the rename to reach the index',
          predicate: () => JSON.stringify(getOpenPaths(api)) === JSON.stringify([renamedPath]),
          timeoutInMilliseconds: indexWaitMs
        });

        const afterEdits = getOpenPaths(api);

        await app.fileManager.trashFile(otherFile);
        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the delete to reach the index',
          predicate: () => getOpenPaths(api).length === 0,
          timeoutInMilliseconds: indexWaitMs
        });

        return { afterEdits, beforeEdits, blocks, error: null, linkingPaths, sectionTypes };
      } catch (error) {
        return { ...empty, error: String(error) };
      }
    },
    input: {
      API_WAIT_IN_MS,
      FOLDER_PATH,
      INDEX_WAIT_IN_MS,
      OTHER_CONTENT,
      OTHER_PATH,
      PLAN_CONTENT,
      PLAN_PATH,
      POLL_IN_MS,
      RENAMED_PATH,
      TARGET_PATH
    },
    vaultPath: getTemporaryVault().path
  });
}
