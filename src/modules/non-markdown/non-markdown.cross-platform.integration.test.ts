import type {
  App,
  BasesEntry,
  TFile
} from 'obsidian';

import {
  evalInObsidian,
  pollInObsidian
} from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { AdvancedMetadataCacheApi } from '../../plugin-api.ts';

import { applyPluginSettings } from '../../../scripts/helpers/names-module.ts';

const INDEX_TIMEOUT_IN_MILLISECONDS = 60_000;
const POLL_INTERVAL_IN_MILLISECONDS = 250;
const SCENARIO_TIMEOUT_IN_MILLISECONDS = 180_000;

interface ApiRecord {
  readonly api: AdvancedMetadataCacheApi;
  readonly isRevoked: boolean;
}

interface ApiRegistry {
  readonly records?: Record<string, ApiRecord[]>;
}

interface BasesContext {
  readonly app: App;
  readonly formulas: Record<string, string>;
}
interface RegistryValue {
  readonly value?: ApiRegistry;
}
interface SharedState {
  readonly pluginApiRegistry?: RegistryValue;
}
interface TestWindow {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test-only teardown is stored across short renderer evaluations.
  __nonMarkdownUnregister?: () => void;
  readonly __obsidianLib?: SharedState;
}

describe('non-Markdown metadata', () => {
  it('accepts a plugin parser, lets core rewrite its original coordinates, and removes its contribution on unregister', async () => {
    try {
      const registered = await pollInObsidian({
        intervalInMilliseconds: POLL_INTERVAL_IN_MILLISECONDS,
        poll({ app }) {
          const property: unknown = app.metadataCache.getCache('provider.story')?.frontmatter?.['status'];
          return { property: typeof property === 'string' ? property : null, resolved: app.metadataCache.resolvedLinks['provider.story']?.['provider-target.md'] ?? 0 };
        },
        async start({ app }) {
          const testWindow = window as TestWindow;
          const api = testWindow.__obsidianLib?.pluginApiRegistry?.value?.records?.['advanced-metadata-cache']?.find((record) => !record.isRevoked)?.api;
          if (!api) {
            throw new Error('No published metadata API');
          }
          testWindow.__nonMarkdownUnregister = api.registerMetadataParser('story', async ({ content }) => {
            const cache = await app.metadataCache.computeMetadataAsync(new TextEncoder().encode(content).buffer);
            return cache ? { ...cache, frontmatter: { status: 'provided' } } : null;
          });
          await app.vault.create('provider-target.md', '');
          await app.vault.create('provider.story', '[[provider-target]]');
        },
        timeoutInMilliseconds: INDEX_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'The registered parser did not supply core metadata',
        until: (state) => state.property === 'provided' && state.resolved === 1,
        vaultPath: getTemporaryVault().path
      });
      expect(registered.property).toBe('provided');
      const renamed = await pollInObsidian({
        intervalInMilliseconds: POLL_INTERVAL_IN_MILLISECONDS,
        async poll({ app }) {
          const file = app.vault.getFileByPath('provider.story');
          return { content: file ? await app.vault.read(file) : null, resolved: app.metadataCache.resolvedLinks['provider.story']?.['provider-renamed.md'] ?? 0 };
        },
        async start({ app }) {
          const target = app.vault.getFileByPath('provider-target.md');
          if (!target) {
            throw new Error('Missing provider target');
          }
          await app.fileManager.renameFile(target, 'provider-renamed.md');
        },
        timeoutInMilliseconds: INDEX_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'Core did not rewrite the plugin file using original reference positions',
        until: (state) => state.content === '[[provider-renamed]]' && state.resolved === 1,
        vaultPath: getTemporaryVault().path
      });
      expect(renamed.content).toBe('[[provider-renamed]]');
    } finally {
      await pollInObsidian({
        intervalInMilliseconds: POLL_INTERVAL_IN_MILLISECONDS,
        poll: ({ app }) => ({ cache: app.metadataCache.getCache('provider.story'), resolved: Object.keys(app.metadataCache.resolvedLinks['provider.story'] ?? {}).length }),
        start() {
          const testWindow = window as TestWindow;
          testWindow.__nonMarkdownUnregister?.();
          delete testWindow.__nonMarkdownUnregister;
        },
        timeoutInMilliseconds: INDEX_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'Unregistering the parser left synthetic metadata or links behind',
        until: (state) => Object.keys(state.cache ?? {}).length === 0 && state.resolved === 0,
        vaultPath: getTemporaryVault().path
      });
    }
  }, SCENARIO_TIMEOUT_IN_MILLISECONDS);

  it('exposes properties, headings and links to core, follows edits, and removes them when disabled', async () => {
    expect(await applyPluginSettings({ isNonMarkdownModuleEnabled: true, markdownFileExtensions: ['mdx', 'fountain'] })).toEqual({ error: null });
    try {
      const initial = await pollInObsidian({
        intervalInMilliseconds: POLL_INTERVAL_IN_MILLISECONDS,
        poll({ app, obsidianModule }) {
          const target = app.vault.getFileByPath('non-markdown-target.md');
          const source = app.vault.getFileByPath('non-markdown-source.mdx');
          const cache = app.metadataCache.getCache('non-markdown-source.mdx');
          type BasesEntryConstructor = new (context: BasesContext, file: TFile) => BasesEntry;
          const Entry = obsidianModule.BasesEntry as BasesEntryConstructor;
          const entry = source ? new Entry({ app, formulas: {} }, source) : null;
          const baseProperty: unknown = entry?.getRawProperty('status');
          const property: unknown = cache?.frontmatter?.['status'];
          return {
            backlinks: target ? app.metadataCache.getBacklinksForFile(target).keys() : [],
            baseProperty: typeof baseProperty === 'string' ? baseProperty : null,
            hash: app.metadataCache.getFileInfo('non-markdown-source.mdx')?.hash ?? null,
            heading: cache?.headings?.[0]?.heading ?? null,
            property: typeof property === 'string' ? property : null,
            resolved: app.metadataCache.resolvedLinks['non-markdown-source.mdx']?.['non-markdown-target.md'] ?? 0,
            tags: app.metadataCache.getTags()['#screenplay'] ?? 0
          };
        },
        async start({ app }) {
          await app.vault.create('non-markdown-target.md', '');
          await app.vault.create('non-markdown-source.mdx', '---\nstatus: draft\n---\n# Scene\n[[non-markdown-target]] #screenplay');
        },
        timeoutInMilliseconds: INDEX_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'The configured mdx extension did not contribute core metadata and backlinks',
        until: (state) => state.resolved === 1 && state.backlinks.includes('non-markdown-source.mdx'),
        vaultPath: getTemporaryVault().path
      });
      expect(initial).toEqual({ backlinks: ['non-markdown-source.mdx'], baseProperty: 'draft', hash: '', heading: 'Scene', property: 'draft', resolved: 1, tags: 1 });
      const edited = await pollInObsidian({
        intervalInMilliseconds: POLL_INTERVAL_IN_MILLISECONDS,
        poll({ app }) {
          const cache = app.metadataCache.getCache('non-markdown-source.mdx');
          const property: unknown = cache?.frontmatter?.['status'];
          return { heading: cache?.headings?.[0]?.heading ?? null, property: typeof property === 'string' ? property : null, resolved: Object.keys(app.metadataCache.resolvedLinks['non-markdown-source.mdx'] ?? {}).length };
        },
        async start({ app }) {
          const source = app.vault.getFileByPath('non-markdown-source.mdx');
          if (!source) {
            throw new Error('Missing source');
          }
          await app.vault.modify(source, '---\nstatus: final\n---\n# Changed\n');
        },
        timeoutInMilliseconds: INDEX_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'Editing the non-Markdown file left stale metadata',
        until: (state) => state.property === 'final' && state.resolved === 0,
        vaultPath: getTemporaryVault().path
      });
      expect(edited.heading).toBe('Changed');
      expect(await applyPluginSettings({ isNonMarkdownModuleEnabled: false })).toEqual({ error: null });
      const removed = await evalInObsidian({
        callback: ({ app }) => app.metadataCache.getCache('non-markdown-source.mdx'),
        vaultPath: getTemporaryVault().path
      });
      expect(removed).toEqual({});
    } finally {
      await applyPluginSettings({ isNonMarkdownModuleEnabled: true, markdownFileExtensions: [] });
    }
  }, SCENARIO_TIMEOUT_IN_MILLISECONDS);
});
