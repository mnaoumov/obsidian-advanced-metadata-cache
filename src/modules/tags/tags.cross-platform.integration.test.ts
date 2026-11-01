/**
 * @file
 *
 * Integration suite for the `Tags` module, against a real Obsidian:
 *
 * - A tag written in the body and one in the `tags` property are both found, apart and together, in any casing, and
 *   a nested tag answers for its parent unless the exact tag is asked for.
 * - After an edit, a rename and a delete, every answer equals a full scan of the metadata cache.
 * - Switching the module off answers `null`.
 *
 * Named `*.cross-platform.integration.test.ts` so the desktop AND android projects both collect it: none of this is
 * platform-specific, and the API is the one a consumer calls on either.
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
  readonly getPathsWithTag: (tag: string, options?: TagQueryOptions) => null | string[];
  readonly getPathsWithTagSafe: (tag: string, options?: TagQueryOptions) => Promise<null | string[]>;
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
 * One query's answer from the index, beside the same question answered by a full scan of the metadata cache.
 */
interface QueryComparison {
  readonly indexed: null | string[];
  readonly query: string;
  readonly scanned: string[];
}

interface TagQueryOptions {
  readonly shouldIncludeNestedTags?: boolean;
  readonly source?: 'body' | 'frontmatter';
}

/**
 * What one run of the scenario answered.
 */
interface TagsResult {
  readonly afterEdits: QueryComparison[];
  readonly beforeEdits: QueryComparison[];
  readonly error: null | string;
}

const FOLDER_PATH = 'tags';
const BODY_PATH = `${FOLDER_PATH}/body.md`;
const FRONTMATTER_PATH = `${FOLDER_PATH}/frontmatter.md`;
const NESTED_PATH = `${FOLDER_PATH}/nested.md`;
const RENAMED_PATH = `${FOLDER_PATH}/renamed.md`;
const BODY_CONTENT = 'Planning #Project and #area/home\n';
const FRONTMATTER_CONTENT = dedent`
  ---
  tags:
    - project
    - reading
  ---
  No body tags here.\n
`;
const NESTED_CONTENT = 'Only #project/alpha\n';
const EDITED_BODY_CONTENT = 'Now only #reading\n';

/*
 * Every wait is for work already in flight, so they are generous, not budgets. Their SUM has to stay under the
 * transport's per-command cap, since this closure holds one `Runtime.evaluate` open for the whole scenario.
 */
const API_WAIT_IN_MS = 5000;
const INDEX_WAIT_IN_MS = 10_000;
const POLL_IN_MS = 100;
const SCENARIO_TIMEOUT_IN_MS = 120_000;

