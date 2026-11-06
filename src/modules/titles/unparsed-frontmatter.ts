/**
 * @file
 *
 * Finds a note whose frontmatter block is there but does not parse, which is the one way a note's titles and
 * aliases vanish with no sign of why.
 *
 * Obsidian's metadata worker keeps the block's `yaml` entry in `sections` and drops `frontmatter` and
 * `frontmatterPosition` when the YAML throws, and it says nothing. A note with a key written twice (`mtime:` on
 * line 3 and again on line 9) therefore has no `title` and no `aliases` as far as every reader of the cache is
 * concerned, the core Quick switcher included, while the Properties view and the text still show them.
 */

import type {
  CachedMetadata,
  Pos
} from 'obsidian';

import { parseYaml } from 'obsidian';

const FRONTMATTER_DELIMITER_LINE_REGEX = /^---[ \t]*$/;

/**
 * The opening delimiter and at least one more line.
 */
const MIN_BLOCK_LINE_COUNT = 2;

/**
 * Parses a note's frontmatter block again, to get the error Obsidian's worker swallowed.
 *
 * @param text - The note's text.
 * @param position - The block's position, from {@link getUnparsedFrontmatterPosition}.
 * @returns The YAML error's message, or `null` when the block parses (empty, a scalar, a list or a mapping).
 */
export function getFrontmatterParseError(text: string, position: Pos): null | string {
  const lines = text.slice(position.start.offset, position.end.offset).split(/\r?\n/);

  if (lines.length < MIN_BLOCK_LINE_COUNT || !FRONTMATTER_DELIMITER_LINE_REGEX.test(lines[0] ?? '')) {
    return null;
  }

  const lastLine = lines.at(-1) ?? '';
  const yaml = (FRONTMATTER_DELIMITER_LINE_REGEX.test(lastLine) ? lines.slice(1, -1) : lines.slice(1)).join('\n');

  if (!yaml.trim()) {
    return null;
  }

  try {
    parseYaml(yaml);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Whether a note's cache says its frontmatter block may have failed to parse: the block is there, and nothing was
 * read out of it. Cheap, so it is asked of every note before any is read.
 *
 * An empty block, or one that parses to a scalar or a list, looks the same from here, which is why the text is
 * parsed again by {@link getFrontmatterParseError} before anything is reported.
 *
 * @param cache - The note's metadata cache entry.
 * @returns The block's position, when the note is a candidate; otherwise `null`.
 */
export function getUnparsedFrontmatterPosition(cache: CachedMetadata | null | undefined): null | Pos {
  if (!cache || cache.frontmatter) {
    return null;
  }

  const firstSection = cache.sections?.[0];
  return firstSection?.type === 'yaml' ? firstSection.position : null;
}
