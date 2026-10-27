import type { App as ObsidianApp } from 'obsidian';

import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { IndexStorage } from './index-storage.ts';

import {
  HeadingTimesIndex,
  mergeHeadingNotes
} from '../modules/headings/heading-times-index.ts';
import { PropertyValueIndex } from '../modules/properties/property-value-index.ts';
import { PluginSettings } from '../plugin-settings.ts';

const SNAPSHOT = { bodyHash: 'body', level: 1, line: 0, subtreeHash: 'subtree', text: 'A' };
const NOTE = { headings: [{ ...SNAPSHOT, created: 10, modified: 20, seen: 30 }], mtime: 1 };

function headingIndex(storage: IndexStorage): HeadingTimesIndex {
  return new HeadingTimesIndex({ app: castTo<ObsidianApp>(App.createConfigured__()), getDataFilePath: (): string => 'legacy.json', pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings: new PluginSettings() }), storage });
}

describe('index persistence integration', () => {
  it('should not reopen or repopulate heading persistence after unloading during a save', async () => {
    const read = vi.fn<IndexStorage['read']>().mockResolvedValue(JSON.stringify({ notes: { 'A.md': NOTE }, version: 1 }));
    const write = vi.fn<IndexStorage['write']>();
    const index = headingIndex({ read, write });
    index.trackEmpty('A.md', 1);
    write.mockImplementation(() => {
      index.clear();
      return noopAsync();
    });
    await index.synchronize();
    expect(read).not.toHaveBeenCalled();
    expect(index.getPaths()).toEqual([]);
  });

  it('should discard property loads and synchronization completed after unload', async () => {
    const read = vi.fn<IndexStorage['read']>();
    const index = new PropertyValueIndex({ app: castTo<ObsidianApp>(App.createConfigured__()), getDataFilePath: (): string => 'legacy.json', pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings: new PluginSettings() }), storage: { read, write: noopAsync } });
    index.register('sticky');
    read.mockImplementation(() => {
      index.clear();
      return Promise.resolve(JSON.stringify({ properties: { remote: { 'A.md': ['value'] } }, version: 1 }));
    });
    await index.load();
    expect(index.getPropertyNames()).toEqual(['sticky']);
    expect(await index.synchronize()).toBe(false);
    expect(index.getPropertyNames()).toEqual(['sticky']);
  });
  it('should merge shared times, adopt new notes, remove retired paths and retain dormant history', async () => {
    const write = vi.fn(noopAsync);
    const storage = { read: (): Promise<null | string> => Promise.resolve(JSON.stringify({ notes: { 'A.md': NOTE, 'B.md': NOTE }, version: 1 })), write };
    const index = headingIndex(storage);
    index.record({ mtime: 1, path: 'A.md', snapshots: [SNAPSHOT], time: 1 });
    index.trackEmpty('Retired.md', 1);
    await index.synchronize();
    expect(write).toHaveBeenCalledOnce();
    expect(index.getPaths()).toEqual(['A.md', 'B.md']);
    expect(index.get('A.md')?.headings[0]).toMatchObject({ created: 10, modified: 20, seen: 30 });
    expect(index.resumeMissing('B.md')).toBe(true);
  });

  it.each([null, '{', JSON.stringify({ notes: {}, version: 2 })])('should ignore unavailable shared state %s', async (json) => {
    const index = headingIndex({ read: () => Promise.resolve(json), write: noopAsync });
    await index.synchronize();
    expect(index.getPaths()).toEqual([]);
  });

  it('should preserve a local edit made while shared state is being read', async () => {
    const storage = { read: vi.fn<IndexStorage['read']>(), write: noopAsync };
    const index = headingIndex(storage);
    storage.read.mockImplementation(() => {
      index.trackEmpty('Local.md', 2);
      return Promise.resolve(JSON.stringify({ notes: { 'Remote.md': NOTE }, version: 1 }));
    });
    await index.synchronize();
    expect(index.getPaths()).toEqual(['Local.md']);
    await index.load();
    expect(index.getPaths()).toEqual(['Local.md', 'Remote.md']);
  });

  it('should retain the dirty flag when a newer edit arrives while a save is pending', async () => {
    const storage = { read: (): Promise<null | string> => Promise.resolve(null), write: vi.fn<IndexStorage['write']>() };
    const index = headingIndex(storage);
    index.trackEmpty('A.md', 1);
    storage.write.mockImplementation(() => {
      index.trackEmpty('B.md', 2);
      return noopAsync();
    });
    await index.save();
    expect(index.isDirty).toBe(true);
  });

  it('should merge unaffected saved paths without overwriting the same path edited during loading', async () => {
    const storage = { read: vi.fn<IndexStorage['read']>(), write: noopAsync };
    const index = headingIndex(storage);
    storage.read.mockImplementation(() => {
      index.trackEmpty('A.md', 100);
      return Promise.resolve(JSON.stringify({ notes: { 'A.md': NOTE, 'B.md': NOTE }, version: 1 }));
    });
    await index.load();
    expect(index.get('A.md')?.mtime).toBe(100);
    expect(index.get('B.md')?.mtime).toBe(1);
  });

  it('should send explicit lifecycle events and close its persistence connection', async () => {
    const close = vi.fn(noopAsync);
    const forget = vi.fn<(path: string) => void>();
    const reset = vi.fn<(path: string) => void>();
    const index = headingIndex({ close, forget, read: () => Promise.resolve(null), reset, write: noopAsync });
    index.trackEmpty('A.md', 1);
    index.rename('A.md', 'B.md');
    index.delete('B.md');
    index.delete('Absent.md');
    await index.close();
    expect(forget.mock.calls).toEqual([['A.md'], ['B.md']]);
    expect(reset.mock.calls).toEqual([['A.md'], ['B.md']]);
    expect(close).toHaveBeenCalledOnce();
  });

  it('should keep unmatched headings and merge all combinations of known and unknown times', () => {
    const unknown = { ...NOTE, headings: [{ ...SNAPSHOT, created: null, modified: null, seen: null }] };
    expect(mergeHeadingNotes(NOTE, unknown)).toEqual(NOTE);
    expect(mergeHeadingNotes(unknown, NOTE)).toEqual(NOTE);
    expect(mergeHeadingNotes(NOTE, { headings: [], mtime: 1 })).toEqual(NOTE);
  });

  it('should import shared property registrations once, tolerate an unavailable store and preserve dirty state on failure', async () => {
    const read = vi.fn<IndexStorage['read']>().mockResolvedValue(JSON.stringify({ properties: { remote: {} }, version: 1 }));
    const write = vi.fn<IndexStorage['write']>().mockRejectedValue(new Error('quota'));
    const close = vi.fn(noopAsync);
    const index = new PropertyValueIndex({ app: castTo<ObsidianApp>(App.createConfigured__()), getDataFilePath: (): string => 'legacy.json', pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings: new PluginSettings() }), storage: { close, read, write } });
    expect(await index.synchronize()).toBe(true);
    expect(await index.synchronize()).toBe(false);
    await expect(index.save()).rejects.toThrow('quota');
    expect(index.isDirty).toBe(true);
    read.mockResolvedValue(null);
    expect(await index.synchronize()).toBe(false);
    read.mockResolvedValue('{');
    expect(await index.synchronize()).toBe(false);
    await index.close();
    expect(close).toHaveBeenCalledOnce();
  });
});
