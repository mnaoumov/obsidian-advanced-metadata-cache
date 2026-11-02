/**
 * @file
 *
 * Finding the external links in a note's text, and the one form a URL and a host are keyed on.
 *
 * Obsidian's metadata cache reports no external link at all: `[text](https://...)` is left out of `links`, and a bare
 * URL is not parsed. So the text is read, and every `http(s)://` URL in it counts: bare, in a markdown link, in
 * `<...>`, and in the frontmatter, which is how a URL property counts with its position. A URL inside a fenced code
 * block or an inline code span is not rendered as a link and does not count.
 *
 * Normalized, `http` and `https` are one, the host is lowered and loses `www.`, the user info and the fragment are
 * dropped, and so is a trailing `/` of the path. The port and the query string are kept, since a query often names a
 * different page (`watch?v=`), and so is the path's case.
 */

import type { Loc } from 'obsidian';

import type { ExternalLink } from '../../plugin-api.ts';

/**
 * A URL brought to the form the index keys on.
 */
export interface ParsedExternalUrl {
  /**
   * The host: lower case, no `www.`, no port.
   */
  readonly host: string;

  /**
   * The host, the port when it is not the scheme's default, the path without a trailing `/`, and the query string.
   */
  readonly normalizedUrl: string;
}

interface TextRange {
  readonly end: number;
  readonly start: number;
}

const FENCE_PATTERN = /^ {0,3}(?<fence>`{3,}|~{3,})/;
const FRONTMATTER_DELIMITER = '---';
const INLINE_CODE_PATTERN = /(?<!`)(?<ticks>`+)(?!`)[\s\S]*?(?<!`)\k<ticks>(?!`)/g;
const SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i;
/*
 * Ends at whitespace, at a character that closes a markdown construct (`<>[]`), at a quote (a YAML or HTML value), at a
 * backtick and at `|` (a table cell). A `)` is kept here and trimmed below when unbalanced, so a Wikipedia path such as
 * `Foo_(bar)` survives while `[x](https://a.b)` loses its `)`.
 */
const URL_PATTERN = /(?<![\p{L}\p{N}_])https?:\/\/[^\s<>[\]"'`|]+/giu;
// A swap of two neighboring characters, which counts as one edit, spans this many characters.
const SWAP_LENGTH = 2;
const TRAILING_PUNCTUATION = '.,;:!?*_~';
const WWW_PREFIX = 'www.';

/**
 * Finds every external link in a note's text.
 *
 * @param content - The note's text.
 * @returns The links, in text order.
 */
export function findExternalLinks(content: string): ExternalLink[] {
  const excludedRanges = getCodeRanges(content);
  const frontmatterEnd = getFrontmatterEnd(content);
  const locate = createLocator(content);
  const links: ExternalLink[] = [];

  for (const match of content.matchAll(URL_PATTERN)) {
    const start = match.index;
    if (excludedRanges.some((range) => range.start <= start && start < range.end)) {
      continue;
    }

    const url = trimUrl(match[0]);
    const parsed = parseExternalUrl(url);
    if (!parsed) {
      continue;
    }

    const startLoc = locate(start);
    const endLoc = locate(start + url.length);
    links.push({
      host: parsed.host,
      isInFrontmatter: start < frontmatterEnd,
      normalizedUrl: parsed.normalizedUrl,
      position: { end: endLoc, start: startLoc },
      url
    });
  }

  return links;
}

/**
 * The optimal string alignment distance between two strings: insertions, deletions, substitutions and swaps of two
 * neighboring characters each cost 1, so `githb.com` and `gihtub.com` are both 1 away from `github.com`.
 *
 * @param a - One string.
 * @param b - The other.
 * @param maxDistance - Any distance above this is reported as `maxDistance + 1`, which lets the computation stop early.
 * @returns The distance, capped at `maxDistance + 1`.
 */
export function getEditDistance(a: string, b: string, maxDistance: number): number {
  const cap = maxDistance + 1;
  if (Math.abs(a.length - b.length) > maxDistance) {
    return cap;
  }

  let previousPrevious: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let aLength = 1; aLength <= a.length; aLength++) {
    const current = [aLength];
    let rowMinimum = aLength;

    for (let bLength = 1; bLength <= b.length; bLength++) {
      const cost = a[aLength - 1] === b[bLength - 1] ? 0 : 1;
      let value = Math.min(readCell(previous, bLength) + 1, readCell(current, bLength - 1) + 1, readCell(previous, bLength - 1) + cost);
      if (aLength >= SWAP_LENGTH && bLength >= SWAP_LENGTH && a[aLength - 1] === b[bLength - SWAP_LENGTH] && a[aLength - SWAP_LENGTH] === b[bLength - 1]) {
        value = Math.min(value, readCell(previousPrevious, bLength - SWAP_LENGTH) + 1);
      }
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }

    if (rowMinimum > maxDistance) {
      return cap;
    }

    previousPrevious = previous;
    previous = current;
  }

  return Math.min(readCell(previous, b.length), cap);
}

