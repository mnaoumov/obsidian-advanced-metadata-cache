/**
 * @file
 *
 * Integration suite for `getUnresolvedBacklinks` and its `Safe` variant (contract `1.12.0`) in a real Obsidian:
 * the notes linking to a name no file answers to, followed through a create, an edit, a rename and a delete of the
 * source, and through the target being created and deleted again.
 *
 * Each step is one `evalInObsidian` closure, so no closure waits longer than the transport allows.
 *
 * Named `*.cross-platform.integration.test.ts`, so the desktop AND android projects both collect it.
 */

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

/**
 * The slice of the published API this suite calls, declared here because an `evalInObsidian` closure cannot carry
 * a value across.
 */
interface AdvancedMetadataCacheApi {
  readonly getUnresolvedBacklinks: (linkPath: string) => BacklinksDict | null;
  readonly getUnresolvedBacklinksSafe: (linkPath: string) => Promise<BacklinksDict | null>;
}

interface BacklinksDict {
  readonly get: (key: string) => null | ReferenceShape[];
  readonly keys: () => string[];
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

interface ReferenceShape {
  readonly link: string;
}

type Step = 'create-source' | 'create-target' | 'delete-source' | 'delete-target' | 'edit-source' | 'rename-source';

interface StepParams {
  readonly expectedLines: string[];
  readonly step: Step;
}

/**
 * What one step answered, projected to something JSON can carry back.
 */
interface StepResult {
  readonly error: null | string;
  readonly fastLines: string[];
  readonly lines: string[];
}

const SOURCE_PATH = 'unresolved-backlinks-source.md';
const RENAMED_SOURCE_PATH = 'unresolved-backlinks-renamed.md';
const TARGET_BASENAME = 'unresolved-backlinks-ghost';
const EDITED_LINK = 'Unresolved-Backlinks-Ghost.md#Plan';

const API_WAIT_IN_MS = 5000;
const STEP_WAIT_IN_MS = 10_000;
const POLL_IN_MS = 100;
const SCENARIO_TIMEOUT_IN_MS = 120_000;

describe('getUnresolvedBacklinks', () => {
  it('follows the source and the target through create, edit, rename and delete', async () => {
    const created = await runStep({ expectedLines: [`${SOURCE_PATH}: ${TARGET_BASENAME}`], step: 'create-source' });
    expect(created.error).toBeNull();
    // The fast variant, asked in another casing, gives the same answer once the Safe one has.
    expect(created.fastLines).toEqual(created.lines);

    for (
      const [step, expectedLines] of [
        ['edit-source', getBothLines(SOURCE_PATH)],
        ['create-target', []],
        ['delete-target', getBothLines(SOURCE_PATH)],
        ['rename-source', getBothLines(RENAMED_SOURCE_PATH)],
        ['delete-source', []]
      ] satisfies [Step, string[]][]
    ) {
      const result = await runStep({ expectedLines, step });
      expect(result.error, step).toBeNull();
      expect(result.lines, step).toEqual(expectedLines);
    }
  }, SCENARIO_TIMEOUT_IN_MS);
});

/**
 * The two lines a source answers with once it carries both links.
 *
 * @param sourcePath - The path of the source.
 * @returns The lines.
 */
function getBothLines(sourcePath: string): string[] {
  return [`${sourcePath}: ${TARGET_BASENAME}`, `${sourcePath}: ${EDITED_LINK}`];
}

/**
 * Takes one step, then waits for the `Safe` answer to be the expected one.
 *
 * @param params - The step and the answer to wait for.
 * @returns What the plugin answered.
 */
async function runStep(params: StepParams): Promise<StepResult> {
  return evalInObsidian({
    async callback({
      API_WAIT_IN_MS: apiWaitMs,
      app,
      EDITED_LINK: editedLink,
      EXPECTED_LINES: expectedLines,
      lib: { waitUntil },
      POLL_IN_MS: pollMs,
      RENAMED_SOURCE_PATH: renamedSourcePath,
      SOURCE_PATH: sourcePath,
      STEP: step,
      STEP_WAIT_IN_MS: stepWaitMs,
      TARGET_BASENAME: targetBasename
    }) {
      const targetPath = `${targetBasename}.md`;
      let lines: string[] = [];

      /**
       * Reads this plugin's live API record straight out of the published registry.
       *
       * @returns The record, or nothing while none is published.
       */
      function readLiveRecord(): PluginApiRecord | undefined {
        const records = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records;
        return (records?.['advanced-metadata-cache'] ?? []).find((record) => !record.isRevoked);
      }

      /**
       * Projects an answer to `<source>: <link>` lines, in source order and then in reference order.
       *
       * @param dict - The answer.
       * @returns The lines.
       */
      function linesOf(dict: BacklinksDict | null): string[] {
        return (dict?.keys() ?? []).flatMap((key) => (dict?.get(key) ?? []).map((reference) => `${key}: ${reference.link}`));
      }

      /**
       * Moves a file to the trash when it exists.
       *
       * @param path - The vault-relative path.
       */
      async function trashIfExists(path: string): Promise<void> {
        const file = app.vault.getAbstractFileByPath(path);
        if (file) {
          await app.fileManager.trashFile(file);
        }
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
          return { error: 'No live API record', fastLines: [], lines };
        }

        const source = app.vault.getFileByPath(sourcePath);

        switch (step) {
          case 'create-source': {
            for (const path of [sourcePath, renamedSourcePath, targetPath]) {
              await trashIfExists(path);
            }
            await app.vault.create(sourcePath, `Link to [[${targetBasename}]].`);
            break;
          }
          case 'create-target': {
            await app.vault.create(targetPath, '# Ghost\n');
            break;
          }
          case 'delete-source': {
            await trashIfExists(renamedSourcePath);
            break;
          }
          case 'delete-target': {
            await trashIfExists(targetPath);
            break;
          }
          case 'edit-source': {
            if (source) {
              await app.vault.modify(source, `Link to [[${targetBasename}]] and [[${editedLink}|plan]].`);
            }
            break;
          }
          case 'rename-source': {
            if (source) {
              await app.fileManager.renameFile(source, renamedSourcePath);
            }
            break;
          }
          default: {
            return { error: `Unknown step ${String(step)}`, fastLines: [], lines };
          }
        }

        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: `the answer after ${step}`,
          predicate: async () => {
            lines = linesOf(await api.getUnresolvedBacklinksSafe(targetBasename));
            return JSON.stringify(lines) === JSON.stringify(expectedLines);
          },
          timeoutInMilliseconds: stepWaitMs
        });

        return { error: null, fastLines: linesOf(api.getUnresolvedBacklinks(targetBasename.toUpperCase())), lines };
      } catch (error) {
        return { error: `${String(error)}; last answer: ${JSON.stringify(lines)}`, fastLines: [], lines };
      }
    },
    input: {
      API_WAIT_IN_MS,
      EDITED_LINK,
      EXPECTED_LINES: params.expectedLines,
      POLL_IN_MS,
      RENAMED_SOURCE_PATH,
      SOURCE_PATH,
      STEP: params.step,
      STEP_WAIT_IN_MS,
      TARGET_BASENAME
    },
    vaultPath: getTemporaryVault().path
  });
}
