/**
 * @file
 *
 * Parity guard for the `Unlinked mentions` module, against a real Obsidian: the Backlinks pane's `Unlinked mentions`
 * section lists the same notes and the same spans whether Obsidian fills it by its own full scan (module off) or the
 * module fills it from its index (module on), and the published `getUnlinkedMentions` answers the same.
 *
 * The corpus is chosen to hit each rule the module restates: case folding without diacritic folding, whole-word
 * edges for a name that starts and ends with a letter and none for one that ends with `+`, Cyrillic as word
 * characters and CJK as not, spans hidden inside a wikilink, a markdown link, an embed and the frontmatter, spans
 * counted inside code, and the same words joined by a different separator, which the index offers as a candidate and
 * the exact match then rejects.
 */

// cspell:words Ünlinked ünlinked Тесту тесту тестуы

import type { BacklinkView } from '@obsidian-typings/obsidian-public-latest';

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
 * The published API member this suite calls, as `api.d.ts` declares it.
 */
interface AdvancedMetadataCacheApi {
  getUnlinkedMentions: (pathOrFile: string) => Promise<null | UnlinkedMention[]>;
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
 * What the pane showed for one note: each mentioning note's path and its spans, in the pane's own order of spans.
 */
interface SectionResult {
  readonly error: null | string;

