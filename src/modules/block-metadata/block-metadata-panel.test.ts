import type { App as AppOriginal } from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  BLOCK_METADATA_PANEL_CLASS,
  renderBlockMetadataPanel
} from './block-metadata-panel.ts';
import { NOT_A_MAPPING_ERROR } from './block-metadata-parser.ts';

describe('renderBlockMetadataPanel', () => {
  let app: App;
  let el: HTMLElement;

  beforeEach(() => {
    app = App.createConfigured__();
    el = createDiv();
  });

  it('should render a folded panel naming its properties, one row each', () => {
    render('status: done\npriority: 2\nflag: true\nempty:\n');

    const detailsEl = el.querySelector('details');
    expect(detailsEl?.classList.contains(BLOCK_METADATA_PANEL_CLASS)).toBe(true);
    expect(detailsEl?.open).toBe(false);
    expect(getSummary()).toBe('Metadata: status, priority, flag, empty');
    expect(getValues()).toEqual({ empty: '', flag: 'true', priority: '2', status: 'done' });
  });

  it('should replace what the element held', () => {
    el.createSpan({ text: 'old' });
    render('a: 1\n');

    expect(el.textContent).not.toContain('old');
  });

  it('should say an empty fence is empty', () => {
    render('');

    expect(getSummary()).toBe('Metadata: empty');
    expect(el.querySelectorAll(`.${BLOCK_METADATA_PANEL_CLASS}-property`)).toHaveLength(0);
  });

  it('should show the error of a fence that is not a mapping', () => {
    render('- a\n- b\n');

    expect(el.querySelector('details')?.classList.contains(`${BLOCK_METADATA_PANEL_CLASS}-invalid`)).toBe(true);
    expect(getSummary()).toBe('Metadata: invalid');
    expect(el.querySelector(`.${BLOCK_METADATA_PANEL_CLASS}-error`)?.textContent).toBe(NOT_A_MAPPING_ERROR);
  });

  it('should show the error of a fence whose YAML does not parse', () => {
    render('a: [\n');

    expect(getSummary()).toBe('Metadata: invalid');
    expect(el.querySelector(`.${BLOCK_METADATA_PANEL_CLASS}-error`)?.textContent).not.toBe('');
  });

  it('should render list members as items, and anything nested as JSON', () => {
    render('tags:\n  - one\n  - 2\n  - [x]\nnested:\n  a: 1\n');

    const items = [...el.querySelectorAll(`.${BLOCK_METADATA_PANEL_CLASS}-list-item`)].map((itemEl) => itemEl.textContent);
    expect(items).toEqual(['one', '2', '["x"]']);
    expect(getValueEl('nested').textContent).toBe('{"a":1}');
  });

  it('should render a quoted wikilink as a link that opens through the workspace', () => {
    const openLinkText = vi.spyOn(app.workspace, 'openLinkText').mockResolvedValue();
    render('related: "[[Notes/Target#Part|The target]]"\nplain: "[[Target]]"\ntext: "see [[Target]]"\n');

    const linkEl = getValueEl('related').querySelector('a');
    expect(linkEl?.classList.contains('internal-link')).toBe(true);
    expect(linkEl?.textContent).toBe('The target');
    expect(linkEl?.dataset['href']).toBe('Notes/Target#Part');
    expect(getValueEl('plain').querySelector('a')?.textContent).toBe('Target');
    expect(getValueEl('text').querySelector('a')).toBeNull();
    expect(getValueEl('text').textContent).toBe('see [[Target]]');

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    linkEl?.dispatchEvent(clickEvent);

    expect(clickEvent.defaultPrevented).toBe(true);
    expect(openLinkText).toHaveBeenCalledWith('Notes/Target#Part', 'Source.md', false);
  });

  it('should render a list of wikilinks as links', () => {
    render('links:\n  - "[[Alpha]]"\n  - "[[Bravo|B]]"\n  - "[[Charlie|]]"\n  - null\n');

    const linkTexts = [...getValueEl('links').querySelectorAll('a')].map((linkEl) => linkEl.textContent);
    expect(linkTexts).toEqual(['Alpha', 'B', 'Charlie']);
    expect(getValueEl('links').querySelectorAll(`.${BLOCK_METADATA_PANEL_CLASS}-list-item`)).toHaveLength(4);
  });

  function getSummary(): null | string {
    return el.querySelector(`.${BLOCK_METADATA_PANEL_CLASS}-summary`)?.textContent ?? null;
  }

  function getValueEl(name: string): HTMLElement {
    const valueEl = el.querySelector<HTMLElement>(`[data-property="${CSS.escape(name)}"] .${BLOCK_METADATA_PANEL_CLASS}-value`);
    if (!valueEl) {
      throw new Error(`No property ${name}`);
    }
    return valueEl;
  }

  function getValues(): Record<string, null | string> {
    const values: Record<string, null | string> = {};
    for (const rowEl of el.querySelectorAll<HTMLElement>(`.${BLOCK_METADATA_PANEL_CLASS}-property`)) {
      values[rowEl.dataset['property'] ?? ''] = rowEl.querySelector(`.${BLOCK_METADATA_PANEL_CLASS}-value`)?.textContent ?? null;
    }
    return values;
  }

  function render(source: string): void {
    renderBlockMetadataPanel({ app: castTo<AppOriginal>(app), el, source, sourcePath: 'Source.md' });
  }
});
