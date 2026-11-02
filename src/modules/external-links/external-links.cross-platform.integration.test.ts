/**
 * @file
 *
 * Integration suite for the `External links` module, against a real Obsidian:
 *
 * - A bare URL, a markdown link and a URL property are all found, normalized, by URL and by host, and a URL inside
 *   a code block is not.
 * - After an edit, a rename and a delete, every answer equals a full scan of the notes' text.
 * - Similar hosts and the host and URL lists answer from the same index.
 * - Switching the module off answers `null`.
 *
 * Named `*.cross-platform.integration.test.ts` so the desktop AND android projects both collect it: none of this is
 * platform-specific, and the API is the one a consumer calls on either.
 */

/* eslint-disable unicorn/prefer-https -- An http URL is part of what is under test: http and https must count as one. */
// cspell:ignore exmaple -- The deliberate typo of a host the suite asks similar hosts about.

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
  readonly getExternalLinkHosts: () => ExternalHostUsage[] | null;
  readonly getExternalLinks: (path: string) => ExternalLink[] | null;
  readonly getExternalLinkUrls: (host?: string) => ExternalUrlUsage[] | null;
  readonly getPathsLinkingToHost: (host: string, options?: HostQueryOptions) => null | string[];
  readonly getPathsLinkingToHostSafe: (host: string) => Promise<null | string[]>;
  readonly getPathsLinkingToUrl: (url: string) => null | string[];
  readonly getSimilarHosts: (host: string) => null | SimilarHost[];
}

interface ExternalHostUsage {
  readonly host: string;
  readonly noteCount: number;
}

interface ExternalLink {
  readonly host: string;
  readonly isInFrontmatter: boolean;
  readonly normalizedUrl: string;
  readonly url: string;
}

/**
 * What one run of the scenario answered.
 */
interface ExternalLinksResult {
  readonly afterEdits: QueryComparison[];
  readonly beforeEdits: QueryComparison[];
  readonly error: null | string;
  readonly frontmatterLinks: ExternalLink[];
  readonly hosts: string[];
  readonly similarHosts: string[];
  readonly urls: string[];
}

interface ExternalUrlUsage {
  readonly url: string;
}

