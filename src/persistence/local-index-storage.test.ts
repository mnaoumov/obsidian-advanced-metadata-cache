import type { LocalDataStore } from '@mnaoumov/obsidian-lib/data-stores/local-data-store';

import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { LocalIndexStorage } from './local-index-storage.ts';

describe('LocalIndexStorage', () => {
  it('should tolerate an empty checkpoint with no clean-key list and unrelated undefined records', async () => {
    const local = strictProxy<LocalDataStore>({ entries: () => Promise.resolve([['version', 1], ['unrelated', undefined]]) });
    const storage = new LocalIndexStorage({ kind: 'mentions', local });
    expect(JSON.parse(await storage.read() ?? 'null')).toEqual({ cleanKeys: [], keys: [], notes: {}, version: 1 });
  });
  it('should commit only changed records and remove deleted records', async () => {
    const records = new Map<string>();
    const commit = vi.fn<LocalDataStore['commit']>(({ entries, removedKeys }) => {
      for (const key of removedKeys ?? []) {
        records.delete(key);
      }
      for (const [key, value] of entries) {
        records.set(key, value);
      }
      return noopAsync();
    });
    const local = strictProxy<LocalDataStore>({ commit, entries: () => Promise.resolve([...records]) });
    const storage = new LocalIndexStorage({ kind: 'properties', local });
    await storage.write(JSON.stringify({ properties: { due: { 'A.md': ['2026'], 'B.md': ['2027'] } }, version: 1 }));
    commit.mockClear();
    await storage.write(JSON.stringify({ properties: { due: { 'A.md': ['2028'] } }, version: 1 }));
    expect(commit.mock.calls[0]?.[0].entries).toHaveLength(1);
    expect(commit.mock.calls[0]?.[0].removedKeys).toHaveLength(1);
    expect(JSON.parse(await storage.read() ?? 'null')).toEqual({ properties: { due: { 'A.md': ['2028'] } }, version: 1 });
  });

  it('should keep unlinked keys independent of the interchange dictionary ordering', async () => {
    const records = new Map<string>();
    const commit = vi.fn<LocalDataStore['commit']>(({ entries, removedKeys }) => {
      for (const key of removedKeys ?? []) {
        records.delete(key);
      }
      for (const [key, value] of entries) {
        records.set(key, value);
      }
      return noopAsync();
    });
    const storage = new LocalIndexStorage({ kind: 'mentions', local: strictProxy<LocalDataStore>({ commit, entries: () => Promise.resolve([...records]) }) });
    await storage.write(JSON.stringify({ cleanKeys: [0], keys: ['alpha'], notes: { 'A.md': { keys: [0], mtime: 1, size: 2 } }, version: 1 }));
    commit.mockClear();
    await storage.write(JSON.stringify({ cleanKeys: [1], keys: ['beta', 'alpha'], notes: { 'A.md': { keys: [1], mtime: 1, size: 2 } }, version: 1 }));
    expect(commit.mock.calls[0]?.[0].entries).toHaveLength(0);
    expect(JSON.parse(await storage.read() ?? 'null')).toMatchObject({ keys: ['alpha'] });
  });

  it('should preserve special property names and retry a failed transaction without advancing the checkpoint', async () => {
    const records = new Map<string>();
    const commit = vi.fn<LocalDataStore['commit']>(({ entries, removedKeys }) => {
      for (const key of removedKeys ?? []) {
        records.delete(key);
      }
      for (const [key, value] of entries) {
        records.set(key, value);
      }
      return noopAsync();
    });
    const local = strictProxy<LocalDataStore>({ commit, entries: () => Promise.resolve([...records]) });
    const storage = new LocalIndexStorage({ kind: 'properties', local });
    expect(await storage.read()).toBeNull();
    const properties = Object.fromEntries([['__proto__', { 'A.md': ['value'] }], ['empty', {}]]);
    const json = JSON.stringify({ properties, version: 1 });
    commit.mockRejectedValueOnce(new Error('quota'));
    await expect(storage.write(json)).rejects.toThrow('quota');
    await storage.write(json);
    expect(JSON.parse(await storage.read() ?? 'null')).toEqual({ properties, version: 1 });
    expect(commit.mock.calls[1]?.[0].entries).toHaveLength(4);
    await expect(storage.write(JSON.stringify({ properties: {}, version: 2 }))).rejects.toThrow('Invalid property values');
    const mentions = new LocalIndexStorage({ kind: 'mentions', local });
    await expect(mentions.write('{')).rejects.toThrow('Invalid unlinked mentions');
  });
});
