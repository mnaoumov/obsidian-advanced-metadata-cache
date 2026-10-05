import type {
  App as AppOriginal,
  MarkdownFileInfo,
  MarkdownView,
  View
} from 'obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { getVisibleLineRange } from './visible-lines.ts';

interface FileStub {
  readonly path: string;
}

interface ViewStubParams {
  readonly file?: FileStub | null;
  readonly hasFocus?: boolean;
  readonly mode?: 'preview' | 'source';
}

const DOCUMENT_TOP = 100;
const LINE_HEIGHT = 10;
const SCROLL_BOTTOM = 250;
const SCROLL_TOP = 150;

describe('getVisibleLineRange', () => {
  let app: App;

  beforeEach(() => {
    app = App.createConfigured__();
  });

  it('should answer nothing without an active Markdown view', () => {
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(null);

    expect(getVisibleLineRange(castTo<AppOriginal>(app))).toBeNull();
  });

  it('should answer nothing for a view without a file', () => {
    stubActiveView({ file: null });

    expect(getVisibleLineRange(castTo<AppOriginal>(app))).toBeNull();
  });

  it('should answer nothing in reading view', () => {
    stubActiveView({ mode: 'preview' });

    expect(getVisibleLineRange(castTo<AppOriginal>(app))).toBeNull();
  });

  it('should answer nothing while the window has no focus', () => {
    stubActiveView({ hasFocus: false });

    expect(getVisibleLineRange(castTo<AppOriginal>(app))).toBeNull();
  });

  it('should answer the lines inside the scroller, measured from the top of the document', () => {
    stubActiveView({});

    expect(getVisibleLineRange(castTo<AppOriginal>(app))).toEqual({
      // The scroller starts 50px into the document, i.e. at line 5, and ends 150px in, at line 15.
      fromLine: (SCROLL_TOP - DOCUMENT_TOP) / LINE_HEIGHT,
      path: 'Alpha.md',
      toLine: (SCROLL_BOTTOM - DOCUMENT_TOP) / LINE_HEIGHT
    });
  });

  function stubActiveView(params: ViewStubParams): void {
    const { file = { path: 'Alpha.md' }, hasFocus = true, mode = 'source' } = params;
    /*
     * A position IS a pixel offset in this stub, and a line is ten of them, so the arithmetic in the
     * assertion above is the whole of what the function does with the editor.
     */
    const view = strictProxy<MarkdownView>({
      containerEl: castTo<HTMLElement>({ ownerDocument: { hasFocus: (): boolean => hasFocus } }),
      editor: castTo<MarkdownView['editor']>({
        cm: {
          documentTop: DOCUMENT_TOP,
          lineBlockAtHeight: (height: number) => ({ from: height, to: height }),
          scrollDOM: { getBoundingClientRect: () => ({ bottom: SCROLL_BOTTOM, top: SCROLL_TOP }) },
          state: { doc: { lineAt: (position: number) => ({ number: position / LINE_HEIGHT + 1 }) } }
        }
      }),
      file: castTo<MarkdownView['file']>(file),
      getMode: () => mode
    });
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(castTo<MarkdownFileInfo & View>(view));
  }
});
