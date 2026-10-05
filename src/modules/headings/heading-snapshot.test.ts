import type { HeadingCache } from 'obsidian';

import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { MatchableHeading } from './heading-snapshot.ts';

import {
  hashText,
  matchHeadings,
  readHeadingSnapshots
} from './heading-snapshot.ts';

describe('hashText', () => {
  it('should answer the same hash for the same text and a different one for different text', () => {
    expect(hashText('alpha')).toBe(hashText('alpha'));
    expect(hashText('alpha')).not.toBe(hashText('beta'));
  });

  it('should hash the empty string to the FNV-1a offset basis', () => {
    expect(hashText('')).toBe((0x81_1C_9D_C5).toString(36));
  });
});

describe('readHeadingSnapshots', () => {
  it('should answer nothing for a note without headings', () => {
    expect(readHeadingSnapshots('text', undefined)).toEqual([]);
    expect(readHeadingSnapshots('text', [])).toEqual([]);
  });

  it('should read each heading with its text, level and line', () => {
    const content = '# One\nbody\n## Two\nmore';
    const snapshots = readHeadingSnapshots(content, headingCachesOf(content));

    expect(snapshots.map(({ level, line, text }) => ({ level, line, text }))).toEqual([
      { level: 1, line: 0, text: 'One' },
      { level: 2, line: 2, text: 'Two' }
    ]);
  });

  it('should give a heading with an empty own body an empty body hash', () => {
    const content = '# One\n\n## Two\nbody';
    const [one, two] = readHeadingSnapshots(content, headingCachesOf(content));

    expect(one?.bodyHash).toBe('');
    expect(two?.bodyHash).toBe(hashText('body'));
  });

  it('should include the children in the subtree but not the own body', () => {
    const before = '# One\nbody\n## Two\nchild';
    const after = '# One\nbody\n## Two\nchild edited';
    const [oneBefore] = readHeadingSnapshots(before, headingCachesOf(before));
    const [oneAfter] = readHeadingSnapshots(after, headingCachesOf(after));

    expect(oneAfter?.bodyHash).toBe(oneBefore?.bodyHash);
    expect(oneAfter?.subtreeHash).not.toBe(oneBefore?.subtreeHash);
  });

  it('should end a subtree at the next heading of the same or a higher level', () => {
    const before = '## One\nbody\n# Two\nother';
    const after = '## One\nbody\n# Two\nother edited';
    const [oneBefore] = readHeadingSnapshots(before, headingCachesOf(before));
    const [oneAfter] = readHeadingSnapshots(after, headingCachesOf(after));

    expect(oneAfter?.subtreeHash).toBe(oneBefore?.subtreeHash);
  });

  it('should ignore trailing whitespace and blank lines at the edges of a section', () => {
    const before = '# One\nbody\n# Two';
    const after = '# One  \n\nbody   \n\n\n# Two';
    const [oneBefore] = readHeadingSnapshots(before, headingCachesOf(before));
    const [oneAfter] = readHeadingSnapshots(after, headingCachesOf(after));

    expect(oneAfter?.subtreeHash).toBe(oneBefore?.subtreeHash);
    expect(oneAfter?.bodyHash).toBe(oneBefore?.bodyHash);
  });

  it('should split CRLF content into the same lines as LF content', () => {
    const lf = '# One\nbody';
    const crlf = '# One\r\nbody';

    expect(readHeadingSnapshots(crlf, headingCachesOf(lf))).toEqual(readHeadingSnapshots(lf, headingCachesOf(lf)));
  });
});

describe('matchHeadings', () => {
  it('should pair headings with the same text, in document order, whatever moved', () => {
    const matches = matchHeadings(
      [heading('A'), heading('B'), heading('A')],
      [heading('B'), heading('A'), heading('A')]
    );

    expect([...matches]).toEqual([[0, 1], [1, 0], [2, 2]]);
  });

  it('should pair a renamed heading by its own body, even after a move', () => {
    const matches = matchHeadings(
      [heading('Old', 'body'), heading('Other', 'other')],
      [heading('Other', 'other'), heading('New', 'body')]
    );

    expect(matches.get(1)).toBe(0);
  });

  it('should not pair two headings by an empty body', () => {
    const matches = matchHeadings(
      [heading('Kept'), heading('Old')],
      [heading('New'), heading('Kept')]
    );

    expect(matches.get(0)).toBeUndefined();
  });

  it('should pair a heading renamed in place, between the same neighbors, whose body changed too', () => {
    const matches = matchHeadings(
      [heading('A', 'a'), heading('Old', 'old body'), heading('C', 'c')],
      [heading('A', 'a'), heading('New', 'new body'), heading('C', 'c')]
    );

    expect(matches.get(1)).toBe(1);
  });

  it('should pair a renamed first and last heading against the open ends', () => {
    const matches = matchHeadings(
      [heading('Old first', 'x'), heading('Middle', 'm'), heading('Old last', 'y')],
      [heading('New first', 'z'), heading('Middle', 'm'), heading('New last', 'w')]
    );

    expect([...matches]).toEqual([[0, 0], [1, 1], [2, 2]]);
  });

  it('should pair two adjacent headings renamed in place, one after the other', () => {
    const matches = matchHeadings(
      [heading('A', 'a'), heading('X', 'x'), heading('Y', 'y'), heading('B', 'b')],
      [heading('A', 'a'), heading('X2', 'x2'), heading('Y2', 'y2'), heading('B', 'b')]
    );

    expect([...matches]).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
  });

  it('should skip an old heading in the gap that another pass already took', () => {
    const matches = matchHeadings(
      [heading('A', 'a'), heading('Moved', 'm'), heading('Old', 'o'), heading('B', 'b')],
      [heading('A', 'a'), heading('New', 'n'), heading('B', 'b'), heading('Moved', 'm')]
    );

    expect(matches.get(1)).toBe(2);
  });

  it('should answer a heading with no counterpart as new', () => {
    const matches = matchHeadings(
      [heading('A', 'a'), heading('B', 'b')],
      [heading('A', 'a'), heading('Inserted', 'i'), heading('B', 'b')]
    );

    expect(matches.get(1)).toBeUndefined();
    expect(matches.size).toBe(2);
  });

  it('should not pair across neighbors whose partners were reordered', () => {
    const matches = matchHeadings(
      [heading('A', 'a'), heading('Old', 'o'), heading('B', 'b')],
      [heading('B', 'b'), heading('New', 'n'), heading('A', 'a')]
    );

    expect(matches.get(1)).toBeUndefined();
  });

  it('should answer nothing to pair against an empty previous parse', () => {
    expect(matchHeadings([], [heading('A')]).size).toBe(0);
  });
});

function heading(text: string, body = ''): MatchableHeading {
  return { bodyHash: body ? hashText(body) : '', text };
}

/**
 * Reads a note's headings the way the metadata cache does, through `obsidian-test-mocks`' own parser.
 *
 * @param content - The note's content.
 * @returns The headings.
 */
function headingCachesOf(content: string): HeadingCache[] | undefined {
  const app = App.createConfigured__();
  const file = app.vault.createSync__('Note.md', content);
  return app.metadataCache.getFileCache(file)?.headings;
}