/**
 * Brings a host, as a caller asks for it, to the form the index keys on.
 *
 * @param host - A host, in any casing, with or without `www.`, a scheme, a port or a path.
 * @returns The host, or `null` when it is not one.
 */
export function normalizeHost(host: string): null | string {
  return parseExternalUrl(host.trim())?.host ?? null;
}

/**
 * Brings a URL to the form the index keys on.
 *
 * @param url - An `http` or `https` URL; one without a scheme is read as `https`.
 * @returns The URL's keys, or `null` when it is no `http(s)` URL with a host.
 */
export function parseExternalUrl(url: string): null | ParsedExternalUrl {
  let parsed: URL;
  try {
    parsed = new URL(SCHEME_PATTERN.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  let host = parsed.hostname.endsWith('.') ? parsed.hostname.slice(0, -1) : parsed.hostname;
  if (host.startsWith(WWW_PREFIX) && host.length > WWW_PREFIX.length) {
    host = host.slice(WWW_PREFIX.length);
  }

  if (!host) {
    return null;
  }

  const port = parsed.port ? `:${parsed.port}` : '';
  const path = parsed.pathname.endsWith('/') ? parsed.pathname.slice(0, -1) : parsed.pathname;
  return { host, normalizedUrl: `${host}${port}${path}${parsed.search}` };
}

function addInlineCodeRanges(ranges: TextRange[], content: string, start: number, end: number): void {
  for (const match of content.slice(start, end).matchAll(INLINE_CODE_PATTERN)) {
    ranges.push({ end: start + match.index + match[0].length, start: start + match.index });
  }
}

function countOf(text: string, character: string): number {
  return text.split(character).length - 1;
}

/**
 * Turns offsets into locations, for offsets asked in increasing order, as the links are found: the line cursor only
 * moves forward, so a note costs one pass over its line starts.
 *
 * @param content - The note's text.
 * @returns The locator.
 */
function createLocator(content: string): (offset: number) => Loc {
  const lineStarts = [0];
  for (let index = content.indexOf('\n'); index !== -1; index = content.indexOf('\n', index + 1)) {
    lineStarts.push(index + 1);
  }

  let line = 0;
  return (offset: number): Loc => {
    while (line + 1 < lineStarts.length && readCell(lineStarts, line + 1) <= offset) {
      line++;
    }
    return { col: offset - readCell(lineStarts, line), line, offset };
  };
}

function getCodeRanges(content: string): TextRange[] {
  const ranges: TextRange[] = [];
  let fence: null | string = null;
  let fenceStart = 0;
  let proseStart = 0;
  let offset = 0;

  for (const line of content.split('\n')) {
    const lineEnd = offset + line.length + 1;
    const fenceMatch = FENCE_PATTERN.exec(line);
    const marker = fenceMatch?.groups?.['fence'];

    if (fence === null) {
      if (marker) {
        addInlineCodeRanges(ranges, content, proseStart, offset);
        fence = marker;
        fenceStart = offset;
      }
    } else if (marker?.startsWith(fence) && line.trim() === marker) {
      ranges.push({ end: lineEnd, start: fenceStart });
      fence = null;
      proseStart = lineEnd;
    }

    offset = lineEnd;
  }

  if (fence === null) {
    addInlineCodeRanges(ranges, content, proseStart, content.length);
  } else {
    // An unclosed fence runs to the end of the note, as in CommonMark.
    ranges.push({ end: content.length, start: fenceStart });
  }

  return ranges;
}

function getFrontmatterEnd(content: string): number {
  if (!content.startsWith(`${FRONTMATTER_DELIMITER}\n`) && !content.startsWith(`${FRONTMATTER_DELIMITER}\r\n`)) {
    return 0;
  }

  let offset = content.indexOf('\n') + 1;
  while (offset < content.length) {
    const nextBreak = content.indexOf('\n', offset);
    const lineEnd = nextBreak === -1 ? content.length : nextBreak;
    if (content.slice(offset, lineEnd).trimEnd() === FRONTMATTER_DELIMITER) {
      return lineEnd;
    }
    offset = lineEnd + 1;
  }

  // An unclosed block is no frontmatter, as Obsidian reads it.
  return 0;
}

// Every read is of an index the caller has already written, which the index signature cannot know.
function readCell(row: readonly number[], index: number): number {
  const value = row[index];
  /* v8 ignore next 3 -- Unreachable: the callers only read indexes they have written. */
  if (value === undefined) {
    throw new Error(`No cell at index ${String(index)}`);
  }
  return value;
}

function trimUrl(url: string): string {
  let trimmed = url;
  for (;;) {
    const last = trimmed.slice(-1);
    const isUnbalancedParenthesis = last === ')' && countOf(trimmed, ')') > countOf(trimmed, '(');
    if (!TRAILING_PUNCTUATION.includes(last) && !isUnbalancedParenthesis) {
      return trimmed;
    }
    trimmed = trimmed.slice(0, -1);
  }
}
