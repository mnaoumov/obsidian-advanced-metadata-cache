import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  getProposedTitlePropertyNames,
  mergeTitlePropertyNames,
  parseTitlePropertyNames
} from './settings-migration.ts';

describe('getProposedTitlePropertyNames', () => {
  it('should read the proposed names, trimmed and without blanks', () => {
    expect(getProposedTitlePropertyNames({ titlePropertyNames: [' subtitle ', '', '  '] })).toEqual(['subtitle']);
  });

  it('should read an absent list as nothing proposed', () => {
    expect(getProposedTitlePropertyNames({})).toEqual([]);
  });

  it('should refuse a value that is not a list of strings', () => {
    expect(() => getProposedTitlePropertyNames(castTo<never>({ titlePropertyNames: ['a', 1] }))).toThrow(TypeError);
    expect(() => getProposedTitlePropertyNames(castTo<never>({ titlePropertyNames: 'subtitle' }))).toThrow(TypeError);
  });
});

describe('mergeTitlePropertyNames', () => {
  it('should append the proposed names after the current ones', () => {
    expect(mergeTitlePropertyNames({ currentTitlePropertyNames: ['title'], proposedTitlePropertyNames: ['subtitle'] })).toEqual([
      'title',
      'subtitle'
    ]);
  });

  it('should drop a proposed name the list already carries in any casing, keeping the current spelling', () => {
    expect(mergeTitlePropertyNames({ currentTitlePropertyNames: ['Title'], proposedTitlePropertyNames: ['title', 'TITLE'] })).toEqual(['Title']);
  });

  it('should tidy the current list as it merges', () => {
    expect(mergeTitlePropertyNames({ currentTitlePropertyNames: [' title', '', 'title '], proposedTitlePropertyNames: [] })).toEqual(['title']);
  });
});

describe('parseTitlePropertyNames', () => {
  it('should trim every entry and drop the blank ones', () => {
    expect(parseTitlePropertyNames(['  a ', '', ' ', 'b'])).toEqual(['a', 'b']);
  });
});
