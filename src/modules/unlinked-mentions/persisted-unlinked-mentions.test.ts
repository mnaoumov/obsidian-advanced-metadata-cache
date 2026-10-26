import {
  describe,
  expect,
  it
} from 'vitest';

import {
  parsePersistedUnlinkedMentions,
  stringifyPersistedUnlinkedMentions
} from './persisted-unlinked-mentions.ts';

describe('persisted unlinked mentions', () => {
  it('should write every key once and read the same index back', () => {
    const json = stringifyPersistedUnlinkedMentions({
      cleanKeys: ['ALPHA', 'BETA'],
      notes: new Map([
        ['One.md', { mentionKeys: ['BETA', 'ALPHA'], mtime: 1, size: 2 }],
        ['Two.md', { mentionKeys: ['GAMMA'], mtime: 3, size: 4 }]
      ])
    });

    expect(JSON.parse(json)).toEqual({
      cleanKeys: [0, 1],
      keys: ['ALPHA', 'BETA', 'GAMMA'],
      notes: { 'One.md': { keys: [1, 0], mtime: 1, size: 2 }, 'Two.md': { keys: [2], mtime: 3, size: 4 } },
      version: 1
    });
    expect(parsePersistedUnlinkedMentions(json)).toEqual({
      cleanKeys: ['ALPHA', 'BETA'],
      notes: new Map([
        ['One.md', { mentionKeys: ['BETA', 'ALPHA'], mtime: 1, size: 2 }],
        ['Two.md', { mentionKeys: ['GAMMA'], mtime: 3, size: 4 }]
      ])
    });
  });

  it('should refuse a file that is not JSON, another version or malformed at the top', () => {
    expect(parsePersistedUnlinkedMentions('{')).toBeNull();
    expect(parsePersistedUnlinkedMentions('null')).toBeNull();
    expect(parsePersistedUnlinkedMentions(JSON.stringify({ cleanKeys: [], keys: [], notes: {}, version: 2 }))).toBeNull();
    expect(parsePersistedUnlinkedMentions(JSON.stringify({ cleanKeys: [], keys: [1], notes: {}, version: 1 }))).toBeNull();
    expect(parsePersistedUnlinkedMentions(JSON.stringify({ cleanKeys: {}, keys: [], notes: {}, version: 1 }))).toBeNull();
    expect(parsePersistedUnlinkedMentions(JSON.stringify({ cleanKeys: [0], keys: [], notes: {}, version: 1 }))).toBeNull();
    expect(parsePersistedUnlinkedMentions(JSON.stringify({ cleanKeys: ['A'], keys: ['A'], notes: {}, version: 1 }))).toBeNull();
    expect(parsePersistedUnlinkedMentions(JSON.stringify({ cleanKeys: [], keys: [], notes: null, version: 1 }))).toBeNull();
  });

  it('should drop a malformed note entry, so its note is read again', () => {
    const json = JSON.stringify({
      cleanKeys: [],
      keys: ['A'],
      notes: {
        'Bad index.md': { keys: [5], mtime: 1, size: 1 },
        'Good.md': { keys: [0], mtime: 1, size: 1 },
        'No keys.md': { mtime: 1, size: 1 },
        'No mtime.md': { keys: [], size: 1 },
        'No size.md': { keys: [], mtime: 1 },
        'Null.md': null
      },
      version: 1
    });

    expect([...parsePersistedUnlinkedMentions(json)?.notes.keys() ?? []]).toEqual(['Good.md']);
  });
});
