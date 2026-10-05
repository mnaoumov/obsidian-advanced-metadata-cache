/**
 * @file
 *
 * The pure half of the `Headings` module: what a note's headings look like at one moment, and which
 * heading of one moment is which heading of the next.
 *
 * Obsidian keeps no identity for a heading. Its metadata cache lists a note's headings afresh on every
 * parse, so "the same heading" has to be worked out by comparing two parses. Nothing is ever written into
 * the note to help, because the whole point of the module is metadata the note does not carry.
 *
 * The comparison runs in four passes, each over what the previous ones left unpaired:
 *
 * 1. **Same text**, paired in document order. A heading that moved, or changed level, keeps its text.
 * 2. **Same own body**, i.e. the text between it and the next heading of any level, when that body is not
 *    empty. A heading renamed while its paragraph stayed put — wherever it moved to.
 * 3. **Same place**: an unpaired new heading between the same two paired neighbors as an unpaired old one.
 *    A heading renamed in place whose body was edited too.
 * 4. What is left is new (created now) or gone.
 *
 * Its limits, stated rather than hidden: a heading deleted and the same text typed elsewhere is read as a
 * move, and two headings with the same text that swap places keep each other's history. Both are
 * indistinguishable from what they are mistaken for in the two parses alone.
 */

import type { HeadingCache } from 'obsidian';

/**
 * One heading of one parse of a note.
 */
export interface HeadingSnapshot {
  /**
   * A hash of the heading's own body: the lines between it and the next heading of ANY level, with
   * surrounding blank lines dropped. Empty when that body is empty.
   */
  readonly bodyHash: string;

  /**
   * The heading level, 1 to 6.
   */
  readonly level: number;

  /**
   * The zero-based line the heading is on.
   */
  readonly line: number;

  /**
   * A hash of the heading's whole section: its level, its text and everything under it up to the next
   * heading of the same or a higher level, children included. A change to it is what makes the heading
   * MODIFIED, so a rename or a level change counts and a move of the whole section does not.
   */
  readonly subtreeHash: string;

  /**
   * The heading text, exactly as the metadata cache reports it.
   */
  readonly text: string;
}

/**
 * What a matcher needs from one side of the comparison.
 */
export interface MatchableHeading {
  readonly bodyHash: string;
  readonly text: string;
}

/**
 * The state the matcher's passes share: which old heading each new heading continues so far, and which
 * old headings are taken.
 */
interface MatcherState {
  readonly matchedOldIndices: Set<number>;
  readonly matches: Map<number, number>;
  readonly newHeadings: readonly MatchableHeading[];
  readonly oldHeadings: readonly MatchableHeading[];
}

/**
 * Hashes a string's UTF-8 bytes with 32-bit FNV-1a, rendered in base 36.
 *
 * A change detector, not a security boundary: two different sections colliding costs one missed
 * `modified` stamp, which is the same as the edit never having been seen.
 *
 * @param text - The text to hash.
 * @returns The hash.
 */
export function hashText(text: string): string {
  // eslint-disable-next-line no-magic-numbers -- The FNV-1a 32-bit offset basis.
  let hash = 0x81_1C_9D_C5;

  for (const byte of new TextEncoder().encode(text)) {
    // eslint-disable-next-line no-bitwise -- FNV-1a is defined on XOR.
    hash ^= byte;
    // eslint-disable-next-line no-magic-numbers -- The FNV-1a 32-bit prime.
    hash = Math.imul(hash, 0x01_00_01_93);
  }

  // eslint-disable-next-line no-bitwise, no-magic-numbers -- `>>> 0` reads the 32 bits as unsigned; base 36 is the shortest radix `toString` offers.
  return (hash >>> 0).toString(36);
}

/**
 * Pairs each heading of a new parse with the heading of the previous parse it continues, if any.
 *
 * @param oldHeadings - The previous parse, in document order.
 * @param newHeadings - The new parse, in document order.
 * @returns The index of the old heading each new heading continues, keyed by the new heading's index. A new
 *   heading that continues nothing has no entry.
 */
export function matchHeadings(oldHeadings: readonly MatchableHeading[], newHeadings: readonly MatchableHeading[]): Map<number, number> {
  const state: MatcherState = { matchedOldIndices: new Set(), matches: new Map(), newHeadings, oldHeadings };

  pairByKey(state, (heading) => heading.text);
  pairByKey(state, (heading) => heading.bodyHash);
  pairByPosition(state);

  return new Map([...state.matches].sort(([newIndex1], [newIndex2]) => newIndex1 - newIndex2));
}

