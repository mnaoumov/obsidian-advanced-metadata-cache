/**
 * @file
 *
 * The one matcher behind every setting that lists names or `*` patterns: `datePropertyNames` and
 * `codeBlockLinkLanguages`, so the two settings mean the same thing by the same entry.
 */

import { escapeRegExp } from '@mnaoumov/typescript-lib/reg-exp';

const WILDCARD = '*';

/**
 * Whether a name matches one of the configured entries: an exact name, or a pattern in which each `*` stands for
 * any run of characters, the empty one included. Matched over the whole name and case-sensitively, so `*Date`
 * matches `birthDate` and `Date` but not `update`.
 *
 * @param patterns - The configured entries; blank ones match nothing.
 * @param name - The name.
 * @returns Whether any entry matches it.
 */
export function isMatchingNamePatterns(patterns: readonly string[], name: string): boolean {
  return patterns.some((entry) => isMatchingPattern(entry.trim(), name));
}

function isMatchingPattern(pattern: string, name: string): boolean {
  if (!pattern) {
    return false;
  }

  if (!pattern.includes(WILDCARD)) {
    return pattern === name;
  }

  const source = pattern.split(WILDCARD).map((part) => escapeRegExp(part)).join('.*');
  return new RegExp(`^${source}$`, 'u').test(name);
}
