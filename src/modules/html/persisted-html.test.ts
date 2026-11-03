import {
  describe,
  expect,
  it
} from 'vitest';

import { findHtmlRanges } from './html-ranges.ts';
import {
  parsePersistedHtmlRanges,
  stringifyPersistedHtmlRanges
} from './persisted-html.ts';

describe('HTML checkpoints', () => {
  it('round trips empty and nonempty projections with observed stats', () => {
    const content = '<span>';
    const sections = [{ id: undefined, position: { end: { col: 6, line: 0, offset: 6 }, start: { col: 0, line: 0, offset: 0 } }, type: 'html' }];
    const notes = new Map([
      ['Alpha.md', { mtime: 1, record: findHtmlRanges({ content, sections }), size: 6 }],
      ['Bravo.md', { mtime: 2, record: [], size: 0 }]
    ]);
    expect(parsePersistedHtmlRanges(stringifyPersistedHtmlRanges(notes))).toEqual(notes);
  });

  it.each([null, '', '{', 'null', '[]', '{"version":2,"notes":{}}', '{"version":1,"notes":[]}'])('rejects incompatible documents: %s', (json) => {
    expect(parsePersistedHtmlRanges(json).size).toBe(0);
  });

  it('drops malformed entries so their notes are read again', () => {
    const valid = { mtime: 1, record: findHtmlRanges({ content: '<br>' }), size: 4 };
    const range = valid.record[0];
    const malformed = [null, { ...valid, mtime: -1 }, { ...valid, size: '4' }, { ...valid, record: {} }, { ...valid, record: [null] }, { ...valid, record: [{ ...range, html: '' }] }, { ...valid, record: [{ ...range, namespace: 'other' }] }, { ...valid, record: [{ ...range, kind: 'other' }] }, { ...valid, record: [{ ...range, tagName: 1 }] }, { ...valid, record: [{ ...range, isClosing: 1 }] }, { ...valid, record: [{ ...range, position: { end: {}, start: { col: 0.5, line: -1, offset: 0 } } }] }];
    const notes = { ...Object.fromEntries(malformed.map((value, index) => [String(index), value])), 'Alpha.md': valid };
    expect(parsePersistedHtmlRanges(JSON.stringify({ notes, version: 1 }))).toEqual(new Map([['Alpha.md', valid]]));
  });
});
