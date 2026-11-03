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

import type { PluginApiRegistryHolder } from '../../../scripts/helpers/plugin-api-registry.ts';

import { applyPluginSettings } from '../../../scripts/helpers/names-module.ts';

const TIMEOUT_IN_MILLISECONDS = 60_000;
const POLL_IN_MILLISECONDS = 100;
const CONTENT = 'Text <span title=">">alpha</span> <nonExistingTag>bravo</nonExistingTag> <alpha-widget>charlie</alpha-widget>\n\n<script>alert(1)</script>\n\n<style>span { color: red; }</style>\n\n<svg><circle cx="2" cy="2" r="1"/><linearGradient onclick="alert(1)"></linearGradient></svg>\n\n<math><mi>x</mi></math>\n\n`<code-example>`\n\n```html\n<fenced-example>\n```\n\n<!-- <comment-example> -->';

describe('HTML index in Obsidian', () => {
  it('matches cached HTML blocks and actual sanitizer changes, follows edits and revokes on disable', async () => {
    const vaultPath = getTemporaryVault().path;
    expect(await applyPluginSettings({ isHtmlModuleEnabled: true })).toEqual({ error: null });
    try {
      const result = await pollInObsidian({
        input: { CONTENT },
        intervalInMilliseconds: POLL_IN_MILLISECONDS,
        poll({ app, CONTENT: content, obsidianModule }) {
          const api = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records?.['advanced-metadata-cache']?.find((record) => !record.isRevoked)?.api;
          const ranges = api?.getHtmlRanges('html-oracle.md');
          const diagnostics = api?.getHtmlDiagnostics('html-oracle.md');
          const blocks = app.metadataCache.getCache('html-oracle.md')?.sections?.filter((section) => section.type === 'html').map((section) => section.position) ?? [];
          const oracle = obsidianModule.sanitizeHTMLToDom('<script>alert(1)</script><style>span { color: red; }</style><nonExistingTag>bravo</nonExistingTag>');
          return {
            blocks,
            diagnostics: diagnostics?.map((diagnostic) => ({ kind: diagnostic.kind, name: diagnostic.range.tagName })) ?? null,
            indexedBlocks: ranges?.filter((range) => range.kind === 'block').map((range) => range.position) ?? null,
            names: ranges?.filter((range) => range.kind === 'tag').map((range) => range.tagName) ?? null,
            offsetsMatch: ranges?.every((range) => content.slice(range.position.start.offset, range.position.end.offset) === range.html) ?? false,
            oracle: { script: oracle.querySelector('script') !== null, style: oracle.querySelector('style') !== null, unknown: oracle.querySelector('nonexistingtag') !== null }
          };
        },
        async start({ app, CONTENT: content }) {
          await app.vault.create('html-oracle.md', content);
        },
        timeoutInMilliseconds: TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'HTML candidates were not built',
        until: (state) => state.names?.includes('circle') === true,
        vaultPath
      });
      expect(result.offsetsMatch).toBe(true);
      expect(result.indexedBlocks).toEqual(result.blocks);
      expect(result.names).not.toContain('code-example');
      expect(result.names).not.toContain('fenced-example');
      expect(result.names).not.toContain('comment-example');
      expect(result.diagnostics).toContainEqual({ kind: 'unknown', name: 'nonexistingtag' });
      expect(result.diagnostics).toContainEqual({ kind: 'sanitized', name: 'lineargradient' });
      expect(result.diagnostics).not.toContainEqual({ kind: 'unknown', name: 'alpha-widget' });
      for (const name of ['script', 'style', 'unknown'] as const) {
        const tag = name === 'unknown' ? 'nonexistingtag' : name;
        expect(result.diagnostics?.some((diagnostic) => diagnostic.kind === 'sanitized' && diagnostic.name === tag)).toBe(!result.oracle[name]);
      }
      const edited = await pollInObsidian({
        intervalInMilliseconds: POLL_IN_MILLISECONDS,
        poll() {
          const api = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records?.['advanced-metadata-cache']?.find((record) => !record.isRevoked)?.api;
          return api?.getHtmlRanges('html-oracle.md')?.map((range) => range.html) ?? null;
        },
        async start({ app }) {
          const file = app.vault.getFileByPath('html-oracle.md');
          if (!file) {
            throw new Error('Missing HTML fixture');
          }
          await app.vault.modify(file, 'Text <b>changed</b>');
        },
        timeoutInMilliseconds: TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'HTML edit did not replace the old candidates',
        until: (state) => state?.[0] === '<b>',
        vaultPath
      });
      expect(edited).toEqual(['<b>', '</b>']);
    } finally {
      await applyPluginSettings({ isHtmlModuleEnabled: false });
    }
    expect(
      await evalInObsidian({
        callback() {
          const api = (window as PluginApiRegistryHolder).__obsidianLib?.pluginApiRegistry?.value?.records?.['advanced-metadata-cache']?.find((record) => !record.isRevoked)?.api;
          return api?.getHtmlRanges('html-oracle.md');
        },
        vaultPath
      })
    ).toBeNull();
  }, TIMEOUT_IN_MILLISECONDS * 3);
});
