import type { SharedDataStore } from '@mnaoumov/obsidian-lib/data-stores/shared-data-store';

import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { HeadingObservation } from './shared-heading-storage.ts';

import {
  mergeHeadingObservations,
  SharedHeadingStorage
} from './shared-heading-storage.ts';

const HEADING = { bodyHash: 'body', created: 10, level: 1, line: 0, modified: 20, seen: null, subtreeHash: 'subtree', text: 'A' };
const NOTE = { headings: [HEADING], mtime: 1 };

describe('shared heading observations', () => {
  it('should ignore invalid shared records and keep valid history', async () => {
    const invalid: unknown[] = [null, false, {}, { path: 1 }, { path: 'A.md' }, { changedAt: 'now', path: 'A.md' }, { changedAt: Infinity, path: 'A.md' }, { changedAt: 1, path: 'A.md' }, { changedAt: 1, path: 'A.md', resetAt: 'then' }, { changedAt: 1, path: 'A.md', resetAt: Infinity }, { changedAt: 1, path: 'A.md', resetAt: 0 }, { changedAt: 1, note: false, path: 'A.md', resetAt: 0 }];
    const values = [...invalid, { changedAt: 1, note: NOTE, path: 'A.md', resetAt: 0 }, { changedAt: 2, note: null, path: 'Gone.md', resetAt: 2 }];
    const shared = strictProxy<SharedDataStore>({ entries: () => values.map((value, index) => [String(index), value]), synchronize: noopAsync });
    const storage = new SharedHeadingStorage({ device: 'one', shared });
    expect(JSON.parse(await storage.read())).toEqual({ notes: { 'A.md': NOTE }, version: 1 });
  });

  it('should converge equal-time snapshots independently of iteration order and distinguish unmatched headings', () => {
    const first: HeadingObservation = { changedAt: 0, note: NOTE, path: 'A.md', resetAt: 0 };
    const second = { ...first, note: { ...NOTE, headings: [{ ...HEADING, bodyHash: 'other', created: 5, line: 0, text: 'Unrelated' }] } };
    const third = { ...first, note: { ...NOTE, mtime: 2 } };
    const observations = [first, first, second, third];
    expect(mergeHeadingObservations(observations)).toEqual(mergeHeadingObservations([...observations].reverse()));
    expect(mergeHeadingObservations(observations)['A.md']?.mtime).toBe(2);
  });

  it('should reject invalid writes and retain explicit resets across a failed publication', async () => {
    const setMany = vi.fn<SharedDataStore['setMany']>().mockResolvedValue(undefined);
    const storage = new SharedHeadingStorage({ device: 'one', shared: strictProxy<SharedDataStore>({ entries: () => [], setMany, synchronize: noopAsync }) });
    storage.reset('Unseen.md');
    await expect(storage.write('{')).rejects.toThrow('Invalid heading history');
    await expect(storage.importLegacy('{')).rejects.toThrow('Invalid legacy heading');
    await storage.write(JSON.stringify({ notes: { 'A.md': NOTE }, version: 1 }));
    storage.reset('A.md');
    storage.forget('A.md');
    setMany.mockRejectedValueOnce(new Error('quota'));
    await expect(storage.write(JSON.stringify({ notes: { 'A.md': NOTE }, version: 1 }))).rejects.toThrow('quota');
    await storage.write(JSON.stringify({ notes: { 'A.md': NOTE }, version: 1 }));
    expect(setMany).toHaveBeenCalledTimes(3);
    expect(setMany.mock.calls[2]?.[0]).toHaveLength(1);
  });
});
