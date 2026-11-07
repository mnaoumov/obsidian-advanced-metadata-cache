import type {
  App,
  DataAdapter,
  Vault
} from 'obsidian';

import { LocalDataStore } from '@mnaoumov/obsidian-lib/data-stores/local-data-store';
import { SharedDataStore } from '@mnaoumov/obsidian-lib/data-stores/shared-data-store';
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

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { PluginDataSync } from './plugin-data-sync.ts';
import {
  DEFAULT_PLUGIN_DATA_FOLDER,
  isPluginDataPath,
  LEGACY_PLUGIN_DATA_FOLDER,
  setPluginDataPathMatcher,
  validatePluginDataFolder
} from './storage-paths.ts';

interface Device {
  readonly local: LocalDataStore;
  readonly settings: DeviceSettings;
  readonly sync: PluginDataSync;
}

interface DeviceSettings {
  readonly isHeadingsModuleEnabled: boolean;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- A test changes the synchronized folder setting.
  pluginDataFolder: string;
}

const LEGACY_HEADING_ROOT = `${LEGACY_PLUGIN_DATA_FOLDER}/advanced-metadata-cache/heading-observations-v1`;

const connections: LocalDataStore[] = [];
const syncs: PluginDataSync[] = [];

function createAdapter(files: Map<string, string>): DataAdapter {
  const directories = new Set<string>();
  return strictProxy<DataAdapter>({
    exists: (path) => Promise.resolve(files.has(path) || directories.has(path) || [...files.keys(), ...directories].some((file) => file.startsWith(`${path}/`))),
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

async function createDevice(files: Map<string, string>, appId = 'alpha', isHeadingsModuleEnabled = false): Promise<Device> {
  const app = strictProxy<App>({ appId, vault: strictProxy<Vault>({ adapter: createAdapter(files) }) });
  const settings: DeviceSettings = { isHeadingsModuleEnabled, pluginDataFolder: DEFAULT_PLUGIN_DATA_FOLDER };
  const sync = new PluginDataSync({ app, pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings }) });
  syncs.push(sync);
  const local = await LocalDataStore.open({ pluginId: 'advanced-metadata-cache', storeId: 'heading-observations-v1', vaultId: appId });
  connections.push(local);
  return { local, settings, sync };
}

async function openHeadings(device: Device): Promise<SharedDataStore> {
  return await device.sync.openShared({ kind: 'last-write-wins', local: device.local, storeId: 'heading-observations-v1' });
}

describe('PluginDataSync', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('navigator', { locks: { request: async <T>(_name: string, callback: () => Promise<T>): Promise<T> => await callback() } });
  });

  afterEach(async () => {
    for (const sync of syncs.splice(0)) {
      await sync.close();
    }
    for (const connection of connections.splice(0)) {
      connection.close();
    }
    setPluginDataPathMatcher(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('should keep a fresh device off and create no folder while its store is written', async () => {
    const files = new Map<string, string>();
    const device = await createDevice(files);
    const shared = await openHeadings(device);
    await shared.set('key', 'value');
    await shared.compact();

    expect(device.sync.isSyncEnabled).toBe(false);
    expect(device.sync.anchorFolder).toBe(DEFAULT_PLUGIN_DATA_FOLDER);
    expect(device.sync.storeFolders).toEqual([DEFAULT_PLUGIN_DATA_FOLDER]);
    expect(files.size).toBe(0);
  });

  it('should enroll an upgraded device only when it keeps heading times and the vault already holds them', async () => {
    const files = new Map([[`${LEGACY_HEADING_ROOT}/marker.md`, '']]);
    const withHeadings = await createDevice(files, 'alpha', true);
    const withoutHeadings = await createDevice(files, 'bravo', false);
    await withHeadings.sync.ensureLoaded();
    await withoutHeadings.sync.ensureLoaded();

    expect(withHeadings.sync.isSyncEnabled).toBe(true);
    expect(withoutHeadings.sync.isSyncEnabled).toBe(false);
    // Both join the history an earlier version left, whenever they sync.
    expect(withHeadings.sync.anchorFolder).toBe(LEGACY_PLUGIN_DATA_FOLDER);
    expect(withoutHeadings.sync.anchorFolder).toBe(LEGACY_PLUGIN_DATA_FOLDER);
  });

  it('should publish an open store once sync is turned on, and remember the consent on this device only', async () => {
    const files = new Map<string, string>();
    const device = await createDevice(files);
    const changed = vi.fn();
    const stop = device.sync.onChanged(changed);
    const shared = await openHeadings(device);
    await shared.set('key', 'value');

    await device.sync.setSyncEnabled(true);

    expect(changed).toHaveBeenCalledOnce();
    expect([...files.keys()].every((path) => path.startsWith(`${DEFAULT_PLUGIN_DATA_FOLDER}/advanced-metadata-cache/heading-observations-v1/`))).toBe(true);
    expect(files.size).toBeGreaterThan(0);

    stop();
    await device.sync.close();
    const reloaded = await createDevice(files);
    await reloaded.sync.ensureLoaded();
    expect(reloaded.sync.isSyncEnabled).toBe(true);
    const otherDevice = await createDevice(files, 'bravo');
    await otherDevice.sync.ensureLoaded();
    expect(otherDevice.sync.isSyncEnabled).toBe(false);
    expect(changed).toHaveBeenCalledOnce();
  });

  it('should stop writing to the vault once sync is turned off, keeping every file', async () => {
    const files = new Map<string, string>();
    const device = await createDevice(files);
    const shared = await openHeadings(device);
    await device.sync.setSyncEnabled(true);
    const published = new Map(files);

    await device.sync.setSyncEnabled(false);
    await shared.set('later', 'value');
    await shared.compact();

    expect(device.sync.isSyncEnabled).toBe(false);
    expect(files).toEqual(published);
    const reloaded = await createDevice(files);
    await reloaded.sync.ensureLoaded();
    expect(reloaded.sync.isSyncEnabled).toBe(false);
  });

  it('should roll every store back to local when turning sync on fails', async () => {
    const device = await createDevice(new Map());
    const shared = await openHeadings(device);
    const setSyncEnabled = vi.spyOn(shared, 'setSyncEnabled').mockRejectedValueOnce(new Error('offline'));

    await expect(device.sync.setSyncEnabled(true)).rejects.toThrow('offline');

    expect(device.sync.isSyncEnabled).toBe(false);
    expect(setSyncEnabled).toHaveBeenLastCalledWith(false);
    // A failed operation does not wedge the ones queued after it.
    await device.sync.setSyncEnabled(true);
    expect(device.sync.isSyncEnabled).toBe(true);
  });

  it('should refuse to turn sync on when an earlier version history arrived after the stores opened, and join it next time', async () => {
    const files = new Map<string, string>();
    const device = await createDevice(files);
    await openHeadings(device);
    files.set(`${LEGACY_HEADING_ROOT}/marker.md`, '');

    await expect(device.sync.setSyncEnabled(true)).rejects.toThrow('Restart Obsidian');

    expect(device.sync.isSyncEnabled).toBe(false);
    const reloaded = await createDevice(files);
    await reloaded.sync.ensureLoaded();
    expect(reloaded.sync.anchorFolder).toBe(LEGACY_PLUGIN_DATA_FOLDER);
  });

  it('should refuse a move while this device does not sync, or into a hidden folder', async () => {
    const device = await createDevice(new Map());

    await expect(device.sync.relocate('Meta/Sync')).rejects.toThrow('Turn on sync');
    await expect(device.sync.relocate('Meta/.sync')).rejects.toThrow('hidden');
    await expect(device.sync.relocate('Meta//Sync')).rejects.toThrow('vault-relative');
  });

  it('should move an open store, and a store opened later, to the new folder', async () => {
    const files = new Map<string, string>();
    const device = await createDevice(files);
    const shared = await openHeadings(device);
    await shared.set('key', 'value');
    await device.sync.setSyncEnabled(true);

    await device.sync.relocate('Meta/Sync');

    expect(device.sync.storeFolders).toEqual([DEFAULT_PLUGIN_DATA_FOLDER, 'Meta/Sync']);
    expect([...files.keys()].some((path) => path.startsWith('Meta/Sync/advanced-metadata-cache/heading-observations-v1/'))).toBe(true);

    device.sync.release(shared);
    expect(device.sync.storeFolders).toEqual([DEFAULT_PLUGIN_DATA_FOLDER, 'Meta/Sync']);
    const properties = await LocalDataStore.open({ pluginId: 'advanced-metadata-cache', storeId: 'property-names-v1', vaultId: 'alpha' });
    connections.push(properties);
    const later = await device.sync.openShared({ kind: 'minimum', local: properties, storeId: 'property-names-v1' });
    await later.set('date', 1);
    expect([...files.keys()].some((path) => path.startsWith('Meta/Sync/advanced-metadata-cache/property-names-v1/'))).toBe(true);
  });

  it('should follow the last move again when sync is turned back on', async () => {
    const files = new Map<string, string>();
    const device = await createDevice(files);
    const shared = await openHeadings(device);
    await device.sync.setSyncEnabled(true);
    await device.sync.relocate('Meta/Sync');
    await device.sync.setSyncEnabled(false);
    const relocate = vi.spyOn(shared, 'relocate');

    await device.sync.setSyncEnabled(true);

    expect(relocate).toHaveBeenCalledWith({ folder: 'Meta/Sync' });
  });

  it('should remember the last move on this device, and ignore roots that are not its own stores', async () => {
    const files = new Map<string, string>();
    const device = await createDevice(files);
    const shared = await openHeadings(device);
    await device.sync.setSyncEnabled(true);
    await device.sync.relocate('Meta/Sync');
    vi.spyOn(shared, 'transportRoots', 'get').mockReturnValue(['Elsewhere/unrelated-root', 'Moved/advanced-metadata-cache/heading-observations-v1']);
    device.sync.release(strictProxy<SharedDataStore>({}));

    expect(device.sync.storeFolders).toEqual([DEFAULT_PLUGIN_DATA_FOLDER, 'Moved', 'Meta/Sync']);

    await device.sync.close();
    const reloaded = await createDevice(files);
    await reloaded.sync.ensureLoaded();
    expect(reloaded.sync.storeFolders).toEqual([DEFAULT_PLUGIN_DATA_FOLDER, 'Meta/Sync']);
  });

  it('should close its connection and report the failure when reading the consent fails', async () => {
    const device = await createDevice(new Map());
    const close = vi.spyOn(LocalDataStore.prototype, 'close');
    vi.spyOn(LocalDataStore.prototype, 'get').mockRejectedValueOnce(new Error('blocked'));

    await expect(device.sync.ensureLoaded()).rejects.toThrow('blocked');

    expect(close).toHaveBeenCalledOnce();
    await device.sync.close();
  });

  it('should recognize the plugin data of every folder it uses, and nothing else', async () => {
    const files = new Map<string, string>();
    const device = await createDevice(files);
    await openHeadings(device);
    await device.sync.setSyncEnabled(true);
    await device.sync.relocate('Meta/Sync');
    device.settings.pluginDataFolder = 'Other/Place';

    for (const folder of [DEFAULT_PLUGIN_DATA_FOLDER, LEGACY_PLUGIN_DATA_FOLDER, 'Meta/Sync', 'Other/Place']) {
      expect(device.sync.isPluginDataPath(`${folder}/advanced-metadata-cache/heading-observations-v1/a.md`)).toBe(true);
    }
    expect(device.sync.isPluginDataPath('Meta/Sync/other-plugin/a.md')).toBe(false);
    expect(device.sync.isPluginDataPath('Notes/advanced-metadata-cache/a.md')).toBe(false);
  });
});

describe('isPluginDataPath', () => {
  afterEach(() => {
    setPluginDataPathMatcher(null);
  });

  it('should answer from the known folders until a matcher is installed, and again once it is removed', () => {
    expect(isPluginDataPath(`${DEFAULT_PLUGIN_DATA_FOLDER}/advanced-metadata-cache/a.md`)).toBe(true);
    expect(isPluginDataPath(`${LEGACY_PLUGIN_DATA_FOLDER}/advanced-metadata-cache/a.md`)).toBe(true);
    expect(isPluginDataPath('Notes/a.md')).toBe(false);

    setPluginDataPathMatcher((path) => path === 'Notes/a.md');
    expect(isPluginDataPath('Notes/a.md')).toBe(true);
    expect(isPluginDataPath(`${DEFAULT_PLUGIN_DATA_FOLDER}/advanced-metadata-cache/a.md`)).toBe(false);

    setPluginDataPathMatcher(null);
    expect(isPluginDataPath('Notes/a.md')).toBe(false);
  });
});

describe('validatePluginDataFolder', () => {
  it('should accept a nested visible folder and refuse a hidden or malformed one', () => {
    expect(validatePluginDataFolder('Meta/Sync data')).toBeNull();
    expect(validatePluginDataFolder(DEFAULT_PLUGIN_DATA_FOLDER)).toBeNull();
    expect(validatePluginDataFolder('Meta/.sync')).toContain('hidden');
    for (const folder of ['', '/Meta', 'Meta/', 'Meta/../x', ' Meta', 'Meta/a:b']) {
      expect(validatePluginDataFolder(folder)).toContain('vault-relative');
    }
  });
});
