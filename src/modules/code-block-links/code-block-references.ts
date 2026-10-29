/**
 * @file
 *
 * Finds the links and embeds written inside fenced code blocks whose language holds markdown, such as
 * `ad-note` or `tabs`, which Obsidian's own parse skips like any other code.
 *
 * The inner text is parsed by Obsidian's own worker, through the `parseMarkdown` callback, so a link here is
 * exactly what Obsidian would find were the fence not there; this file only cuts the inner text out and maps
 * the positions the worker answers with back into the note. The inner text is handed over behind one extra
 * line break, so a block opening on `---` is never read as frontmatter.
 *
 * Only blocks Obsidian lists as a `code` SECTION are looked at, which means top-level fences: Obsidian lists
 * a fence inside a list item or a blockquote as part of that list or quote, not as a section of its own. A
 * whitelisted block inside a whitelisted block is found, because the inner parse lists its own sections. That
 * recursion ends by itself: each inner text is shorter than the text holding it, by its fence lines at least.
 */

import type {
  CachedMetadata,
  Loc,
  Pos,
  SectionCache
} from 'obsidian';

import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';

import type { CodeBlockReference } from '../../plugin-api.ts';

/**
 * One line of a block's content: where it starts in the note once the fence's indentation is stripped, and how
 * much was stripped.
 */
interface ContentLine {
  readonly offset: number;
  readonly removedPrefixLength: number;
}

/**
 * A fenced code block of the note: its language and the lines between its fences.
 */
interface FencedCodeBlock {
  /**
   * The index of the closing fence's line, or of the line after the last one when the block is never closed.
   */
  readonly contentEndLine: number;
  readonly contentStartLine: number;
  readonly indent: number;
  readonly language: string;
}

interface FindCodeBlockReferencesParams extends HasIncludedCodeBlockParams {
  /**
   * Parses markdown the way Obsidian's metadata worker does.
   */
  readonly parseMarkdown: (markdown: string) => Promise<CachedMetadata | null>;
}

interface HasIncludedCodeBlockParams {
  readonly cache: CachedMetadata;
  /**
   * Whether a block of this language holds markdown whose links count.
   */
  readonly isLanguageIncluded: (language: string) => boolean;
  readonly text: string;
}

