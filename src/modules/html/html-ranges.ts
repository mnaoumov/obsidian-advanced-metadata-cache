import type {
  Loc,
  SectionCache
} from 'obsidian';

import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';

import type { HtmlRange } from '../../plugin-api.ts';

interface Fence {
  readonly marker: string;
  readonly start: number;
}

interface FindHtmlRangesParams {
  readonly content: string;
  readonly sections?: readonly SectionCache[];
}
interface GetExcludedRangesParams {
  readonly blocks: readonly OffsetRange[];
  readonly content: string;
  readonly sections: readonly SectionCache[];
}
interface OffsetRange {
  readonly end: number;
  readonly start: number;
}
interface OpenTag {
  readonly childNamespace: HtmlRange['namespace'];
  readonly name: string;
  readonly namespace: HtmlRange['namespace'];
}
interface SkipLiteralParams {
  readonly content: string;
  readonly isInBlock: boolean;
  readonly offset: number;
  readonly raw: OpenTag | undefined;
  readonly tickCursors: Map<number, number>;
  readonly tickRuns: ReadonlyMap<number, readonly number[]>;
}
interface UpdateNamespaceParams {
  readonly html: string;
  readonly isClosing: boolean;
  readonly name: string;
  readonly stack: OpenTag[];
}

const BINARY_PARTS = 2;

const ESCAPE_PERIOD = 2;
const TAG_PATTERN = /^<(?<closing>\/)?(?<name>[a-z][a-z\d-]*)(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/i;
const VOID_TAGS = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const RAW_TAGS = new Set(['script', 'style', 'textarea', 'title']);

/**
 * Scans HTML candidates using the existing block cache; never parses Markdown.
 * Inline candidates are deliberately not a claim of complete Markdown token parity.
 *
 * @param params - Text and its current cached sections.
 * @returns Blocks and individual tags with original, end-exclusive UTF-16 positions.
 */
export function findHtmlRanges(params: FindHtmlRangesParams): HtmlRange[] {
  const { content, sections = [] } = params;

  const blocks = sections.filter((section) => section.type === 'html').map((section) => ({
    end: Math.min(content.length, section.position.end.offset),
    start: section.position.start.offset
  }));
  const excluded = getExcludedRanges({ blocks, content, sections });
  const locate = createLocator(content);
  const ranges: HtmlRange[] = blocks.map((block) => ({
    html: content.slice(block.start, block.end),
    isClosing: false,
    kind: 'block',
    namespace: 'html',
    position: { end: locate(block.end), start: locate(block.start) },
    tagName: null
  }));
  const stack: OpenTag[] = [];
  const tickRuns = new Map<number, number[]>();
  for (const match of content.matchAll(/`+/g)) {
    const runs = tickRuns.get(match[0].length) ?? [];
    runs.push(match.index);
    tickRuns.set(match[0].length, runs);
  }
  const tickCursors = new Map<number, number>();
  let excludedIndex = 0;
  let blockIndex = 0;
  for (let offset = 0; offset < content.length;) {
    while (excludedIndex < excluded.length && ensureNonNullable(excluded[excludedIndex]).end <= offset) {
      excludedIndex++;
    }
    const exclusion = excluded[excludedIndex];
    if (exclusion && exclusion.start <= offset) {
      offset = exclusion.end;
      continue;
    }
    while (blockIndex < blocks.length && ensureNonNullable(blocks[blockIndex]).end <= offset) {
      blockIndex++;
    }
    const block = blocks[blockIndex];
    const isInBlock = block !== undefined && block.start <= offset && offset < block.end;
    const next = skipLiteral({ content, isInBlock, offset, raw: stack.at(-1), tickCursors, tickRuns });
    if (next !== null) {
      offset = next;
      continue;
    }
    const match = TAG_PATTERN.exec(content.slice(offset));
    if (!match) {
      offset++;
      continue;
    }
    const name = ensureNonNullable(ensureNonNullable(match.groups)['name']).toLowerCase();
    const isClosing = ensureNonNullable(match.groups)['closing'] !== undefined;
    const namespace = updateNamespace({ html: match[0], isClosing, name, stack });
    const end = offset + match[0].length;
    ranges.push({ html: match[0], isClosing, kind: 'tag', namespace, position: { end: locate(end), start: locate(offset) }, tagName: name });
    offset = end;
  }
  return ranges.sort((a, b) => a.position.start.offset - b.position.start.offset || b.position.end.offset - a.position.end.offset);
}

function createLocator(content: string): (offset: number) => Loc {
  const starts = [0];
  for (let index = content.indexOf('\n'); index !== -1; index = content.indexOf('\n', index + 1)) {
    starts.push(index + 1);
  }
  return (offset): Loc => {
    let low = 0;
    let high = starts.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / BINARY_PARTS);
      if (ensureNonNullable(starts[middle]) <= offset) {
        low = middle;
      } else {
        high = middle;
      }
    }
    return { col: offset - ensureNonNullable(starts[low]), line: low, offset };
  };
}

function getExcludedRanges(params: GetExcludedRangesParams): OffsetRange[] {
  const { blocks, content, sections } = params;
  const excluded = sections.filter((section) => section.type === 'code' || section.type === 'yaml').map((section) => ({
    end: section.position.end.offset,
    start: section.position.start.offset
  }));
  // Frontmatter may be present before a cache is available, including an unclosed property block.
  const frontmatter = /^\u{FEFF}?---\r?\n[\s\S]*?(?:\r?\n(?:---|\.\.\.)(?:\r?\n|$)|$)/u.exec(content);
  if (frontmatter) {
    excluded.push({ end: frontmatter[0].length, start: 0 });
  }
  // Fallback fences only; nested/indented fences are supplied by core's cached sections.
  let fence: Fence | null = null;
  let blockIndex = 0;
  for (const match of content.matchAll(/^ {0,3}(?<marker>`{3,}|~{3,})[^\n]*(?:\n|$)/gm)) {
    while (blockIndex < blocks.length && ensureNonNullable(blocks[blockIndex]).end <= match.index) {
      blockIndex++;
    }
    const block = blocks[blockIndex];
    if (block && block.start <= match.index) {
      continue;
    }
    const marker = ensureNonNullable(ensureNonNullable(match.groups)['marker']);
    if (!fence) {
      fence = { marker, start: match.index };
    } else if (marker.startsWith(ensureNonNullable(fence.marker[0])) && marker.length >= fence.marker.length && /^\s*$/.test(match[0].slice(match[0].indexOf(marker) + marker.length))) {
      excluded.push({ end: match.index + match[0].length, start: fence.start });
      fence = null;
    }
  }
  if (fence) {
    excluded.push({ end: content.length, start: fence.start });
  }
  return excluded.sort((a, b) => a.start - b.start);
}

