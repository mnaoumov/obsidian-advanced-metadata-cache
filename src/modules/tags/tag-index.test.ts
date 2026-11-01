import type { CachedMetadata } from 'obsidian';

import {
  describe,
  expect,
  it
} from 'vitest';

import {
  normalizeTag,
  readTags,
  TagIndex
} from './tag-index.ts';

describe('normalizeTag', () => {
  it('should drop one leading # and fold the case', () => {
    expect(normalizeTag('#Project/Alpha')).toBe('project/alpha');
    expect(normalizeTag('project')).toBe('project');
    expect(normalizeTag('#')).toBe('');
  });
});

describe('readTags', () => {
  it('should keep body and frontmatter tags apart, normalized and each once', () => {
    const cache: CachedMetadata = {
      frontmatter: { tags: ['Project', '#area/home', 'two words'] },
      tags: [
        { position: { end: { col: 8, line: 3, offset: 30 }, start: { col: 0, line: 3, offset: 22 } }, tag: '#Project' },
        { position: { end: { col: 8, line: 4, offset: 39 }, start: { col: 0, line: 4, offset: 31 } }, tag: '#project' },
        { position: { end: { col: 1, line: 5, offset: 41 }, start: { col: 0, line: 5, offset: 40 } }, tag: '#' }
      ]
    };

    const contribution = readTags(cache);

    expect([...contribution.bodyTags]).toEqual(['project']);
    expect([...contribution.frontmatterTags]).toEqual(['project', 'area/home']);
  });

  it('should read a note with neither as carrying nothing', () => {
    const contribution = readTags({});

    expect(contribution.bodyTags.size).toBe(0);
    expect(contribution.frontmatterTags.size).toBe(0);
  });
});

describe('TagIndex', () => {
  function createIndex(): TagIndex {
    const index = new TagIndex();
    index.setPath('Body.md', { bodyTags: new Set(['project/alpha']), frontmatterTags: new Set() });
    index.setPath('Both.md', { bodyTags: new Set(['project']), frontmatterTags: new Set(['project']) });
    index.setPath('Front.md', { bodyTags: new Set(), frontmatterTags: new Set(['project', 'projects']) });
    return index;
  }

  it('should answer a tag in any casing, with or without #, nested tags included, in code-unit order', () => {
    const index = createIndex();

    expect(index.getPathsWithTag('#PROJECT')).toEqual(['Body.md', 'Both.md', 'Front.md']);
    expect(index.getPathsWithTag('project/alpha')).toEqual(['Body.md']);
  });

  it('should not read a tag that merely starts with the asked one as nested under it', () => {
    expect(createIndex().getPathsWithTag('projects')).toEqual(['Front.md']);
  });

  it('should leave nested tags out when asked for the exact tag', () => {
    expect(createIndex().getPathsWithTag('project', { shouldIncludeNestedTags: false })).toEqual(['Both.md', 'Front.md']);
  });

  it('should answer one source when asked', () => {
    const index = createIndex();

    expect(index.getPathsWithTag('project', { source: 'body' })).toEqual(['Body.md', 'Both.md']);
    expect(index.getPathsWithTag('project', { shouldIncludeNestedTags: false, source: 'frontmatter' })).toEqual(['Both.md', 'Front.md']);
  });

  it('should answer nothing for an empty tag or one no note carries', () => {
    const index = createIndex();

    expect(index.getPathsWithTag('#')).toEqual([]);
    expect(index.getPathsWithTag('missing')).toEqual([]);
  });

  it('should replace a note\'s tags wholesale, and forget a note left with none', () => {
    const index = createIndex();

    index.setPath('Both.md', { bodyTags: new Set(['other']), frontmatterTags: new Set() });
    index.deletePath('Front.md');

    expect(index.getPathsWithTag('project')).toEqual(['Body.md']);
    expect(index.getPathsWithTag('other')).toEqual(['Both.md']);
    expect(index.getPaths('Front.md', false)).toEqual([]);
  });

  it('should list the notes at a path or under a folder', () => {
    const index = new TagIndex();
    index.setPath('Folder/A.md', { bodyTags: new Set(['a']), frontmatterTags: new Set() });
    index.setPath('Folder2/B.md', { bodyTags: new Set(['a']), frontmatterTags: new Set() });

    expect(index.getPaths('Folder', true)).toEqual(['Folder/A.md']);
    expect(index.getPaths('Folder/A.md', false)).toEqual(['Folder/A.md']);
  });

  it('should forget everything on clear', () => {
    const index = createIndex();

    index.clear();

    expect(index.getPathsWithTag('project')).toEqual([]);
    expect(index.getPaths('Body.md', false)).toEqual([]);
  });
});
