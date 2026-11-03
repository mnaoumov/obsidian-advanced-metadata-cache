import type { IndexedFileRecord } from '@mnaoumov/obsidian-lib/components/incremental-file-index-component';
import type { Loc } from 'obsidian';

import type { ExternalLink } from '../../plugin-api.ts';

interface ExternalLinkDocument {
  readonly notes: Readonly<Record<string, IndexedFileRecord<readonly ExternalLink[]>>>;
  readonly version: number;
}

// Bump both the schema and store identity whenever extraction or URL normalization changes.
export const EXTERNAL_LINKS_VERSION = 1;

/**
 * Reads a checkpoint, dropping malformed notes so the shared reader scans them again.
 *
 * @param json - The saved document.
 * @returns Valid per-note records, or an empty map for an incompatible checkpoint.
 */
export function parsePersistedExternalLinks(json: null | string): ReadonlyMap<string, IndexedFileRecord<readonly ExternalLink[]>> {
  const notes = new Map<string, IndexedFileRecord<readonly ExternalLink[]>>();
  let value: unknown;
  try {
    value = JSON.parse(json ?? 'null');
  } catch {
    return notes;
  }
  if (!isObject(value) || value['version'] !== EXTERNAL_LINKS_VERSION || !isObject(value['notes'])) {
    return notes;
  }
  for (const [path, entry] of Object.entries(value['notes'])) {
    if (
      isObject(entry) && isNonnegativeNumber(entry['mtime']) && isNonnegativeNumber(entry['size'])
      && Array.isArray(entry['record']) && entry['record'].every(isExternalLink)
    ) {
      notes.set(path, { mtime: entry['mtime'], record: entry['record'], size: entry['size'] });
    }
  }
  return notes;
}

/**
 * Writes the exact records observed by the reader, including empty link lists and their original stats.
 *
 * @param notes - Per-note records.
 * @returns The versioned checkpoint.
 */
export function stringifyPersistedExternalLinks(notes: ReadonlyMap<string, IndexedFileRecord<readonly ExternalLink[]>>): string {
  const document: ExternalLinkDocument = { notes: Object.fromEntries(notes), version: EXTERNAL_LINKS_VERSION };
  return JSON.stringify(document);
}

function isExternalLink(value: unknown): value is ExternalLink {
  return isObject(value) && typeof value['host'] === 'string' && typeof value['normalizedUrl'] === 'string'
    && typeof value['url'] === 'string' && typeof value['isInFrontmatter'] === 'boolean'
    && isObject(value['position']) && isLoc(value['position']['start']) && isLoc(value['position']['end'])
    && value['position']['start'].offset <= value['position']['end'].offset;
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
