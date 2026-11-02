/* eslint-disable unicorn/prefer-https -- An http URL is part of what is under test: http and https must count as one. */

import dedent from 'dedent';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  findExternalLinks,
  getEditDistance,
  normalizeHost,
  parseExternalUrl
} from './external-links.ts';

describe('parseExternalUrl', () => {
  it('should count http and https as one, and drop www, the user info, the fragment and a trailing slash', () => {
    expect(parseExternalUrl('http://user:pass@WWW.Example.com/Path/?q=1#top')).toEqual({ host: 'example.com', normalizedUrl: 'example.com/Path?q=1' });
    expect(parseExternalUrl('https://example.com/')).toEqual({ host: 'example.com', normalizedUrl: 'example.com' });
  });

  it('should keep a port that is not the scheme\'s default, and drop a trailing dot of the host', () => {
    expect(parseExternalUrl('https://example.com:8080/a')).toEqual({ host: 'example.com', normalizedUrl: 'example.com:8080/a' });
    expect(parseExternalUrl('https://example.com:443/a')).toEqual({ host: 'example.com', normalizedUrl: 'example.com/a' });
    expect(parseExternalUrl('https://example.com./a')).toEqual({ host: 'example.com', normalizedUrl: 'example.com/a' });
  });

  it('should read a URL without a scheme as https, and keep www. when it is the whole host', () => {
    expect(parseExternalUrl('github.com/mnaoumov')).toEqual({ host: 'github.com', normalizedUrl: 'github.com/mnaoumov' });
    expect(parseExternalUrl('https://www./a')?.host).toBe('www');
  });

  it('should refuse what is no http(s) URL with a host', () => {
    expect(parseExternalUrl('mailto:a@b.c')).toBeNull();
    expect(parseExternalUrl('https://')).toBeNull();
    expect(parseExternalUrl('https://.')).toBeNull();
    expect(parseExternalUrl('')).toBeNull();
  });
});

describe('normalizeHost', () => {
  it('should bring a host as asked to the indexed form', () => {
    expect(normalizeHost(' https://WWW.GitHub.com:8080/x ')).toBe('github.com');
    expect(normalizeHost('github.com')).toBe('github.com');
    expect(normalizeHost('')).toBeNull();
  });
});

describe('getEditDistance', () => {
  it('should count insertions, deletions, substitutions and swaps of neighbors as one edit each', () => {
    expect(getEditDistance('github.com', 'github.com', 2)).toBe(0);
    expect(getEditDistance('githb.com', 'github.com', 2)).toBe(1);
    expect(getEditDistance('gitlab.com', 'github.com', 2)).toBe(2);
    expect(getEditDistance('gihtub.com', 'github.com', 2)).toBe(1);
    expect(getEditDistance('', 'ab', 2)).toBe(2);
  });

  it('should cap the distance at one past the maximum', () => {
    expect(getEditDistance('a.com', 'abcdef.com', 2)).toBe(3);
    expect(getEditDistance('abcd.com', 'wxyz.com', 2)).toBe(3);
  });
});

describe('findExternalLinks', () => {
  it('should find bare URLs, markdown links and angle-bracket links, with positions', () => {
    const content = 'Bare https://a.com/x.\n[text](https://b.com/y) and <http://c.com>';
    const links = findExternalLinks(content);

    expect(links.map((link) => link.url)).toEqual(['https://a.com/x', 'https://b.com/y', 'http://c.com']);
    expect(links[1]?.position).toEqual({ end: { col: 22, line: 1, offset: 44 }, start: { col: 7, line: 1, offset: 29 } });
    expect(links.every((link) => !link.isInFrontmatter)).toBe(true);
  });

  it('should keep balanced parentheses and drop unbalanced ones and trailing punctuation', () => {
    const links = findExternalLinks('See (https://en.wikipedia.org/wiki/Foo_(bar)), and **https://a.com/!**');

    expect(links.map((link) => link.url)).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)', 'https://a.com/']);
  });

  it('should flag the links written in the frontmatter', () => {
    const links = findExternalLinks('---\nsource: "https://a.com"\n---\nhttps://b.com');

    expect(links.map((link) => [link.host, link.isInFrontmatter])).toEqual([['a.com', true], ['b.com', false]]);
  });

  it('should read CRLF frontmatter, and an unclosed block as no frontmatter', () => {
    expect(findExternalLinks('---\r\nsource: https://a.com\r\n---\r\n')[0]?.isInFrontmatter).toBe(true);
    expect(findExternalLinks('---\nsource: https://a.com\n')[0]?.isInFrontmatter).toBe(false);
    expect(findExternalLinks('---\nsource: https://a.com\n---')[0]?.isInFrontmatter).toBe(true);
  });

  it('should skip fenced code blocks, closed or not, and inline code spans', () => {
    const content = dedent`
      Before \`https://inline.com\` https://kept.com
      \`\`\`js
      https://fenced.com
      \`\`\`\`
      \`\`
      ~~~
      still fenced https://fenced.com
      ~~~
      After \`\`a \` https://double.com\`\` https://after.com
      \`\`\`
      https://unclosed.com
    `;

    expect(findExternalLinks(content).map((link) => link.host)).toEqual(['kept.com', 'after.com']);
  });

  it('should skip a scheme glued to a word, and a URL with no host', () => {
    expect(findExternalLinks('xhttps://a.com https:// https://) https://b.com')).toHaveLength(1);
  });
});

/* eslint-enable unicorn/prefer-https -- End of the http fixtures. */
