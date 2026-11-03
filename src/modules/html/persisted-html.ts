import type { IndexedFileRecord } from '@mnaoumov/obsidian-lib/components/incremental-file-index-component';
import type { Loc } from 'obsidian';

import type { HtmlRange } from '../../plugin-api.ts';

interface HtmlDocument {
  readonly notes: Readonly<Record<string, IndexedFileRecord<readonly HtmlRange[]>>>;
  readonly version: number;
}

// Bump both the schema and store identity whenever HTML extraction changes.
export const HTML_VERSION = 1;

/**
 * Reads a checkpoint, dropping malformed notes so the shared reader scans them again.
 *
 * @param json - The saved document.
 * @returns Valid per-note records, or an empty map for an incompatible checkpoint.
 */
export function parsePersistedHtmlRanges(json: null | string): ReadonlyMap<string, IndexedFileRecord<readonly HtmlRange[]>> {
  const notes = new Map<string, IndexedFileRecord<readonly HtmlRange[]>>();
  let value: unknown;
  try {
    value = JSON.parse(json ?? 'null');
  } catch {
    return notes;
  }
  if (!isObject(value) || value['version'] !== HTML_VERSION || !isObject(value['notes'])) {
    return notes;
  }
  for (const [path, entry] of Object.entries(value['notes'])) {
    if (
      isObject(entry) && isNonnegativeNumber(entry['mtime']) && isNonnegativeNumber(entry['size'])
      && Array.isArray(entry['record']) && entry['record'].every(isHtmlRange)
    ) {
      notes.set(path, { mtime: entry['mtime'], record: entry['record'], size: entry['size'] });
    }
  }
  return notes;
}

/**
 * Writes the exact records observed by the reader, including empty range lists and their original stats.
 *
 * @param notes - Per-note records.
 * @returns The versioned checkpoint.
 */
export function stringifyPersistedHtmlRanges(notes: ReadonlyMap<string, IndexedFileRecord<readonly HtmlRange[]>>): string {
  const document: HtmlDocument = { notes: Object.fromEntries(notes), version: HTML_VERSION };
  return JSON.stringify(document);
}

function isHtmlRange(value: unknown): value is HtmlRange {
  return isObject(value) && typeof value['html'] === 'string' && typeof value['isClosing'] === 'boolean'
    && (value['kind'] === 'tag' || value['kind'] === 'block')
    && typeof value['namespace'] === 'string' && ['html', 'mathml', 'svg'].includes(value['namespace'])
    && (value['kind'] === 'block' ? value['tagName'] === null : typeof value['tagName'] === 'string' && /^[a-z][a-z\d-]*$/.test(value['tagName']))
    && isObject(value['position']) && isLoc(value['position']['start']) && isLoc(value['position']['end'])
    && value['position']['end'].offset - value['position']['start'].offset === value['html'].length;
}
function isLoc(value: unknown): value is Loc {
  return isObject(value) && isNonnegativeNumber(value['line']) && isNonnegativeNumber(value['col']) && isNonnegativeNumber(value['offset'])
    && Number.isSafeInteger(value['line']) && Number.isSafeInteger(value['col']) && Number.isSafeInteger(value['offset']);
}

function isNonnegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
