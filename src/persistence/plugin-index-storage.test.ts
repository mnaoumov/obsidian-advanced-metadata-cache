import type {
  App,
  DataAdapter,
  Vault
} from 'obsidian';

import { LocalDataStore } from '@mnaoumov/obsidian-lib/data-stores/local-data-store';
import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import { IDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { PluginIndexStorage } from './plugin-index-storage.ts';

const storages: PluginIndexStorage[] = [];

interface CreateStorageParams {
  readonly device: string;
  readonly files: Map<string, string>;
  readonly kind: 'headings' | 'mentions' | 'properties';
}

function createAdapter(files: Map<string, string>): DataAdapter {
  const directories = new Set<string>();
  return strictProxy<DataAdapter>({
    exists: (path) => Promise.resolve(files.has(path) || directories.has(path) || [...files.keys()].some((file) => file.startsWith(`${path}/`))),
    list: (path) => {
      const prefix = `${path}/`;
      return Promise.resolve({
        files: [...files.keys()].filter((file) => file.startsWith(prefix) && !file.slice(prefix.length).includes('/')),
        folders: [...new Set([...directories, ...[...files.keys()].filter((file) => file.startsWith(prefix) && file.slice(prefix.length).includes('/')).map((file) => prefix + (file.slice(prefix.length).split('/', 1)[0] ?? ''))])].filter((folder) => folder.startsWith(prefix) && !folder.slice(prefix.length).includes('/'))
      });
    },
    mkdir: (path) => {
      directories.add(path);
      return noopAsync();
    },
    read: (path) => {
      const value = files.get(path);
      return value === undefined ? Promise.reject(new Error(`Missing file: ${path}`)) : Promise.resolve(value);
    },
    remove: (path) => {
      files.delete(path);
      return noopAsync();
    },
    write: (path, value) => {
      files.set(path, value);
      return noopAsync();
    }
  });
}

function createStorage(params: CreateStorageParams): PluginIndexStorage {
  const app = strictProxy<App>({ appId: params.device, vault: strictProxy<Vault>({ adapter: createAdapter(params.files) }) });
  const storage = new PluginIndexStorage({ app, getLegacyPath: (): string => `${params.kind}.json`, kind: params.kind, pluginId: 'test' });
  storages.push(storage);
  return storage;
}

function headingDocument(created: number, modified: number, seen: null | number): string {
  return JSON.stringify({ notes: { 'A.md': { headings: [{ bodyHash: 'body', created, level: 1, line: 0, modified, seen, subtreeHash: 'subtree', text: 'A' }], mtime: 1 } }, version: 1 });
}

describe('PluginIndexStorage', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('navigator', { locks: { request: async <T>(_name: string, callback: () => Promise<T>): Promise<T> => await callback() } });
  });

  afterEach(async () => {
    for (const storage of storages.splice(0)) {
      await storage.close();
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('should migrate local records, remove the legacy file and restore after closing the connection', async () => {
    const document = JSON.stringify({ cleanKeys: [0], keys: ['alpha'], notes: { 'A.md': { keys: [0], mtime: 1, size: 2 } }, version: 1 });
    const files = new Map([['mentions.json', document]]);
    const first = createStorage({ device: 'one', files, kind: 'mentions' });
    expect(JSON.parse(await first.read() ?? 'null')).toEqual(JSON.parse(document));
    expect(files.size).toBe(0);
    await first.close();
    const reopened = createStorage({ device: 'one', files, kind: 'mentions' });
    expect(JSON.parse(await reopened.read() ?? 'null')).toEqual(JSON.parse(document));
    const other = createStorage({ device: 'two', files, kind: 'mentions' });
    expect(await other.read()).toBeNull();
  });

  it('should sync registrations but keep property values on the device that indexed them', async () => {
    const files = new Map([['properties.json', JSON.stringify({ properties: { custom: { 'A.md': ['private-cache-value'] } }, version: 1 })]]);
    const first = createStorage({ device: 'one', files, kind: 'properties' });
    await first.read();
    expect(files.has('properties.json')).toBe(false);
    expect([...files.values()].join('')).not.toContain('private-cache-value');
    const second = createStorage({ device: 'two', files, kind: 'properties' });
    expect(JSON.parse(await second.read() ?? 'null')).toEqual({ properties: { custom: {} }, version: 1 });
    expect(JSON.parse(await first.read() ?? 'null')).toMatchObject({ properties: { custom: { 'A.md': ['private-cache-value'] } } });
  });

  it('should converge concurrent heading observations and preserve them after restart', async () => {
    const files = new Map<string, string>();
    const first = createStorage({ device: 'one', files, kind: 'headings' });
    const second = createStorage({ device: 'two', files, kind: 'headings' });
    await first.read();
    await second.read();
    await first.write(headingDocument(20, 30, null));
    await second.write(headingDocument(10, 25, 40));
    const result = await first.read();
    expect(result).toBe(await second.read());
    expect(JSON.parse(result ?? 'null')).toMatchObject({ notes: { 'A.md': { headings: [{ created: 10, modified: 30, seen: 40 }] } } });
    await first.close();
    expect(await createStorage({ device: 'one', files, kind: 'headings' }).read()).toBe(result);
  });

  it('should discard old incarnations after deletion and recreation, including a stale device write', async () => {
    const files = new Map<string, string>();
    const first = createStorage({ device: 'one', files, kind: 'headings' });
    const second = createStorage({ device: 'two', files, kind: 'headings' });
    await first.read();
    await first.write(headingDocument(10, 20, 30));
    await second.read();
    first.forget('A.md');
    await first.write(JSON.stringify({ notes: {}, version: 1 }));
    first.reset('A.md');
    await first.write(headingDocument(100, 100, null));
    await second.write(headingDocument(10, 50, 50));
    expect(JSON.parse(await first.read() ?? 'null')).toMatchObject({ notes: { 'A.md': { headings: [{ created: 100, modified: 100, seen: null }] } } });
  });

  it('should retain the legacy source when publication fails, then retry it safely', async () => {
    const files = new Map([['headings.json', headingDocument(10, 20, 30)]]);
    const adapter = createAdapter(files);
    const write = vi.spyOn(adapter, 'write').mockRejectedValueOnce(new Error('quota'));
    const app = strictProxy<App>({ appId: 'one', vault: strictProxy<Vault>({ adapter }) });
    const storage = new PluginIndexStorage({ app, getLegacyPath: (): string => 'headings.json', kind: 'headings', pluginId: 'test' });
    storages.push(storage);
    await expect(storage.read()).rejects.toThrow('quota');
    expect(files.has('headings.json')).toBe(true);
    write.mockRestore();
    expect(JSON.parse(await storage.read() ?? 'null')).toMatchObject({ notes: { 'A.md': { headings: [{ created: 10 }] } } });
    expect(files.has('headings.json')).toBe(false);
  });

  it('should not turn an omitted remote note into a deletion when saving a stale snapshot', async () => {
    const files = new Map<string, string>();
    const first = createStorage({ device: 'one', files, kind: 'headings' });
    const second = createStorage({ device: 'two', files, kind: 'headings' });
    await first.read();
    await second.write(headingDocument(10, 20, null));
    await first.read();
    await first.write(JSON.stringify({ notes: {}, version: 1 }));
    expect(JSON.parse(await second.read() ?? 'null')).toMatchObject({ notes: { 'A.md': { headings: [{ created: 10 }] } } });
  });

  it('should carry history across a rename and not resurrect the retired source from an old legacy file', async () => {
    const files = new Map<string, string>();
    const first = createStorage({ device: 'one', files, kind: 'headings' });
    await first.read();
    await first.write(headingDocument(10, 20, null));
    first.forget('A.md');
    await first.write(headingDocument(10, 20, null).replaceAll('A.md', 'B.md'));
    files.set('headings.json', headingDocument(1, 2, null));
    const second = createStorage({ device: 'two', files, kind: 'headings' });
    expect(JSON.parse(await second.read() ?? 'null')).toMatchObject({ notes: { 'B.md': { headings: [{ created: 10 }] } } });
    expect(await second.read()).not.toContain('A.md');
  });

  it.each(['headings', 'mentions', 'properties'] as const)('should preserve malformed %s migration sources', async (kind) => {
    const files = new Map([[`${kind}.json`, '{']]);
    const storage = createStorage({ device: 'one', files, kind });
    await expect(storage.read()).rejects.toThrow('original file has been preserved');
    expect(files.get(`${kind}.json`)).toBe('{');
  });

  it.each(
    [
      ['headings', JSON.stringify({ notes: { bad: { headings: [] } }, version: 1 })],
      ['mentions', JSON.stringify({ cleanKeys: [], keys: [], notes: { bad: { keys: [] } }, version: 1 })],
      ['properties', JSON.stringify({ properties: { bad: { 'A.md': [false] } }, version: 1 })]
    ] as const
  )('should preserve partially malformed %s migration sources', async (kind, json) => {
    const files = new Map([[`${kind}.json`, json]]);
    await expect(createStorage({ device: 'one', files, kind }).read()).rejects.toThrow('original file has been preserved');
    expect(files.get(`${kind}.json`)).toBe(json);
  });

  it('should retry removal without importing the old history twice', async () => {
    const files = new Map([['headings.json', headingDocument(10, 20, null)]]);
    const adapter = createAdapter(files);
    const remove = vi.spyOn(adapter, 'remove').mockRejectedValueOnce(new Error('locked'));
    const app = strictProxy<App>({ appId: 'one', vault: strictProxy<Vault>({ adapter }) });
    const storage = new PluginIndexStorage({ app, getLegacyPath: (): string => 'headings.json', kind: 'headings', pluginId: 'test' });
    storages.push(storage);
    await expect(storage.read()).rejects.toThrow('locked');
    remove.mockRestore();
    const before = [...files.values()].join('');
    expect(await storage.read()).toContain('A.md');
    expect(files.has('headings.json')).toBe(false);
    expect([...files.values()].join('').length).toBeLessThan(before.length);
  });

  it('should restore pending lifecycle changes after a failed write and compact a long-lived writer', async () => {
    const files = new Map<string, string>();
    const adapter = createAdapter(files);
    const app = strictProxy<App>({ appId: 'one', vault: strictProxy<Vault>({ adapter }) });
    const storage = new PluginIndexStorage({ app, getLegacyPath: (): string => 'headings.json', kind: 'headings', pluginId: 'test' });
    storages.push(storage);
    await storage.read();
    await storage.write(headingDocument(10, 20, null));
    storage.forget('A.md');
    const write = vi.spyOn(adapter, 'write').mockRejectedValueOnce(new Error('quota'));
    await expect(storage.write(JSON.stringify({ notes: {}, version: 1 }))).rejects.toThrow('quota');
    write.mockRestore();
    await storage.write(JSON.stringify({ notes: {}, version: 1 }));
    expect(await storage.read()).not.toContain('A.md');
    for (let index = 0; index < 120; index++) {
      await storage.write(JSON.stringify({ notes: {}, version: 1 }));
    }
    expect([...files.keys()].some((path) => path.includes('snapshot-'))).toBe(true);
  });

  it('should reject a corrupted writer identity instead of accidentally sharing another writer slot', async () => {
    const local = await LocalDataStore.open({ pluginId: 'test', storeId: 'heading-observations-v1', vaultId: 'one' });
    await local.set('consumer-device', 42);
    local.close();
    await expect(createStorage({ device: 'one', files: new Map(), kind: 'headings' }).read()).rejects.toThrow('Invalid heading writer identity');
  });

  it('should preserve a newer local cache when a legacy file reappears before its first import', async () => {
    const files = new Map<string, string>();
    const storage = createStorage({ device: 'one', files, kind: 'mentions' });
    const current = JSON.stringify({ cleanKeys: [0], keys: ['current'], notes: {}, version: 1 });
    await storage.write(current);
    await storage.close();
    files.set('mentions.json', JSON.stringify({ cleanKeys: [0], keys: ['legacy'], notes: {}, version: 1 }));
    expect(JSON.parse(await createStorage({ device: 'one', files, kind: 'mentions' }).read() ?? 'null')).toMatchObject({ keys: ['current'] });
    expect(files.has('mentions.json')).toBe(false);
  });

  it('should preserve legacy values for names already registered on another device', async () => {
    const files = new Map<string, string>();
    await createStorage({ device: 'one', files, kind: 'properties' }).write(JSON.stringify({ properties: { sharedName: {} }, version: 1 }));
    files.set('properties.json', JSON.stringify({ properties: { sharedName: { 'A.md': ['value'] } }, version: 1 }));
    expect(JSON.parse(await createStorage({ device: 'two', files, kind: 'properties' }).read() ?? 'null')).toEqual({ properties: { sharedName: { 'A.md': ['value'] } }, version: 1 });
  });
});
