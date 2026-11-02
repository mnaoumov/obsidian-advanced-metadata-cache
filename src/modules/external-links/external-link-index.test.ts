/* eslint-disable unicorn/prefer-https -- An http URL is part of what is under test: http and https must count as one. */

import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { ExternalLinkIndex } from './external-link-index.ts';
import { findExternalLinks } from './external-links.ts';

describe('ExternalLinkIndex', () => {
  let index: ExternalLinkIndex;

  beforeEach(() => {
    index = new ExternalLinkIndex();
    index.setPath('Alpha.md', findExternalLinks('https://github.com/a https://gist.github.com/x https://github.com/a'));
    index.setPath('Bravo.md', findExternalLinks('http://www.github.com/a/ https://githb.com'));
    index.setPath('Charlie.md', findExternalLinks('https://github.com/b'));
  });

  it('should answer which notes link to a URL, normalized', () => {
    expect(index.getPathsLinkingToUrl('https://github.com/a')).toEqual(['Alpha.md', 'Bravo.md']);
    expect(index.getPathsLinkingToUrl('github.com/b/')).toEqual(['Charlie.md']);
    expect(index.getPathsLinkingToUrl('https://nowhere.com')).toEqual([]);
    expect(index.getPathsLinkingToUrl('mailto:a@b.c')).toEqual([]);
  });

  it('should answer which notes link to a host, with or without its subdomains', () => {
    expect(index.getPathsLinkingToHost('GitHub.com')).toEqual(['Alpha.md', 'Bravo.md', 'Charlie.md']);
    expect(index.getPathsLinkingToHost('gist.github.com')).toEqual(['Alpha.md']);
    expect(index.getPathsLinkingToHost('hub.com', { shouldIncludeSubdomains: true })).toEqual([]);
    index.deletePath('Alpha.md');
    index.setPath('Delta.md', findExternalLinks('https://gist.github.com/y'));
    expect(index.getPathsLinkingToHost('github.com', { shouldIncludeSubdomains: true })).toEqual(['Bravo.md', 'Charlie.md', 'Delta.md']);
    expect(index.getPathsLinkingToHost('github.com')).toEqual(['Bravo.md', 'Charlie.md']);
    expect(index.getPathsLinkingToHost('')).toEqual([]);
  });

  it('should list the hosts and URLs, most linked-to first', () => {
    expect(index.getHosts()).toEqual([
      { host: 'github.com', noteCount: 3 },
      { host: 'gist.github.com', noteCount: 1 },
      { host: 'githb.com', noteCount: 1 }
    ]);
    expect(index.getUrls('github.com')).toEqual([
      { host: 'github.com', normalizedUrl: 'github.com/a', noteCount: 2, url: 'http://www.github.com/a/' },
      { host: 'github.com', normalizedUrl: 'github.com/b', noteCount: 1, url: 'https://github.com/b' }
    ]);
    expect(index.getUrls().map((usage) => usage.normalizedUrl)).toEqual(['github.com/a', 'gist.github.com/x', 'githb.com', 'github.com/b']);
    expect(index.getUrls('')).toEqual([]);
  });

  it('should pick the written form most notes use for a URL', () => {
    index.setPath('Delta.md', findExternalLinks('https://github.com/a'));

    expect(index.getUrls('github.com')[0]?.url).toBe('https://github.com/a');
  });

  it('should find the hosts a few edits away, nearest and most used first', () => {
    index.setPath('Delta.md', findExternalLinks('https://gitlab.com https://gitub.com'));

    expect(index.getSimilarHosts('githb.com')).toEqual([
      { distance: 1, host: 'github.com', noteCount: 3 },
      { distance: 1, host: 'gitub.com', noteCount: 1 },
      { distance: 2, host: 'gitlab.com', noteCount: 1 }
    ]);
    expect(index.getSimilarHosts('githb.com', 1).map((similarHost) => similarHost.host)).toEqual(['github.com', 'gitub.com']);
    expect(index.getSimilarHosts('')).toEqual([]);
  });

  it('should list one note\'s links, and replace them wholesale', () => {
    expect(index.getLinks('Bravo.md').map((link) => link.normalizedUrl)).toEqual(['github.com/a', 'githb.com']);
    expect(index.getLinks('Nowhere.md')).toEqual([]);

    index.setPath('Alpha.md', findExternalLinks('https://example.com'));

    expect(index.getPathsLinkingToUrl('github.com/a')).toEqual(['Bravo.md']);
    expect(index.getPathsLinkingToHost('gist.github.com')).toEqual([]);
  });

  it('should keep a note linking to a URL in two written forms until both are gone', () => {
    index.setPath('Delta.md', findExternalLinks('https://example.com/a https://example.com/a/'));
    expect(index.getUrls('example.com')).toEqual([{ host: 'example.com', normalizedUrl: 'example.com/a', noteCount: 1, url: 'https://example.com/a' }]);

    index.deletePath('Delta.md');
    expect(index.getUrls('example.com')).toEqual([]);
  });

  it('should sort the paths in code-unit order whatever order they were indexed in', () => {
    index.setPath('Zulu.md', findExternalLinks('https://example.com'));
    index.setPath('Echo.md', findExternalLinks('https://example.com'));
    index.setPath('Mike.md', findExternalLinks('https://example.com'));

    expect(index.getPathsLinkingToHost('example.com')).toEqual(['Echo.md', 'Mike.md', 'Zulu.md']);
  });

  it('should forget everything on clear', () => {
    index.clear();

    expect(index.getHosts()).toEqual([]);
    expect(index.getUrls()).toEqual([]);
    expect(index.getLinks('Alpha.md')).toEqual([]);
  });
});

/* eslint-enable unicorn/prefer-https -- End of the http fixtures. */