const OPENING_FENCE_REG_EXP = /^(?<Indent> {0,3})(?<Fence>`{3,}|~{3,})[ \t]*(?<Language>[^\s`]*)/u;
const CLOSING_FENCE_REG_EXP = /^ {0,3}(?<Fence>`{3,}|~{3,})\s*$/u;

/**
 * Finds the links and embeds inside the note's whitelisted code blocks.
 *
 * @param params - The note's text and cache, and how to decide and parse.
 * @returns The references, in the order they appear in the note.
 */
export async function findCodeBlockReferences(params: FindCodeBlockReferencesParams): Promise<CodeBlockReference[]> {
  const lines = params.text.split('\n');
  const lineStarts = getLineStarts(lines);
  const codeBlockReferences: CodeBlockReference[] = [];

  for (const block of findFencedCodeBlocks(lines, params.cache.sections)) {
    if (!params.isLanguageIncluded(block.language)) {
      continue;
    }

    const contentLines: ContentLine[] = [];
    const contentTexts: string[] = [];
    for (let line = block.contentStartLine; line < block.contentEndLine; line++) {
      const lineText = ensureNonNullable(lines[line]);
      const removedPrefixLength = getIndentLength(lineText, block.indent);
      contentLines.push({ offset: ensureNonNullable(lineStarts[line]) + removedPrefixLength, removedPrefixLength });
      contentTexts.push(lineText.slice(removedPrefixLength));
    }

    const innerText = `\n${contentTexts.join('\n')}`;
    const innerCache = await params.parseMarkdown(innerText);
    if (!innerCache) {
      continue;
    }

    const innerReferences: CodeBlockReference[] = [
      ...(innerCache.links ?? []).map((reference) => ({ isEmbed: false, language: block.language, reference })),
      ...(innerCache.embeds ?? []).map((reference) => ({ isEmbed: true, language: block.language, reference })),
      ...await findCodeBlockReferences({ ...params, cache: innerCache, text: innerText })
    ];

    for (const innerReference of innerReferences) {
      const position = mapPos(innerReference.reference.position, block.contentStartLine, contentLines);
      codeBlockReferences.push({ ...innerReference, reference: { ...innerReference.reference, position } });
    }
  }

  return codeBlockReferences.sort((a, b) => a.reference.position.start.offset - b.reference.position.start.offset);
}

/**
 * Whether Obsidian lists any code section for the note: the check that needs no text at all.
 *
 * @param cache - The note's cache.
 * @returns Whether the note has a code section.
 */
export function hasCodeSection(cache: CachedMetadata): boolean {
  return cache.sections?.some((section) => section.type === 'code') ?? false;
}

/**
 * Whether any of the note's fenced code blocks is of a language the whitelist includes, parsing nothing: the
 * cheap check that decides whether a note is worth a parse at all.
 *
 * @param params - The note's text and cache, and the whitelist.
 * @returns Whether any block's language is included.
 */
export function hasIncludedCodeBlock(params: HasIncludedCodeBlockParams): boolean {
  return findFencedCodeBlocks(params.text.split('\n'), params.cache.sections).some((block) => params.isLanguageIncluded(block.language));
}

function findFencedCodeBlocks(lines: readonly string[], sections: readonly SectionCache[] | undefined): FencedCodeBlock[] {
  const blocks: FencedCodeBlock[] = [];

  for (const section of sections ?? []) {
    if (section.type !== 'code') {
      continue;
    }

    const startLine = section.position.start.line;
    const endLine = section.position.end.line;
    // An indented code block is a `code` section too, and has no fence and no language.
    const openingGroups = OPENING_FENCE_REG_EXP.exec(ensureNonNullable(lines[startLine]))?.groups;
    if (!openingGroups) {
      continue;
    }

    const fence = ensureNonNullable(openingGroups['Fence']);
    const language = ensureNonNullable(openingGroups['Language']);
    if (!language) {
      continue;
    }

    const closingFence = endLine > startLine ? CLOSING_FENCE_REG_EXP.exec(ensureNonNullable(lines[endLine]))?.groups?.['Fence'] : undefined;
    const isClosed = closingFence !== undefined && closingFence.startsWith(fence.charAt(0)) && closingFence.length >= fence.length;

    blocks.push({
      contentEndLine: isClosed ? endLine : endLine + 1,
      contentStartLine: startLine + 1,
      indent: ensureNonNullable(openingGroups['Indent']).length,
      language
    });
  }

  return blocks;
}

/**
 * How much of a content line's indentation belongs to the fence rather than to the content: up to as many
 * spaces as the opening fence is indented by, as CommonMark strips.
 *
 * @param lineText - The content line.
 * @param fenceIndent - How far the opening fence is indented.
 * @returns How many leading characters to remove.
 */
function getIndentLength(lineText: string, fenceIndent: number): number {
  let length = 0;
  while (length < fenceIndent && lineText[length] === ' ') {
    length++;
  }
  return length;
}

function getLineStarts(lines: readonly string[]): number[] {
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  return lineStarts;
}

/**
 * Moves a location in the inner text back into the note. Line 0 of the inner text is the line break put in
 * front of it, which holds nothing, so inner line `n` is content line `n - 1`.
 *
 * @param loc - The location in the inner text.
 * @param contentStartLine - The note's line the content starts on.
 * @param contentLines - The content's lines.
 * @returns The location in the note.
 */
function mapLoc(loc: Loc, contentStartLine: number, contentLines: readonly ContentLine[]): Loc {
  const contentLineIndex = loc.line - 1;
  const contentLine = ensureNonNullable(contentLines[contentLineIndex]);
  return {
    col: contentLine.removedPrefixLength + loc.col,
    line: contentStartLine + contentLineIndex,
    offset: contentLine.offset + loc.col
  };
}

function mapPos(pos: Pos, contentStartLine: number, contentLines: readonly ContentLine[]): Pos {
  return {
    end: mapLoc(pos.end, contentStartLine, contentLines),
    start: mapLoc(pos.start, contentStartLine, contentLines)
  };
}

export { type CodeBlockReference } from '../../plugin-api.ts';