interface HostQueryOptions {
  readonly shouldIncludeSubdomains?: boolean;
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
 * One query's answer from the index, beside the same question answered by reading every fixture note.
 */
interface QueryComparison {
  readonly indexed: null | string[];
  readonly query: string;
  readonly scanned: string[];
}

interface SimilarHost {
  readonly host: string;
}

const FOLDER_PATH = 'external-links';
const BODY_PATH = `${FOLDER_PATH}/body.md`;
const PROPERTY_PATH = `${FOLDER_PATH}/property.md`;
const SUBDOMAIN_PATH = `${FOLDER_PATH}/subdomain.md`;
const RENAMED_PATH = `${FOLDER_PATH}/renamed.md`;
const BODY_CONTENT = dedent`
  See https://example.com/docs/. and [the guide](http://www.example.com/docs#intro).

  \`\`\`
  https://in-code.example.org
  \`\`\`
  Typo: https://exmaple.com/docs\n
`;
const PROPERTY_CONTENT = dedent`
  ---
  source: "https://example.com/docs"
  ---
  Body text.\n
`;
const SUBDOMAIN_CONTENT = 'Read https://blog.example.com/post\n';
const EDITED_BODY_CONTENT = 'Now only https://other.net\n';

/*
 * Every wait is for work already in flight, so they are generous, not budgets. Their SUM has to stay under the
 * transport's per-command cap, since this closure holds one `Runtime.evaluate` open for the whole scenario.
 */
const API_WAIT_IN_MS = 5000;
const INDEX_WAIT_IN_MS = 10_000;
const POLL_IN_MS = 100;
const SCENARIO_TIMEOUT_IN_MS = 120_000;

describe('External links module', () => {
  afterAll(async () => {
    // The vault is shared with every other suite in this project, and the module is off by default.
    await applyPluginSettings({ isExternalLinksModuleEnabled: false });
  }, SCENARIO_TIMEOUT_IN_MS);

  it('answers which notes link to a URL or a host, matching a full scan after edits', async () => {
    const switchOn = await applyPluginSettings({ isExternalLinksModuleEnabled: true });
    expect(switchOn.error).toBeNull();

    const result = await runScenario();

    expect(result.error).toBeNull();
    expect(result.beforeEdits.find((comparison) => comparison.query === 'url https://example.com/docs')?.indexed).toEqual([BODY_PATH, PROPERTY_PATH]);
    expect(result.beforeEdits.find((comparison) => comparison.query === 'host example.com subdomains')?.indexed).toEqual([BODY_PATH, PROPERTY_PATH, SUBDOMAIN_PATH]);
    expect(result.beforeEdits.find((comparison) => comparison.query === 'host in-code.example.org exact')?.indexed).toEqual([]);
    expect(result.afterEdits.find((comparison) => comparison.query === 'host other.net exact')?.indexed).toEqual([RENAMED_PATH]);
    expect(result.frontmatterLinks.map((link) => [link.normalizedUrl, link.isInFrontmatter])).toEqual([['example.com/docs', true]]);
    expect(result.similarHosts).toContain('example.com');
    expect(result.hosts).toContain('blog.example.com');
    expect(result.urls).toContain('https://blog.example.com/post');

    for (const comparison of [...result.beforeEdits, ...result.afterEdits]) {
      expect(comparison.indexed, comparison.query).toEqual(comparison.scanned);
    }
  }, SCENARIO_TIMEOUT_IN_MS);

  it('answers null while the module is off', async () => {
    const switchOff = await applyPluginSettings({ isExternalLinksModuleEnabled: false });
    expect(switchOff.error).toBeNull();

    const result = await evalInObsidian({
      callback() {
        const records = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records;
        const record = (records?.['advanced-metadata-cache'] ?? []).find((candidate) => !candidate.isRevoked);
        return record ? record.api.getPathsLinkingToHost('example.com') : 'no record';
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
async function runScenario(): Promise<ExternalLinksResult> {
  return evalInObsidian({
    async callback({
      API_WAIT_IN_MS: apiWaitMs,
      app,
      BODY_CONTENT: bodyContent,
      BODY_PATH: bodyPath,
      EDITED_BODY_CONTENT: editedBodyContent,
      FOLDER_PATH: folderPath,
      INDEX_WAIT_IN_MS: indexWaitMs,
      lib: { waitUntil },
      POLL_IN_MS: pollMs,
      PROPERTY_CONTENT: propertyContent,
      PROPERTY_PATH: propertyPath,
      RENAMED_PATH: renamedPath,
      SUBDOMAIN_CONTENT: subdomainContent,
      SUBDOMAIN_PATH: subdomainPath
    }) {
      const empty: ExternalLinksResult = { afterEdits: [], beforeEdits: [], error: null, frontmatterLinks: [], hosts: [], similarHosts: [], urls: [] };
      const urlQueries = ['https://example.com/docs', 'http://www.example.com/docs/', 'https://exmaple.com/docs', 'https://other.net'];
      const hostQueries = ['example.com', 'blog.example.com', 'exmaple.com', 'in-code.example.org', 'other.net'];

      const existingFolder = app.vault.getAbstractFileByPath(folderPath);
      if (existingFolder) {
        await app.fileManager.trashFile(existingFolder);
      }

      function readLiveRecord(): PluginApiRecord | undefined {
        const records = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records;
        return (records?.['advanced-metadata-cache'] ?? []).find((record) => !record.isRevoked);
      }

      // The slow way, written independently of the plugin: every URL in each fixture note's text, outside fences.
      async function readUrls(): Promise<Map<string, URL[]>> {
        const urlsByPath = new Map<string, URL[]>();
        for (const file of app.vault.getMarkdownFiles()) {
          if (!file.path.startsWith(`${folderPath}/`)) {
            continue;
          }
          const content = await app.vault.cachedRead(file);
          const text = content.replaceAll(/```[\s\S]*?```/g, '');
          const urls = [...text.matchAll(/https?:\/\/[^\s<>()[\]"']+/g)].map((match) => new URL(match[0].replace(/[.,]+$/, '')));
          urlsByPath.set(file.path, urls);
        }
        return urlsByPath;
      }

      function hostOf(url: URL): string {
        return url.hostname.replace(/^www\./, '');
      }

      function keyOf(url: URL): string {
        return `${hostOf(url)}${url.pathname.replace(/\/$/, '')}${url.search}`;
      }

      async function compareAll(api: AdvancedMetadataCacheApi): Promise<QueryComparison[]> {
        const urlsByPath = await readUrls();
        const comparisons: QueryComparison[] = [];
        function scan(isMatch: (url: URL) => boolean): string[] {
          return [...urlsByPath].filter(([, urls]) => urls.some((url) => isMatch(url))).map(([path]) => path).sort();
        }
        function inFolder(paths: null | string[]): null | string[] {
          return paths?.filter((path) => path.startsWith(`${folderPath}/`)) ?? null;
        }

        for (const query of urlQueries) {
          const wanted = keyOf(new URL(query));
          comparisons.push({ indexed: inFolder(api.getPathsLinkingToUrl(query)), query: `url ${query}`, scanned: scan((url) => keyOf(url) === wanted) });
        }
        for (const query of hostQueries) {
          comparisons.push(
            { indexed: inFolder(api.getPathsLinkingToHost(query)), query: `host ${query} exact`, scanned: scan((url) => hostOf(url) === query) },
            {
              indexed: inFolder(api.getPathsLinkingToHost(query, { shouldIncludeSubdomains: true })),
              query: `host ${query} subdomains`,
              scanned: scan((url) => hostOf(url) === query || hostOf(url).endsWith(`.${query}`))
            }
          );
        }
        return comparisons;
      }

      async function isInStep(api: AdvancedMetadataCacheApi): Promise<boolean> {
        const comparisons = await compareAll(api);
        return comparisons.every((comparison) => JSON.stringify(comparison.indexed) === JSON.stringify(comparison.scanned));
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
        await api.getPathsLinkingToHostSafe('example.com');

        await app.vault.createFolder(folderPath);
        const bodyFile = await app.vault.create(bodyPath, bodyContent);
        await app.vault.create(propertyPath, propertyContent);
        const subdomainFile = await app.vault.create(subdomainPath, subdomainContent);

        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the new notes to be indexed',
          predicate: async () => (api.getPathsLinkingToHost('example.com', { shouldIncludeSubdomains: true })?.filter((path) => path.startsWith(`${folderPath}/`)) ?? []).length === 3 && await isInStep(api),
          timeoutInMilliseconds: indexWaitMs
        });

        const beforeEdits = await compareAll(api);
        const frontmatterLinks = api.getExternalLinks(propertyPath) ?? [];
        const similarHosts = (api.getSimilarHosts('exmaple.com') ?? []).map((similarHost) => similarHost.host);
        const hosts = (api.getExternalLinkHosts() ?? []).map((usage) => usage.host);
        const urls = (api.getExternalLinkUrls('blog.example.com') ?? []).map((usage) => usage.url);

        await app.vault.modify(bodyFile, editedBodyContent);
        await app.fileManager.renameFile(bodyFile, renamedPath);
        await app.fileManager.trashFile(subdomainFile);

        await waitUntil({
          intervalInMilliseconds: pollMs,
          message: 'the edit, the rename and the delete to reach the index',
          predicate: async () => (api.getPathsLinkingToHost('other.net') ?? []).includes(renamedPath) && await isInStep(api),
          timeoutInMilliseconds: indexWaitMs
        });

        return { afterEdits: await compareAll(api), beforeEdits, error: null, frontmatterLinks, hosts, similarHosts, urls };
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
      INDEX_WAIT_IN_MS,
      POLL_IN_MS,
      PROPERTY_CONTENT,
      PROPERTY_PATH,
      RENAMED_PATH,
      SUBDOMAIN_CONTENT,
      SUBDOMAIN_PATH
    },
    vaultPath: getTemporaryVault().path
  });
}

/* eslint-enable unicorn/prefer-https -- End of the http fixtures. */
