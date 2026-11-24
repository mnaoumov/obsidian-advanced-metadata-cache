/**
 * @file
 *
 * Integration suite for the `Block metadata` module's properties panel, against a real Obsidian:
 *
 * - A metadata fence renders as the folded panel in Reading view and in Live Preview, with a quoted wikilink as a
 *   link, and Source mode keeps the code block.
 * - The code block processor lives exactly as long as the module: switching it off removes it from Obsidian's
 *   language map, so the fence renders as a code block again, and switching it on again registers it afresh, which
 *   would throw if the first registration had outlived the module.
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
 * What one look at the note answered.
 */
interface PanelResult {
  readonly error: null | string;
  readonly linkText: null | string;
  readonly livePreviewSummary: null | string;
  readonly readingSummary: null | string;
  readonly sourceModePanelCount: number;
}

/**
 * What rendering the fence answered, and whether Obsidian's language map holds the processor.
 */
interface ProcessorResult {
  readonly hasCodeBlock: boolean;
  readonly hasPanel: boolean;
  readonly isRegistered: boolean;
}

const LANGUAGE = 'advanced-metadata-cache';
const PANEL_SELECTOR = '.advanced-metadata-cache-block-metadata';
const SUMMARY_SELECTOR = '.advanced-metadata-cache-block-metadata-summary';
const NOTE_PATH = 'block-metadata-panel/note.md';
const NOTE_CONTENT = dedent`
  # Tasks

  \`\`\`advanced-metadata-cache
  status: open
  related: "[[target|The target]]"
  \`\`\`

  Body.\n
`;

const POLL_IN_MS = 100;
const RENDER_WAIT_IN_MS = 7000;
const SCENARIO_TIMEOUT_IN_MS = 120_000;

describe('Block metadata panel', () => {
  afterAll(async () => {
    // The vault is shared with every other suite in this project, and the module is off by default.
    await applyPluginSettings({ isBlockMetadataModuleEnabled: false });
  }, SCENARIO_TIMEOUT_IN_MS);

  it('renders a fence as a folded panel in Reading view and Live Preview, and not in Source mode', async () => {
    const switchOn = await applyPluginSettings({ isBlockMetadataModuleEnabled: true });
    expect(switchOn.error).toBeNull();

    const result = await evalInObsidian({
      async callback({
        app,
        lib: { waitUntil },
        NOTE_CONTENT: noteContent,
        NOTE_PATH: notePath,
        PANEL_SELECTOR: panelSelector,
        POLL_IN_MS: pollMs,
        RENDER_WAIT_IN_MS: renderWaitMs,
        SUMMARY_SELECTOR: summarySelector
      }): Promise<PanelResult> {
        const empty: PanelResult = { error: null, linkText: null, livePreviewSummary: null, readingSummary: null, sourceModePanelCount: 0 };
        const folderPath = notePath.slice(0, notePath.lastIndexOf('/'));
        const existingFolder = app.vault.getAbstractFileByPath(folderPath);
        if (existingFolder) {
          await app.fileManager.trashFile(existingFolder);
        }
        await app.vault.createFolder(folderPath);
        const file = await app.vault.create(notePath, noteContent);
        const leaf = app.workspace.getLeaf('tab');

        async function waitForSummary(mode: string): Promise<null | string> {
          // `source: false` is Live Preview when the mode is `source`, and ignored in Reading view.
          await leaf.setViewState({ state: { file: file.path, mode, source: false }, type: 'markdown' });
          await waitUntil({
            intervalInMilliseconds: pollMs,
            message: `the panel to render in ${mode} mode`,
            predicate: () => leaf.view.containerEl.querySelector(summarySelector) !== null,
            timeoutInMilliseconds: renderWaitMs
          });
          return leaf.view.containerEl.querySelector(summarySelector)?.textContent ?? null;
        }

        try {
          const readingSummary = await waitForSummary('preview');
          const linkText = leaf.view.containerEl.querySelector(`${panelSelector} a.internal-link`)?.textContent ?? null;
          const livePreviewSummary = await waitForSummary('source');
          await leaf.setViewState({ state: { file: file.path, mode: 'source', source: true }, type: 'markdown' });
          // Source mode re-renders the editor synchronously; one frame lets CodeMirror drop the widgets.
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
          const sourceModePanelCount = leaf.view.containerEl.querySelectorAll(`.cm-editor ${panelSelector}`).length;
          return { error: null, linkText, livePreviewSummary, readingSummary, sourceModePanelCount };
        } catch (error) {
          return { ...empty, error: String(error) };
        } finally {
          leaf.detach();
        }
      },
      input: {
        NOTE_CONTENT,
        NOTE_PATH,
        PANEL_SELECTOR,
        POLL_IN_MS,
        RENDER_WAIT_IN_MS,
        SUMMARY_SELECTOR
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result).toEqual({
      error: null,
      linkText: 'The target',
      livePreviewSummary: 'Metadata: status, related',
      readingSummary: 'Metadata: status, related',
      sourceModePanelCount: 0
    });
  }, SCENARIO_TIMEOUT_IN_MS);

  it('removes the processor when the module is switched off, and registers it again when switched on', async () => {
    const switchOn = await applyPluginSettings({ isBlockMetadataModuleEnabled: true });
    expect(switchOn.error).toBeNull();
    expect(await renderFence()).toEqual({ hasCodeBlock: false, hasPanel: true, isRegistered: true });

    const switchOff = await applyPluginSettings({ isBlockMetadataModuleEnabled: false });
    expect(switchOff.error).toBeNull();
    expect(await renderFence()).toEqual({ hasCodeBlock: true, hasPanel: false, isRegistered: false });

    // A processor that outlived the module would make this registration throw.
    const switchOnAgain = await applyPluginSettings({ isBlockMetadataModuleEnabled: true });
    expect(switchOnAgain.error).toBeNull();
    expect(await renderFence()).toEqual({ hasCodeBlock: false, hasPanel: true, isRegistered: true });
  }, SCENARIO_TIMEOUT_IN_MS);
});

/**
 * Renders the fixture's fence through Obsidian's own renderer, as Reading view does.
 *
 * @returns What it rendered, and whether the language map holds the processor.
 */
async function renderFence(): Promise<ProcessorResult> {
  return evalInObsidian({
    async callback({ app, LANGUAGE: language, NOTE_CONTENT: noteContent, obsidianModule, PANEL_SELECTOR: panelSelector }): Promise<ProcessorResult> {
      const component = new obsidianModule.Component();
      component.load();
      const el = createDiv();
      try {
        await obsidianModule.MarkdownRenderer.render(app, noteContent, el, 'block-metadata-panel/rendered.md', component);
        const processors = obsidianModule.MarkdownPreviewRenderer.codeBlockPostProcessors;
        return {
          hasCodeBlock: el.querySelector(`pre > code.language-${language}`) !== null,
          hasPanel: el.querySelector(panelSelector) !== null,
          isRegistered: Object.hasOwn(processors, language)
        };
      } finally {
        component.unload();
      }
    },
    input: {
      LANGUAGE,
      NOTE_CONTENT,
      PANEL_SELECTOR
    },
    vaultPath: getTemporaryVault().path
  });
}
