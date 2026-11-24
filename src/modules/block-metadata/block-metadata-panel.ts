/**
 * @file
 *
 * Renders a metadata fence in Reading view and Live Preview as a compact, foldable, read-only properties panel, in
 * place of the code block Obsidian would show. Source mode is untouched: Obsidian runs no code block processor there.
 *
 * The panel is folded by default, so a fence costs one line on a narrow screen; its summary names the properties it
 * holds. Unfolded, each property is a row: a scalar is its text, a list is its members, and a string that is exactly
 * one wikilink is a link that opens like any other. Anything else (a mapping, a list inside a list) is shown as JSON.
 * A fence whose YAML does not read as a mapping shows the error instead, the same one the API reports.
 */

import type { App } from 'obsidian';

import { appendCodeBlock } from '@mnaoumov/obsidian-lib/html-element';
import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import {
  getMandatoryNamedGroup,
  getOptionalNamedGroup
} from '@mnaoumov/typescript-lib/reg-exp';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { Keymap } from 'obsidian';

import { parseBlockMetadataProperties } from './block-metadata-parser.ts';

/**
 * The class of the panel's root element, and the prefix of every class inside it.
 */
export const BLOCK_METADATA_PANEL_CLASS = 'advanced-metadata-cache-block-metadata';

/**
 * What {@link renderBlockMetadataPanel} renders.
 */
export interface RenderBlockMetadataPanelParams {
  /**
   * The Obsidian app, which opens a clicked link.
   */
  readonly app: App;

  /**
   * The element Obsidian handed the code block processor.
   */
  readonly el: HTMLElement;

  /**
   * The fence's content, as Obsidian handed it to the processor.
   */
  readonly source: string;

  /**
   * The path of the note holding the fence, which a link is resolved from.
   */
  readonly sourcePath: string;
}

interface ParsedWikilink {
  readonly displayText: string;
  readonly linktext: string;
}

const WIKILINK_REG_EXP = /^\[\[(?<Linktext>[^\]|]+)(?:\|(?<Alias>[^\]]*))?\]\]$/;

/**
 * Renders a metadata fence as a properties panel.
 *
 * @param params - The fence and where to render it.
 */
export function renderBlockMetadataPanel(params: RenderBlockMetadataPanelParams): void {
  const { el } = params;
  el.empty();

  const { error, properties } = parseBlockMetadataProperties(params.source);
  const detailsEl = el.createEl('details', { cls: BLOCK_METADATA_PANEL_CLASS });
  const summaryEl = detailsEl.createEl('summary', { cls: `${BLOCK_METADATA_PANEL_CLASS}-summary` });

  if (properties === null) {
    detailsEl.addClass(`${BLOCK_METADATA_PANEL_CLASS}-invalid`);
    summaryEl.setText('Metadata: invalid');
    detailsEl.createDiv({ cls: `${BLOCK_METADATA_PANEL_CLASS}-error`, text: ensureNonNullable(error) });
    return;
  }

  const names = Object.keys(properties);
  summaryEl.setText(names.length === 0 ? 'Metadata: empty' : `Metadata: ${names.join(', ')}`);

  for (const name of names) {
    const rowEl = detailsEl.createDiv({ cls: `${BLOCK_METADATA_PANEL_CLASS}-property` });
    rowEl.dataset['property'] = name;
    rowEl.createSpan({ cls: `${BLOCK_METADATA_PANEL_CLASS}-key`, text: name });
    const valueEl = rowEl.createSpan({ cls: `${BLOCK_METADATA_PANEL_CLASS}-value` });
    renderValue(params, valueEl, properties[name]);
  }
}

function parseWikilink(value: string): null | ParsedWikilink {
  const match = WIKILINK_REG_EXP.exec(value.trim());
  if (!match) {
    return null;
  }

  const linktext = getMandatoryNamedGroup(match, 'Linktext').trim();
  // An empty alias (`[[Target|]]`) shows the link text, as Obsidian does.
  const alias = getOptionalNamedGroup(match, 'Alias')?.trim() ?? '';
  return { displayText: alias || linktext, linktext };
}

function renderLink(params: RenderBlockMetadataPanelParams, parentEl: HTMLElement, wikilink: ParsedWikilink): void {
  const linkEl = parentEl.createEl('a', {
    attr: { 'data-href': wikilink.linktext },
    cls: 'internal-link',
    href: wikilink.linktext,
    text: wikilink.displayText
  });

  linkEl.addEventListener('click', (clickEvent) => {
    // Obsidian's own link handlers differ between Reading view and Live Preview; this one opens the link in both.
    clickEvent.preventDefault();
    clickEvent.stopPropagation();
    invokeAsyncSafely(async () => {
      await params.app.workspace.openLinkText(wikilink.linktext, params.sourcePath, Keymap.isModEvent(clickEvent));
    });
  });
}

function renderScalar(params: RenderBlockMetadataPanelParams, parentEl: HTMLElement, value: unknown): void {
  if (value === null) {
    return;
  }

  if (typeof value === 'string') {
    const wikilink = parseWikilink(value);
    if (wikilink) {
      renderLink(params, parentEl, wikilink);
    } else {
      parentEl.appendText(value);
    }
    return;
  }

  if (typeof value === 'object') {
    // A parsed fence holds JSON values only, whose text is never `undefined`.
    appendCodeBlock(parentEl, ensureNonNullable(JSON.stringify(value)));
    return;
  }

  // What is left of a JSON value is a number or a boolean, whose JSON text is how YAML wrote it.
  parentEl.appendText(ensureNonNullable(JSON.stringify(value)));
}

function renderValue(params: RenderBlockMetadataPanelParams, valueEl: HTMLElement, value: unknown): void {
  if (!Array.isArray(value)) {
    renderScalar(params, valueEl, value);
    return;
  }

  valueEl.addClass(`${BLOCK_METADATA_PANEL_CLASS}-list`);
  for (const item of value) {
    renderScalar(params, valueEl.createSpan({ cls: `${BLOCK_METADATA_PANEL_CLASS}-list-item` }), item);
  }
}
