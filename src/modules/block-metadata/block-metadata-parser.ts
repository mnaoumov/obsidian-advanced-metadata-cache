/**
 * @file
 *
 * Reads the metadata fences of a note: fenced code blocks of the language {@link BLOCK_METADATA_LANGUAGE}, whose YAML
 * describes one block of the note the way frontmatter describes the whole note.
 *
 * A fence describes the nearest section BEFORE it that is not itself a metadata fence. Placed right under a heading
 * it describes that heading, which needs no block id, and it moves with the heading whenever the heading's section is
 * moved, sorted, merged or split, since those carry the lines under a heading along. Consecutive fences describe the
 * same section. A fence with nothing before it, or only the frontmatter, describes nothing: the frontmatter is the
 * note's own place for that.
 *
 * Only fences Obsidian lists as a `code` SECTION are read, which means top-level fences, as for `Code block links`.
 * The YAML is parsed with Obsidian's own `parseYaml`, the parser frontmatter goes through.
 */

import type {
  CachedMetadata,
  SectionCache
} from 'obsidian';

import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { parseYaml } from 'obsidian';

import type {
  BlockMetadata,
  BlockMetadataTarget
} from '../../plugin-api.ts';

import {
  findFencedCodeBlocks,
  getIndentLength
} from '../code-block-links/code-block-references.ts';

/**
 * The language of a metadata fence, as written after its opening fence. Matched exactly.
 */
export const BLOCK_METADATA_LANGUAGE = 'advanced-metadata-cache';

/**
 * What {@link findBlockMetadata} reads.
 */
export interface FindBlockMetadataParams {
  readonly cache: CachedMetadata;
  readonly text: string;
}

/**
 * The error a fence whose YAML is a list or a scalar is listed with.
 */
export const NOT_A_MAPPING_ERROR = 'The metadata is not a mapping of property names to values.';

interface ParsedProperties {
  readonly error: null | string;
  readonly properties: null | Readonly<Record<string, unknown>>;
}

/**
 * Copies a value made of JSON values only, so nothing handed out shares an object with the index. `structuredClone`
 * is not used because the supported Node range predates it.
 *
 * @param value - The value.
 * @returns Its copy.
 */
export function cloneJson<T>(value: T): T {
  // Only ever called with JSON values, whose text is never `undefined`.
  return JSON.parse(JSON.stringify(value) as string) as T;
}

/**
 * Reads every metadata fence of a note.
 *
 * @param params - The note's text and its cache entry.
 * @returns The fences, in the order they appear in the note.
 */
export function findBlockMetadata(params: FindBlockMetadataParams): BlockMetadata[] {
  const sections = params.cache.sections ?? [];
  if (!hasCodeSectionIn(sections)) {
    return [];
  }

  const lines = params.text.split('\n');
  const metadataBlocks = findFencedCodeBlocks(lines, sections).filter((block) => block.language === BLOCK_METADATA_LANGUAGE);
  if (metadataBlocks.length === 0) {
    return [];
  }

  const metadataStartLines = new Set(metadataBlocks.map((block) => block.contentStartLine - 1));
  const blockMetadataList: BlockMetadata[] = [];

  for (const block of metadataBlocks) {
    const sectionIndex = sections.findIndex((section) => section.position.start.line === block.contentStartLine - 1);
    const section = ensureNonNullable(sections[sectionIndex]);

    const contentLines: string[] = [];
    for (let line = block.contentStartLine; line < block.contentEndLine; line++) {
      const lineText = ensureNonNullable(lines[line]);
      contentLines.push(lineText.slice(getIndentLength(lineText, block.indent)));
    }

    blockMetadataList.push({
      ...parseProperties(contentLines.join('\n')),
      position: cloneJson(section.position),
      target: findTarget(params.cache, sections, sectionIndex, metadataStartLines)
    });
  }

  return blockMetadataList;
}

/**
 * Whether a note may hold a metadata fence at all, from its cache alone: the check that needs no text.
 *
 * @param cache - The note's cache entry.
 * @returns Whether Obsidian lists a code section for it.
 */
export function hasCodeSection(cache: CachedMetadata): boolean {
  return hasCodeSectionIn(cache.sections ?? []);
}

function findTarget(cache: CachedMetadata, sections: readonly SectionCache[], sectionIndex: number, metadataStartLines: ReadonlySet<number>): BlockMetadataTarget | null {
  let targetIndex = sectionIndex - 1;
  while (targetIndex >= 0 && metadataStartLines.has(ensureNonNullable(sections[targetIndex]).position.start.line)) {
    targetIndex--;
  }

  const target = sections[targetIndex];
  // The frontmatter is the note's, never a block's.
  if (!target || target.type === 'yaml') {
    return null;
  }

  const heading = target.type === 'heading'
    ? cache.headings?.find((headingCache) => headingCache.position.start.line === target.position.start.line) ?? null
    : null;

  return {
    blockId: target.id ?? null,
    heading: heading?.heading ?? null,
    level: heading?.level ?? null,
    position: cloneJson(target.position),
    type: target.type
  };
}

function hasCodeSectionIn(sections: readonly SectionCache[]): boolean {
  return sections.some((section) => section.type === 'code');
}

function parseProperties(yaml: string): ParsedProperties {
  let value: unknown;
  try {
    value = parseYaml(yaml);
  } catch (error) {
    /* v8 ignore next -- parseYaml throws only Error instances. */
    return { error: error instanceof Error ? error.message : String(error), properties: null };
  }

  // An empty fence is an empty mapping, as an empty frontmatter is.
  if (value === null || value === undefined) {
    return { error: null, properties: {} };
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return { error: NOT_A_MAPPING_ERROR, properties: null };
  }

  // Through JSON, so a date YAML read as a `Date` is a string, as in frontmatter.
  return { error: null, properties: cloneJson(value as Record<string, unknown>) };
}
