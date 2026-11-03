import {
  describe,
  expect,
  it
} from 'vitest';

import { findExternalLinks } from './external-links.ts';
import {
  parsePersistedExternalLinks,
  stringifyPersistedExternalLinks
} from './persisted-external-links.ts';

describe('external-link checkpoints', () => {
  const link = findExternalLinks('---\nsource: https://www.alpha.com/path#section\n---')[0];

  it('should discard non-finite file stats rather than trusting a corrupt checkpoint', () => {
    expect(parsePersistedExternalLinks('{"version":1,"notes":{"Alpha.md":{"mtime":1e400,"size":0,"record":[]}}}').size).toBe(0);
  });

  it('should preserve positions, written URLs, frontmatter, empty notes and special paths', () => {
    const notes = new Map([
      ['__proto__', { mtime: 1, record: findExternalLinks('https://alpha.com'), size: 17 }],
      ['Bravo.md', { mtime: 2, record: [], size: 0 }],
      ['Charlie.md', { mtime: 3, record: findExternalLinks('---\nsource: https://www.alpha.com/path#section\n---'), size: 50 }]
    ]);
    expect(parsePersistedExternalLinks(stringifyPersistedExternalLinks(notes))).toEqual(notes);
  });

  it.each([null, '{', 'null', '[]', '{}', '{"version":2,"notes":{}}', '{"version":1,"notes":null}', '{"version":1,"notes":[]}'])('should rebuild an incompatible document %s', (json) => {
    expect(parsePersistedExternalLinks(json).size).toBe(0);
  });

  it.each([
    null,
    [],
    {},
    { mtime: -1, record: [], size: 1 },
    { mtime: 1, record: [], size: -1 },
    { mtime: 1, record: null, size: 1 },
    { mtime: 1, record: [null], size: 1 },
    ...['host', 'url', 'normalizedUrl', 'isInFrontmatter', 'position'].map((key) => ({ mtime: 1, record: [{ ...link, [key]: null }], size: 1 })),
    ...['start', 'end'].map((key) => ({ mtime: 1, record: [{ ...link, position: { ...link?.position, [key]: null } }], size: 1 })),
    ...['line', 'col', 'offset'].flatMap((key) => [-1, 0.5, null, '1'].map((value) => ({ mtime: 1, record: [{ ...link, position: { ...link?.position, start: { ...link?.position.start, [key]: value } } }], size: 1 }))),
    { mtime: 1, record: [{ ...link, position: { end: { col: 1, line: 0, offset: 1 }, start: { col: 2, line: 0, offset: 2 } } }], size: 1 }
  ])('should discard malformed records while keeping valid notes: %j', (entry) => {
    const json = JSON.stringify({ notes: { 'Alpha.md': { mtime: 1, record: [], size: 0 }, 'Bravo.md': entry }, version: 1 });
    expect([...parsePersistedExternalLinks(json).keys()]).toEqual(['Alpha.md']);
  });
});
