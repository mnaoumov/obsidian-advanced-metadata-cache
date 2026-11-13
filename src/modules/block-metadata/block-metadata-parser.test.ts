import type {
  CachedMetadata,
  SectionCache
} from 'obsidian';

import {
  describe,
  expect,
  it
} from 'vitest';

import {
  findBlockMetadata,
  hasCodeSection,
  NOT_A_MAPPING_ERROR
} from './block-metadata-parser.ts';

describe('findBlockMetadata', () => {
  it('should describe the heading right above a fence', () => {
    const text = '# Tasks\n```advanced-metadata-cache\nstatus: done\ntags: [a, b]\n```\nBody';
    const result = findBlockMetadata({
      cache: {
        headings: [{ heading: 'Tasks', level: 1, position: pos(0, 0, 0, 7) }],
        sections: [section('heading', 0, 0), section('code', 1, 4), section('paragraph', 5, 5)]
      },
      text
    });

    expect(result).toEqual([
      {
        error: null,
        position: pos(1, 0, 4, 0),
        properties: { status: 'done', tags: ['a', 'b'] },
        target: { blockId: null, heading: 'Tasks', level: 1, position: pos(0, 0, 0, 0), type: 'heading' }
      }
    ]);
  });

  it('should describe a paragraph, with its block id, and give two consecutive fences the same target', () => {
    const text = 'Para ^abc\n```advanced-metadata-cache\na: 1\n```\n```advanced-metadata-cache\nb: 2\n```';
    const paragraph = { ...section('paragraph', 0, 0), id: 'abc' };
    const result = findBlockMetadata({ cache: { sections: [paragraph, section('code', 1, 3), section('code', 4, 6)] }, text });

    expect(result.map((blockMetadata) => blockMetadata.properties)).toEqual([{ a: 1 }, { b: 2 }]);
    expect(result.map((blockMetadata) => blockMetadata.target)).toEqual([
      { blockId: 'abc', heading: null, level: null, position: pos(0, 0, 0, 0), type: 'paragraph' },
      { blockId: 'abc', heading: null, level: null, position: pos(0, 0, 0, 0), type: 'paragraph' }
    ]);
  });

  it('should give a fence with only the frontmatter, or nothing, before it no target', () => {
    const text = '---\na: 1\n---\n```advanced-metadata-cache\nb: 2\n```';
    expect(findBlockMetadata({ cache: { sections: [section('yaml', 0, 2), section('code', 3, 5)] }, text })[0]?.target).toBeNull();

    const bare = '```advanced-metadata-cache\nb: 2\n```';
    expect(findBlockMetadata({ cache: { sections: [section('code', 0, 2)] }, text: bare })[0]?.target).toBeNull();
  });

  it('should take a heading section without a heading entry as a heading of unknown text', () => {
    const text = '# A\n```advanced-metadata-cache\n```';
    const [blockMetadata] = findBlockMetadata({ cache: { sections: [section('heading', 0, 0), section('code', 1, 2)] }, text });

    expect(blockMetadata?.target).toEqual({ blockId: null, heading: null, level: null, position: pos(0, 0, 0, 0), type: 'heading' });
    expect(blockMetadata?.properties).toEqual({});
  });

  it('should strip the fence indentation, and read an unclosed fence to the end of its section', () => {
    const text = 'Para\n  ```advanced-metadata-cache\n  a: 1\n  b: x';
    const [blockMetadata] = findBlockMetadata({ cache: { sections: [section('paragraph', 0, 0), section('code', 1, 3)] }, text });

    expect(blockMetadata?.properties).toEqual({ a: 1, b: 'x' });
  });

  it('should list a fence whose YAML fails or is not a mapping, with the reason', () => {
    const text = 'P\n```advanced-metadata-cache\na: [\n```\n```advanced-metadata-cache\n- a\n```\n```advanced-metadata-cache\nplain\n```';
    const result = findBlockMetadata({ cache: { sections: [section('paragraph', 0, 0), section('code', 1, 3), section('code', 4, 6), section('code', 7, 9)] }, text });

    expect(result[0]?.properties).toBeNull();
    expect(result[0]?.error).toEqual(expect.any(String));
    expect(result[1]).toMatchObject({ error: NOT_A_MAPPING_ERROR, properties: null });
    expect(result[2]).toMatchObject({ error: NOT_A_MAPPING_ERROR, properties: null });
  });

  it('should give a date as its string', () => {
    const text = 'P\n```advanced-metadata-cache\ndue: 2026-11-13\n```';
    const [blockMetadata] = findBlockMetadata({ cache: { sections: [section('paragraph', 0, 0), section('code', 1, 3)] }, text });

    expect(typeof blockMetadata?.properties?.['due']).toBe('string');
  });

  it('should ignore other languages, indented code, and a note with no code section', () => {
    const text = 'P\n```yaml\na: 1\n```\n\n    indented';
    expect(findBlockMetadata({ cache: { sections: [section('paragraph', 0, 0), section('code', 1, 3), section('code', 5, 5)] }, text })).toEqual([]);
    expect(findBlockMetadata({ cache: { sections: [section('paragraph', 0, 0)] }, text: 'P' })).toEqual([]);
    expect(findBlockMetadata({ cache: {}, text: '' })).toEqual([]);
  });
});

describe('hasCodeSection', () => {
  it('should say whether the cache lists a code section', () => {
    expect(hasCodeSection({ sections: [section('code', 0, 1)] })).toBe(true);
    expect(hasCodeSection({ sections: [section('paragraph', 0, 0)] })).toBe(false);
    expect(hasCodeSection({} satisfies CachedMetadata)).toBe(false);
  });
});

function pos(startLine: number, startCol: number, endLine: number, endCol: number): SectionCache['position'] {
  // Offsets are not read by the parser; the test gives each location its line as the offset.
  return {
    end: { col: endCol, line: endLine, offset: endLine },
    start: { col: startCol, line: startLine, offset: startLine }
  };
}

function section(type: string, startLine: number, endLine: number): SectionCache {
  return { position: pos(startLine, 0, endLine, 0), type };
}