  /**
   * Whether Obsidian's own scan filled the section: it leaves its queue behind, which the module never creates.
   */
  readonly isFilledByObsidianScan: boolean;
  readonly results: [string, [number, number][]][];
}

interface UnlinkedMention {
  readonly path: string;
  readonly ranges: readonly UnlinkedMentionRange[];
}

interface UnlinkedMentionRange {
  readonly end: number;
  readonly start: number;
}

/**
 * The backlinks component's queue, which the typings declare as always `null`: Obsidian's own scan sets it.
 */
interface UnlinkedQueueHolder {
  readonly unlinkedQueue: unknown;
}

const FOLDER = 'unlinked-parity';
const TARGET_PATHS = [`${FOLDER}/Ünlinked Target.md`, `${FOLDER}/Index.md`];
const NOTES: Record<string, string> = {
  'cjk.md': '東京タワー and 京東\n',
  'code.md': '```\nUnlinked target UT index\n```\n`UT` and `index`\n',
  'cpp.md': 'I like C++ and C++x and xC++\n',
  'cyrillic.md': 'мир тесту! Мир тестуы\n',
  'frontmatter.md': '---\ntopic: Ünlinked Target\nindex: UT\n---\nbody UT\n',
  'Index.md': '',
  'links.md': '[[Ünlinked Target]] and [ünlinked target](Ünlinked%20Target.md) and ![[Ünlinked Target]] ut [[Index|the index]] index\n',
  'partial.md': 'UTF and outset and butter. UT. Indexes, reindex, INDEX\n',
  'plain.md': 'We discuss ünlinked target, ÜNLINKED TARGET and unlinked target here.\n',
  'separator.md': 'Ünlinked-Target, Ünlinked  Target\n',
  'Ünlinked Target.md': '---\naliases:\n  - UT\n  - Мир Тесту\n  - 東京\n  - C++\n---\n'
};

const SETTLE_IN_MS = 4000;
const SCENARIO_TIMEOUT_IN_MS = 180_000;
const PLUGIN_ID = 'advanced-metadata-cache';

describe('Unlinked mentions module', () => {
  beforeAll(async () => {
    const switchOff = await applyPluginSettings({ isUnlinkedMentionsModuleEnabled: false });
    expect(switchOff.error).toBeNull();

    await evalInObsidian({
      async callback({ app, FOLDER: folder, NOTES: notes }) {
        if (!app.vault.getFolderByPath(folder)) {
          await app.vault.createFolder(folder);
        }

        for (const [name, content] of Object.entries(notes)) {
          const path = `${folder}/${name}`;
          const file = app.vault.getFileByPath(path);
          if (file) {
            await app.vault.modify(file, content);
          } else {
            await app.vault.create(path, content);
          }
        }
      },
      input: { FOLDER, NOTES },
      vaultPath: getTemporaryVault().path
    });
  }, SCENARIO_TIMEOUT_IN_MS);

  afterAll(async () => {
    // The vault is shared with every other suite in this project, and the module is off by default.
    await applyPluginSettings({ isUnlinkedMentionsModuleEnabled: false });
  }, SCENARIO_TIMEOUT_IN_MS);

  it('fills the Unlinked mentions section exactly as Obsidian does, and the API agrees', async () => {
    const builtIn = await readSections();

    const switchOn = await applyPluginSettings({ isUnlinkedMentionsModuleEnabled: true });
    expect(switchOn.error).toBeNull();

    const apiResults = await readApi();
    const indexed = await readSections();

    for (const [index, targetPath] of TARGET_PATHS.entries()) {
      const builtInSection = builtIn[index];
      expect(builtInSection?.error, targetPath).toBeNull();
      expect(indexed[index]?.error, targetPath).toBeNull();
      expect(builtInSection?.results.length, `${targetPath} found nothing to compare`).toBeGreaterThan(0);
      expect(builtInSection?.isFilledByObsidianScan, targetPath).toBe(true);
      expect(indexed[index]?.isFilledByObsidianScan, targetPath).toBe(false);
      expect(indexed[index]?.results, targetPath).toEqual(builtInSection?.results);
      const apiResultsInCorpus = apiResults[index]?.filter((unlinkedMention) => unlinkedMention.path.startsWith(`${FOLDER}/`));
      expect(apiResultsInCorpus, targetPath).toEqual(toApiShape(builtInSection?.results ?? []));
    }
  }, SCENARIO_TIMEOUT_IN_MS);
});

async function readApi(): Promise<(null | UnlinkedMention[])[]> {
  return evalInObsidian({
    async callback({ PLUGIN_ID: pluginId, TARGET_PATHS: targetPaths }) {
      const record = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records?.[pluginId]?.find((candidate) => !candidate.isRevoked);
      if (!record) {
        return [];
      }

      const answers: (null | UnlinkedMention[])[] = [];
      for (const targetPath of targetPaths) {
        answers.push(await record.api.getUnlinkedMentions(targetPath));
      }

      return answers;
    },
    input: { PLUGIN_ID, TARGET_PATHS },
    vaultPath: getTemporaryVault().path
  });
}

async function readSections(): Promise<SectionResult[]> {
  return evalInObsidian({
    async callback({ app, SETTLE_IN_MS: settleInMs, TARGET_PATHS: targetPaths }) {
      const sections: SectionResult[] = [];
      for (const targetPath of targetPaths) {
        const file = app.vault.getFileByPath(targetPath);
        if (!file) {
          sections.push({ error: `${targetPath} not found`, isFilledByObsidianScan: false, results: [] });
          continue;
        }

        await app.workspace.getLeaf(false).openFile(file);
        app.internalPlugins.getPluginById('backlink')?.instance.openBacklinksForActiveFile(true);
        await sleep(settleInMs);

        const backlinkLeaf = app.workspace.getLeavesOfType('backlink')[0];
        if (!backlinkLeaf) {
          sections.push({ error: 'No backlink side panel leaf', isFilledByObsidianScan: false, results: [] });
          continue;
        }

        const backlinkComponent = (backlinkLeaf.view as BacklinkView).backlink;
        await backlinkComponent.setUnlinkedCollapsed(false, false);
        backlinkComponent.recomputeUnlinked(file);
        await sleep(settleInMs);

        const results = [...backlinkComponent.unlinkedDom.resultDomLookup]
          .map(([resultFile, item]): [string, [number, number][]] => [resultFile.path, (item.result.content ?? []).map(([start, end]): [number, number] => [start, end])])
          .filter(([path]) => path.startsWith('unlinked-parity/'))
          // By code unit, the order the API answers in.
          .sort(([a], [b]) => Number(a > b) - Number(a < b));
        const unlinkedQueueHolder: UnlinkedQueueHolder = backlinkComponent;
        const isFilledByObsidianScan = unlinkedQueueHolder.unlinkedQueue !== null;
        sections.push({ error: null, isFilledByObsidianScan, results });
      }

      return sections;
    },
    input: { SETTLE_IN_MS, TARGET_PATHS },
    vaultPath: getTemporaryVault().path
  });
}

function toApiShape(results: [string, [number, number][]][]): UnlinkedMention[] {
  return results.map(([path, ranges]) => {
    const sorted = [...ranges].sort(([startA, endA], [startB, endB]) => startA - startB || endA - endB);
    const uniqueKeys = new Set(sorted.map(([start, end]) => `${String(start)}:${String(end)}`));
    return { path, ranges: [...uniqueKeys].map((key) => key.split(':').map(Number)).map(([start = 0, end = 0]) => ({ end, start })) };
  });
}