describe('Tags module', () => {
  afterAll(async () => {
    // The vault is shared with every other suite in this project, and the module is off by default.
    await applyPluginSettings({ isTagsModuleEnabled: false });
  }, SCENARIO_TIMEOUT_IN_MS);

  it('answers which notes carry a tag, by source and nesting, matching a full scan after edits', async () => {
    const switchOn = await applyPluginSettings({ isTagsModuleEnabled: true });
    expect(switchOn.error).toBeNull();

    const result = await runScenario();

    expect(result.error).toBeNull();
    expect(result.beforeEdits.find((comparison) => comparison.query === '#PROJECT any nested')?.indexed).toEqual([BODY_PATH, FRONTMATTER_PATH, NESTED_PATH]);
    expect(result.beforeEdits.find((comparison) => comparison.query === 'project any exact')?.indexed).toEqual([BODY_PATH, FRONTMATTER_PATH]);
    expect(result.beforeEdits.find((comparison) => comparison.query === 'project frontmatter nested')?.indexed).toEqual([FRONTMATTER_PATH]);
    expect(result.afterEdits.find((comparison) => comparison.query === 'reading body nested')?.indexed).toEqual([RENAMED_PATH]);

    for (const comparison of [...result.beforeEdits, ...result.afterEdits]) {
      expect(comparison.indexed, comparison.query).toEqual(comparison.scanned);
    }
  }, SCENARIO_TIMEOUT_IN_MS);

  it('answers null while the module is off', async () => {
    const switchOff = await applyPluginSettings({ isTagsModuleEnabled: false });
    expect(switchOff.error).toBeNull();

    const result = await evalInObsidian({
      callback() {
        const records = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records;
        const record = (records?.['advanced-metadata-cache'] ?? []).find((candidate) => !candidate.isRevoked);
        return record ? record.api.getPathsWithTag('project') : 'no record';
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result).toBeNull();
  }, SCENARIO_TIMEOUT_IN_MS);
});

/**
 * Creates the fixture notes, compares the index with a full scan, edits, renames and deletes, and compares again.
 *
 * @returns What the plugin answered, and what the scan answered.
 */
async function runScenario(): Promise<TagsResult> {
  return evalInObsidian({
    async callback({
      API_WAIT_IN_MS: apiWaitMs,
      app,
      BODY_CONTENT: bodyContent,
      BODY_PATH: bodyPath,
      EDITED_BODY_CONTENT: editedBodyContent,
      FOLDER_PATH: folderPath,
      FRONTMATTER_CONTENT: frontmatterContent,
      FRONTMATTER_PATH: frontmatterPath,
      INDEX_WAIT_IN_MS: indexWaitMs,
      lib: { waitUntil },
      NESTED_CONTENT: nestedContent,
      NESTED_PATH: nestedPath,
      POLL_IN_MS: pollMs,
      RENAMED_PATH: renamedPath
    }) {
      const empty: TagsResult = { afterEdits: [], beforeEdits: [], error: null };
      const tags = ['#PROJECT', 'project', 'project/alpha', 'area', 'reading'];
      const sources: ('any' | 'body' | 'frontmatter')[] = ['any', 'body', 'frontmatter'];

      const existingFolder = app.vault.getAbstractFileByPath(folderPath);
      if (existingFolder) {
        await app.fileManager.trashFile(existingFolder);
      }

      function readLiveRecord(): PluginApiRecord | undefined {
        const records = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records;
        return (records?.['advanced-metadata-cache'] ?? []).find((record) => !record.isRevoked);
      }

      function normalize(tag: string): string {
        return (tag.startsWith('#') ? tag.slice(1) : tag).toLowerCase();
      }

      // The question answered the slow way: every note of the fixture folder, read from the metadata cache.
      function scan(tag: string, source: 'any' | 'body' | 'frontmatter', shouldIncludeNestedTags: boolean): string[] {
        const wanted = normalize(tag);
        function isMatch(candidate: string): boolean {
          const normalized = normalize(candidate);
          return normalized === wanted || (shouldIncludeNestedTags && normalized.startsWith(`${wanted}/`));
        }

        return app.vault.getMarkdownFiles()
          .filter((file) => file.path.startsWith(`${folderPath}/`))
          .filter((file) => {
            const cache = app.metadataCache.getFileCache(file);
            const bodyTags = (cache?.tags ?? []).map((tagCache) => tagCache.tag);
            const frontmatterValue: unknown = cache?.frontmatter?.['tags'];
            const frontmatterTags = Array.isArray(frontmatterValue) ? frontmatterValue.map(String) : [];
            return (source !== 'frontmatter' && bodyTags.some((candidate) => isMatch(candidate))) || (source !== 'body' && frontmatterTags.some((candidate) => isMatch(candidate)));
          })
          .map((file) => file.path)
          .sort();
      }

      function compareAll(api: AdvancedMetadataCacheApi): QueryComparison[] {
        const comparisons: QueryComparison[] = [];
        for (const tag of tags) {
          for (const source of sources) {
            for (const shouldIncludeNestedTags of [true, false]) {
              const options: TagQueryOptions = source === 'any' ? { shouldIncludeNestedTags } : { shouldIncludeNestedTags, source };
              comparisons.push({
                indexed: api.getPathsWithTag(tag, options)?.filter((path) => path.startsWith(`${folderPath}/`)) ?? null,
                query: `${tag} ${source} ${shouldIncludeNestedTags ? 'nested' : 'exact'}`,
                scanned: scan(tag, source, shouldIncludeNestedTags)
              });
            }
          }
        }
        return comparisons;
      }

      function isInStep(api: AdvancedMetadataCacheApi): boolean {
        return compareAll(api).every((comparison) => JSON.stringify(comparison.indexed) === JSON.stringify(comparison.scanned));
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
        await api.getPathsWithTagSafe('project');

        await app.vault.createFolder(folderPath);
        const bodyFile = await app.vault.create(bodyPath, bodyContent);
        await app.vault.create(frontmatterPath, frontmatterContent);
        const nestedFile = await app.vault.create(nestedPath, nestedContent);

        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the new notes to be indexed',
          predicate: () => (api.getPathsWithTag('project')?.filter((path) => path.startsWith(`${folderPath}/`)) ?? []).length === 3 && isInStep(api),
          timeoutInMilliseconds: indexWaitMs
        });

        const beforeEdits = compareAll(api);

        await app.vault.modify(bodyFile, editedBodyContent);
        await app.fileManager.renameFile(bodyFile, renamedPath);
        await app.fileManager.trashFile(nestedFile);

        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the edit, the rename and the delete to reach the index',
          predicate: () => (api.getPathsWithTag('reading') ?? []).includes(renamedPath) && isInStep(api),
          timeoutInMilliseconds: indexWaitMs
        });

        return { afterEdits: compareAll(api), beforeEdits, error: null };
      } catch (error) {
        return { ...empty, error: String(error) };
      }
    },
    input: {
      API_WAIT_IN_MS,
      BODY_CONTENT,
      BODY_PATH,
      EDITED_BODY_CONTENT,
      FOLDER_PATH,
      FRONTMATTER_CONTENT,
      FRONTMATTER_PATH,
      INDEX_WAIT_IN_MS,
      NESTED_CONTENT,
      NESTED_PATH,
      POLL_IN_MS,
      RENAMED_PATH
    },
    vaultPath: getTemporaryVault().path
  });
}
