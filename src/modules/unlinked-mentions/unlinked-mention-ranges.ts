import type {
  CachedMetadata,
  TFile
} from 'obsidian';

import { parseFrontMatterAliases } from 'obsidian';

import { createMentionRegExp } from './word-characters.ts';

/**
 * A matched span of a note's text, `[start, end)` in UTF-16 offsets: the shape Obsidian's search results take.
 */
export type MentionRange = [number, number];

interface FindMentionRangesParams {
  /**
   * The mentioning note's metadata, whose links, embeds and frontmatter hide the matches inside them.
   */
  readonly cache: CachedMetadata | null;

  /**
   * The mentioning note's text.
   */
  readonly content: string;

  /**
   * The names of the mentioned note, as {@link getMentionNames} lists them.
   */
  readonly names: readonly string[];
}

/**
 * Finds the unlinked mentions of a note in another note's text, the way Obsidian 1.14.4's `recomputeUnlinked` finds
 * them: every match of each name in turn, in the order the names are listed, dropping each match whose span lies
 * wholly inside a link, an embed or the frontmatter. A match inside code counts, as it does in Obsidian.
 *
 * @param params - The note's text and metadata, and the names to look for.
 * @returns The spans, in Obsidian's order: by name, then by position. Empty when nothing is mentioned.
 */
export function findMentionRanges(params: FindMentionRangesParams): MentionRange[] {
  const { cache, content, names } = params;
  const matchedRanges: MentionRange[] = [];

  for (const name of names) {
    // An empty name would match at every offset without advancing, forever.
    if (!name) {
      continue;
    }

    const regExp = createMentionRegExp(name);
    for (let match = regExp.exec(content); match; match = regExp.exec(content)) {
      const end = regExp.lastIndex;
      /* v8 ignore start -- Group 1 is the name itself, which every match captures. */
      const nameLength = match[1]?.length ?? 0;
      /* v8 ignore stop */
      matchedRanges.push([end - nameLength, end]);
    }
  }

  return matchedRanges.filter((range) => !isHidden(range, cache));
}

/**
 * Lists the names Obsidian looks for when it finds a note's unlinked mentions: its basename, then each of its
 * `aliases`, trimmed, empty ones dropped.
 *
 * @param file - The mentioned note.
 * @param cache - Its metadata, or `null` when it has none.
 * @returns The names, the basename first.
 */
export function getMentionNames(file: TFile, cache: CachedMetadata | null): string[] {
  // Obsidian's own alias reader, which trims each alias and drops the empty ones.
  return [file.basename, ...parseFrontMatterAliases(cache?.frontmatter) ?? []];
}

function isHidden(range: MentionRange, cache: CachedMetadata | null): boolean {
  if (!cache) {
    return false;
  }

  const [start, end] = range;
  for (const reference of [...cache.links ?? [], ...cache.embeds ?? []]) {
    if (reference.position.start.offset <= start && reference.position.end.offset >= end) {
      return true;
    }
  }

  const frontmatterPosition = cache.frontmatterPosition;
  return !!frontmatterPosition && frontmatterPosition.start.offset <= start && frontmatterPosition.end.offset >= end;
}