function isEscaped(content: string, offset: number): boolean {
  let count = 0;
  for (let index = offset - 1; content[index] === '\\'; index--) {
    count++;
  }
  return count % ESCAPE_PERIOD !== 0;
}

function skipCodeSpan(params: SkipLiteralParams): number {
  const { content, offset, tickCursors, tickRuns } = params;
  const length = ensureNonNullable(/^`+/.exec(content.slice(offset)))[0].length;
  const runs = ensureNonNullable(tickRuns.get(length));
  let cursor = tickCursors.get(length) ?? 0;
  while (cursor < runs.length && ensureNonNullable(runs[cursor]) <= offset) {
    cursor++;
  }
  tickCursors.set(length, cursor);
  const end = runs[cursor];
  return (end ?? offset) + length;
}

function skipLiteral(params: SkipLiteralParams): null | number {
  const { content, isInBlock, offset, raw } = params;
  if (raw && RAW_TAGS.has(raw.name)) {
    const expression = new RegExp(String.raw`</${raw.name}(?=[\s/>])`, 'gi');
    expression.lastIndex = offset;
    const end = expression.exec(content)?.index ?? -1;
    if (end === -1) {
      return content.length;
    }
    return end === offset ? null : end;
  }
  if (!isInBlock && content[offset] === '`' && !isEscaped(content, offset)) {
    return skipCodeSpan(params);
  }
  if (content.startsWith('<!--', offset) || (!isInBlock && content.startsWith('%%', offset))) {
    const delimiter = content.startsWith('<!--', offset) ? '-->' : '%%';
    const end = content.indexOf(delimiter, offset + (delimiter === '-->' ? '<!--'.length : delimiter.length));
    return end === -1 ? content.length : end + delimiter.length;
  }
  return content[offset] !== '<' || (!isInBlock && isEscaped(content, offset)) ? offset + 1 : null;
}

function updateNamespace(params: UpdateNamespaceParams): HtmlRange['namespace'] {
  const { html, isClosing, name, stack } = params;
  let namespace = stack.at(-1)?.childNamespace ?? 'html';
  if (isClosing) {
    const index = stack.findLastIndex((tag) => tag.name === name);
    if (index !== -1) {
      namespace = ensureNonNullable(stack[index]).namespace;
      stack.splice(index);
    }
  } else {
    namespace = name === 'svg' ? 'svg' : (name === 'math' ? 'mathml' : namespace);
    if (!/\/\s*>$/.test(html) && !(namespace === 'html' && VOID_TAGS.has(name))) {
      stack.push({ childNamespace: namespace === 'svg' && name === 'foreignobject' ? 'html' : namespace, name, namespace });
    }
  }

  return namespace;
}
