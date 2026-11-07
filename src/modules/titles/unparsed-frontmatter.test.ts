import type { CachedMetadata } from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  getFrontmatterParseError,
  getUnparsedFrontmatterPosition
} from './unparsed-frontmatter.ts';

function makePosition(text: string, end: string): CachedMetadata['frontmatterPosition'] & object {
  const endOffset = text.indexOf(end) + end.length;
  return {
    end: { col: 0, line: 0, offset: endOffset },
    start: { col: 0, line: 0, offset: 0 }
  };
}

describe('getUnparsedFrontmatterPosition', () => {
  const position = makePosition('---\na: 1\n---', '\n---');

  it('should return the yaml section\'s position when there is no frontmatter', () => {
    expect(getUnparsedFrontmatterPosition(castTo<CachedMetadata>({ sections: [{ position, type: 'yaml' }] }))).toBe(position);
  });

  it('should return null when the frontmatter parsed', () => {
    expect(getUnparsedFrontmatterPosition(castTo<CachedMetadata>({
      frontmatter: { a: 1 },
      sections: [{ position, type: 'yaml' }]
    }))).toBeNull();
  });

  it('should return null when the note has no frontmatter block, or no cache', () => {
    expect(getUnparsedFrontmatterPosition(castTo<CachedMetadata>({ sections: [{ position, type: 'paragraph' }] }))).toBeNull();
    expect(getUnparsedFrontmatterPosition(castTo<CachedMetadata>({}))).toBeNull();
    expect(getUnparsedFrontmatterPosition(null)).toBeNull();
  });
});

describe('getFrontmatterParseError', () => {
  it('should report a key written twice', () => {
    const text = '---\ntitle: A\nmtime: 1\nmtime: 2\n---\n# A\n';
    expect(getFrontmatterParseError(text, makePosition(text, 'mtime: 2\n---'))).toEqual(expect.any(String));
  });

  it('should report a block with CRLF line endings', () => {
    const text = '---\r\ntitle: A\r\ntitle: B\r\n---\r\nBody';
    expect(getFrontmatterParseError(text, makePosition(text, 'title: B\r\n---'))).toEqual(expect.any(String));
  });

  it('should not report a block that parses', () => {
    for (const yaml of ['', ' '.repeat(3), 'just a scalar', '- a\n- b', 'title: A']) {
      const text = `---\n${yaml}\n---\nBody`;
      expect(getFrontmatterParseError(text, makePosition(text, `${yaml}\n---`))).toBeNull();
    }
  });

  it('should report a block whose position stops before a closing delimiter', () => {
    const text = '---\ntitle: A\ntitle: B\n';
    expect(getFrontmatterParseError(text, makePosition(text, 'title: B'))).toEqual(expect.any(String));
  });

  it('should not report a block that is only its two delimiters', () => {
    const text = '---\n---\nBody';
    expect(getFrontmatterParseError(text, makePosition(text, '\n---'))).toBeNull();
  });

  it('should not report text that does not open with a delimiter', () => {
    const text = 'title: A\ntitle: B\n---';
    expect(getFrontmatterParseError(text, makePosition(text, '---'))).toBeNull();
  });
});
