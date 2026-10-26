import type {
  CachedMetadata,
  Pos,
  TFile
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  findMentionRanges,
  getMentionNames
} from './unlinked-mention-ranges.ts';

describe('findMentionRanges', () => {
  it('should list the matches name by name, then by position', () => {
    expect(findMentionRanges({ cache: null, content: 'Bar Foo Bar Foo', names: ['Foo', 'Bar'] })).toEqual([[4, 7], [12, 15], [0, 3], [8, 11]]);
  });

  it('should drop a match inside a link or an embed, and keep one only partly inside', () => {
    const content = 'Foo [[Foo]] ![[Foo]] [[Foo Bar|x]] Foo';
    const cache = castTo<CachedMetadata>({
      embeds: [{ position: position(12, 20) }],
      links: [{ position: position(4, 11) }, { position: position(21, 34) }, { position: position(36, 38) }]
    });

    expect(findMentionRanges({ cache, content, names: ['Foo'] })).toEqual([[0, 3], [35, 38]]);
  });

  it('should drop a match inside the frontmatter, and keep one inside code', () => {
    const content = '---\na: Foo\n---\n`Foo`';
    const cache = castTo<CachedMetadata>({ frontmatterPosition: position(0, 14) });

    expect(findMentionRanges({ cache, content, names: ['Foo'] })).toEqual([[16, 19]]);
  });

  it('should skip an empty name, which would match everywhere without advancing', () => {
    expect(findMentionRanges({ cache: castTo<CachedMetadata>({}), content: 'Foo', names: ['', 'Foo'] })).toEqual([[0, 3]]);
  });
});

describe('getMentionNames', () => {
  it('should list the basename, then the trimmed non-empty aliases', () => {
    const file = castTo<TFile>({ basename: 'Alpha' });
    const cache = castTo<CachedMetadata>({ frontmatter: { Aliases: [' First ', '', 1, 'Second'] } });

    expect(getMentionNames(file, cache)).toEqual(['Alpha', 'First', 'Second']);
  });

  it('should list the basename alone without metadata or aliases', () => {
    const file = castTo<TFile>({ basename: 'Alpha' });

    expect(getMentionNames(file, null)).toEqual(['Alpha']);
    expect(getMentionNames(file, castTo<CachedMetadata>({ frontmatter: { aliases: 'One' } }))).toEqual(['Alpha', 'One']);
  });
});

function position(start: number, end: number): Pos {
  return castTo<Pos>({ end: { offset: end }, start: { offset: start } });
}
