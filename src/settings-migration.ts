/**
 * @file
 *
 * The value half of a settings migration: checking what another plugin proposes, and merging the proposed
 * title properties into the ones this plugin holds.
 *
 * Kept apart from the dialog so the merge is testable without a modal, and apart from the API surface so the
 * contract stays a plain description of types.
 */

import type { AdvancedMetadataCacheMigratableSettings } from './plugin-api.ts';

/**
 * Parameters for {@link mergeTitlePropertyNames}.
 */
export interface MergeTitlePropertyNamesParams {
  /**
   * The title properties this plugin holds now.
   */
  readonly currentTitlePropertyNames: readonly string[];

  /**
   * The title properties another plugin proposes.
   */
  readonly proposedTitlePropertyNames: readonly string[];
}

/**
 * Checks a proposal that crossed a plugin boundary, rather than trusting its declared type.
 *
 * @param proposedSettings - The proposal as it arrived.
 * @returns The proposed title properties, trimmed, with blanks dropped.
 * @throws {TypeError} When `titlePropertyNames` is present but is not a list of strings.
 */
export function getProposedTitlePropertyNames(proposedSettings: AdvancedMetadataCacheMigratableSettings): string[] {
  const titlePropertyNames: unknown = proposedSettings.titlePropertyNames;

  if (titlePropertyNames === undefined) {
    return [];
  }

  if (!Array.isArray(titlePropertyNames) || titlePropertyNames.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`Setting "titlePropertyNames" expects a list of strings, got ${String(JSON.stringify(titlePropertyNames))}`);
  }

  return parseTitlePropertyNames(titlePropertyNames as string[]);
}

/**
 * Adds the proposed title properties to the current ones.
 *
 * A merge rather than a replacement, so a user who already has `title` keeps it: the current list keeps its
 * order, and each proposed name it does not already carry — compared case-insensitively — is appended.
 *
 * @param params - The current and proposed lists.
 * @returns The merged list.
 */
export function mergeTitlePropertyNames(params: MergeTitlePropertyNamesParams): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const titlePropertyName of parseTitlePropertyNames([...params.currentTitlePropertyNames, ...params.proposedTitlePropertyNames])) {
    const key = titlePropertyName.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(titlePropertyName);
  }

  return merged;
}

/**
 * Reads a list of property names the way the dialog's text box states it — one per line.
 *
 * @param lines - The raw entries.
 * @returns The entries, trimmed, with blanks dropped.
 */
export function parseTitlePropertyNames(lines: readonly string[]): string[] {
  return lines
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