/**
 * Reads a note's headings, with the hashes the matcher and the `modified` stamp need.
 *
 * @param content - The note's content.
 * @param headingCaches - The headings the metadata cache found in that content.
 * @returns The headings, in document order.
 */
export function readHeadingSnapshots(content: string, headingCaches: readonly HeadingCache[] | undefined): HeadingSnapshot[] {
  if (!headingCaches || headingCaches.length === 0) {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const headings = headingCaches.map((headingCache) => ({
    level: headingCache.level,
    line: headingCache.position.start.line,
    text: headingCache.heading
  }));

  return headings.map((heading, index) => {
    const nextHeadingLine = headings[index + 1]?.line ?? lines.length;
    let subtreeEndLine = lines.length;

    for (const laterHeading of headings.slice(index + 1)) {
      if (laterHeading.level <= heading.level) {
        subtreeEndLine = laterHeading.line;
        break;
      }
    }

    const body = joinTrimmed(lines.slice(heading.line + 1, nextHeadingLine));

    return {
      bodyHash: body ? hashText(body) : '',
      level: heading.level,
      line: heading.line,
      subtreeHash: hashText(`${String(heading.level)}\n${heading.text}\n${joinTrimmed(lines.slice(heading.line + 1, subtreeEndLine))}`),
      text: heading.text
    };
  });
}

/**
 * Finds the old partner of the nearest paired new heading before or after one.
 *
 * @param state - The matcher state.
 * @param newIndex - The new heading to look around.
 * @param step - `-1` to look before it, `1` to look after it.
 * @returns The partner's index, or `null` when no heading on that side is paired.
 */
function findNeighborMatch(state: MatcherState, newIndex: number, step: -1 | 1): null | number {
  for (let index = newIndex + step; index >= 0 && index < state.newHeadings.length; index += step) {
    const oldIndex = state.matches.get(index);

    if (oldIndex !== undefined) {
      return oldIndex;
    }
  }

  return null;
}

/**
 * Joins lines after dropping trailing whitespace from each and blank lines from both ends, so a section
 * that only gained or lost a blank line at its edge, or trailing spaces, is not read as changed.
 *
 * @param lines - The lines.
 * @returns The joined text.
 */
function joinTrimmed(lines: readonly string[]): string {
  return lines.map((line) => line.trimEnd()).join('\n').trim();
}

function pair(state: MatcherState, newIndex: number, oldIndex: number): void {
  state.matches.set(newIndex, oldIndex);
  state.matchedOldIndices.add(oldIndex);
}

function pairByKey(state: MatcherState, getKey: (heading: MatchableHeading) => string): void {
  const unmatchedOldIndicesByKey = new Map<string, number[]>();

  for (const [oldIndex, oldHeading] of state.oldHeadings.entries()) {
    const key = getKey(oldHeading);

    if (state.matchedOldIndices.has(oldIndex) || !key) {
      continue;
    }

    const oldIndices = unmatchedOldIndicesByKey.get(key) ?? [];
    oldIndices.push(oldIndex);
    unmatchedOldIndicesByKey.set(key, oldIndices);
  }

  for (const [newIndex, newHeading] of state.newHeadings.entries()) {
    if (state.matches.has(newIndex)) {
      continue;
    }

    const oldIndex = unmatchedOldIndicesByKey.get(getKey(newHeading))?.shift();

    if (oldIndex !== undefined) {
      pair(state, newIndex, oldIndex);
    }
  }
}

/**
 * Pairs an unpaired new heading with the first unpaired old heading that sits between the old partners of
 * its nearest paired neighbors. Neighbors whose partners are out of order (the heading's surroundings
 * were themselves reordered) bound no gap, and nothing is paired across them.
 *
 * @param state - The matcher state.
 */
function pairByPosition(state: MatcherState): void {
  for (const newIndex of state.newHeadings.keys()) {
    if (state.matches.has(newIndex)) {
      continue;
    }

    const lowerBound = findNeighborMatch(state, newIndex, -1) ?? -1;
    const upperBound = findNeighborMatch(state, newIndex, 1) ?? state.oldHeadings.length;

    for (let oldIndex = lowerBound + 1; oldIndex < upperBound; oldIndex++) {
      if (!state.matchedOldIndices.has(oldIndex)) {
        pair(state, newIndex, oldIndex);
        break;
      }
    }
  }
}
