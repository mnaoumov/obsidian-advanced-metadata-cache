/**
 * @file
 *
 * What one note's links contribute to the {@link LinkTextIndex}: which file each link points at, and the display
 * text it shows instead of that file's name.
 *
 * A link counts only when its display text was WRITTEN: `[[bravo|alpha]]`, `[alpha](bravo.md)`, their embed forms,
 * and the same in a frontmatter value. `[[bravo]]` has a display text too, as far as the metadata cache is
 * concerned, but it is the link path, not a name anybody gave the file. A written text that is only the file's own
 * name again (`[bravo](bravo.md)`, `[[Notes/bravo|Notes/bravo]]`) adds nothing, compared the way Obsidian matches a
 * name: case-insensitively, with runs of whitespace collapsed.
 */

import type {
  CachedMetadata,
  Reference
} from 'obsidian';

import { getReferences } from '@mnaoumov/obsidian-lib/metadata-cache';
import { parseLink } from '@mnaoumov/obsidian-lib/parse-link';

import type { LinkTextContribution } from './link-text-index.ts';

/**
 * Params for {@link readLinkTexts}.
 */
export interface ReadLinkTextsParams {
  /**
   * The note's cached metadata.
   */
  readonly cache: CachedMetadata;

  /**
   * Resolves a reference of this note to the path of the file it points at.
   */
  readonly resolveTargetPath: (reference: Reference) => null | string;
}

/**
 * An embed's size, which Obsidian reads from the end of its display text: `|300` or `|300x200`.
 */
const EMBED_SIZE_SUFFIX_REGEXP = /(?:^|\|)\s*\d+(?:\s*x\s*\d+)?\s*$/u;

const WHITESPACE_RUN_REGEXP = /\s+/gu;

/**
 * Reads the written display text of a reference, if it has one.
 *
 * @param reference - The reference, as the metadata cache holds it.
 * @returns The text, trimmed, with an embed's size dropped; `null` for a reference with none.
 */
export function getWrittenLinkText(reference: Reference): null | string {
  const parseLinkResult = parseLink(reference.original);

  if (!parseLinkResult || parseLinkResult.isExternal) {
    return null;
  }

  let text = parseLinkResult.unescapedAlias ?? parseLinkResult.alias ?? '';

  if (parseLinkResult.isEmbed) {
    text = text.replace(EMBED_SIZE_SUFFIX_REGEXP, '');
  }

  text = text.trim();
  return text || null;
}

/**
 * Reads what a note's links contribute.
 *
 * @param params - The note's cache, and how to resolve its links.
 * @returns One contribution per counting link, in the order `getReferences` sorts them.
 */
export function readLinkTexts(params: ReadLinkTextsParams): LinkTextContribution[] {
  const contributions: LinkTextContribution[] = [];

  for (const reference of getReferences({ cache: params.cache })) {
    const text = getWrittenLinkText(reference);

    if (text === null) {
      continue;
    }

    const targetPath = params.resolveTargetPath(reference);

    if (targetPath === null || isOwnName(text, targetPath)) {
      continue;
    }

    contributions.push({ targetPath, text });
  }

  return contributions;
}

/**
 * Whether a text is only the target's own name again: its path or its file name, each with or without the
 * extension.
 *
 * @param text - The written display text.
 * @param targetPath - The target's path.
 * @returns Whether the text adds nothing.
 */
function isOwnName(text: string, targetPath: string): boolean {
  const normalizedText = normalizeName(text);
  const name = targetPath.slice(targetPath.lastIndexOf('/') + 1);
  const extensionIndex = name.lastIndexOf('.');
  const pathWithoutExtension = extensionIndex > 0 ? targetPath.slice(0, targetPath.length - name.length + extensionIndex) : targetPath;
  const basename = extensionIndex > 0 ? name.slice(0, extensionIndex) : name;

  return [targetPath, pathWithoutExtension, name, basename].some((ownName) => normalizeName(ownName) === normalizedText);
}

function normalizeName(name: string): string {
  return name.trim().replaceAll(WHITESPACE_RUN_REGEXP, ' ').toLowerCase();
}
