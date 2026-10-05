/**
 * @file
 *
 * Which lines of which note the user is looking at right now, for the `Headings` module's `seen` time.
 */

import type { App } from 'obsidian';

import { MarkdownView } from 'obsidian';

/**
 * A range of lines on screen in the active editor.
 */
export interface VisibleLineRange {
  /**
   * The first line on screen, zero-based.
   */
  readonly fromLine: number;

  /**
   * The note's vault-relative path.
   */
  readonly path: string;

  /**
   * The last line on screen, zero-based.
   */
  readonly toLine: number;
}

/**
 * Reads the lines on screen in the active editor.
 *
 * Only the active Markdown view counts, only in source or Live Preview mode, and only while its window
 * has focus: a note in a background tab or behind another application is not being looked at. Reading
 * view is not measured, because its rendered sections carry no line geometry to measure.
 *
 * The range is the part of the document inside the editor's scroller, not CodeMirror's viewport, which
 * renders a margin above and below what is actually on screen.
 *
 * @param app - The Obsidian app.
 * @returns The range, or `null` when nothing is being looked at.
 */
export function getVisibleLineRange(app: App): null | VisibleLineRange {
  const view = app.workspace.getActiveViewOfType(MarkdownView);

  if (!view?.file || view.getMode() !== 'source' || !view.containerEl.ownerDocument.hasFocus()) {
    return null;
  }

  const editorView = view.editor.cm;
  const scrollRect = editorView.scrollDOM.getBoundingClientRect();
  const doc = editorView.state.doc;
  const topBlock = editorView.lineBlockAtHeight(scrollRect.top - editorView.documentTop);
  const bottomBlock = editorView.lineBlockAtHeight(scrollRect.bottom - editorView.documentTop);

  return {
    fromLine: doc.lineAt(topBlock.from).number - 1,
    path: view.file.path,
    toLine: doc.lineAt(bottomBlock.to).number - 1
  };
}
