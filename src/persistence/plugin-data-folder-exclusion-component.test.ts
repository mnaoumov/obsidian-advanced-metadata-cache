import { AsyncEvents } from '@mnaoumov/typescript-lib/async-events';
import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { waitForAllAsyncOperations } from '@mnaoumov/typescript-test-toolkit/async-operation-tracking';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';
import type { PluginDataSync } from './plugin-data-sync.ts';

import {
  PLUGIN_DATA_FOLDER_DOCS_URL,
  PLUGIN_DATA_FOLDER_README,
  PLUGIN_SUBFOLDER_README,
  PluginDataFolderExclusionComponent
} from './plugin-data-folder-exclusion-component.ts';
import { DEFAULT_PLUGIN_DATA_FOLDER } from './storage-paths.ts';

interface LayoutReadyTrigger {
  readonly onLayoutReady: () => void;
}

interface SettingsState {
  readonly effectiveValues: Pick<PluginSettings, 'pluginDataFolder'>;
}

const MANAGED_KEY = 'advanced-metadata-cache:managed-ignore-filters-v1';
const OWN_FOLDER = `${DEFAULT_PLUGIN_DATA_FOLDER}/advanced-metadata-cache`;

let app: ReturnType<App['asOriginalType__']>;
let events: AsyncEvents;
let settings: Pick<PluginSettings, 'pluginDataFolder'>;
let storeFolders: string[];
let isSyncEnabled: boolean;
let changedCallbacks: (() => void)[];
let component: PluginDataFolderExclusionComponent;

function getFilters(): string[] {
  return castTo<null | string[] | undefined>(app.vault.getConfig('userIgnoreFilters')) ?? [];
}

function state(pluginDataFolder: string): SettingsState {
  return { effectiveValues: { pluginDataFolder } };
}

beforeEach(() => {
  app = App.createConfigured__().asOriginalType__();
  events = new AsyncEvents();
  settings = { pluginDataFolder: DEFAULT_PLUGIN_DATA_FOLDER };
  storeFolders = [DEFAULT_PLUGIN_DATA_FOLDER];
  isSyncEnabled = true;
  changedCallbacks = [];
  const pluginDataSync = strictProxy<PluginDataSync>({
    ensureLoaded: noopAsync,
    get isSyncEnabled(): boolean {
      return isSyncEnabled;
    },
    onChanged: (callback: () => void): () => void => {
      changedCallbacks.push(callback);
      return () => {
        changedCallbacks.splice(changedCallbacks.indexOf(callback), 1);
      };
    },
    get storeFolders(): string[] {
      return [...storeFolders];
    }
  });
  const pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
    on: castTo<PluginSettingsComponent['on']>(events.on.bind(events)),
    settings: castTo<PluginSettings>(settings)
  });
  component = new PluginDataFolderExclusionComponent({ app, pluginDataSync, pluginSettingsComponent });
});

afterEach(async () => {
  component.unload();
  await waitForAllAsyncOperations();
  vi.restoreAllMocks();
});

describe('PluginDataFolderExclusionComponent', () => {
  it('should exclude the folder while this device syncs, and write no README before its subfolder exists', async () => {
    await component.reconcile();

    expect(getFilters()).toEqual([`${DEFAULT_PLUGIN_DATA_FOLDER}/`]);
    expect(await app.vault.adapter.exists(DEFAULT_PLUGIN_DATA_FOLDER)).toBe(false);
  });

  it('should add nothing and write nothing on a device that keeps its state locally, even beside an old folder', async () => {
    isSyncEnabled = false;
    await app.vault.createFolder(OWN_FOLDER);

    await component.reconcile();

    expect(getFilters()).toEqual([]);
    expect(app.loadLocalStorage(MANAGED_KEY)).toBeNull();
    expect(await app.vault.adapter.exists(`${OWN_FOLDER}/README.md`)).toBe(false);
  });

  it('should explain the folder and its own subfolder with a README each', async () => {
    await app.vault.createFolder(OWN_FOLDER);

    await component.reconcile();

    expect(await app.vault.adapter.read(`${DEFAULT_PLUGIN_DATA_FOLDER}/README.md`)).toBe(PLUGIN_DATA_FOLDER_README);
    expect(await app.vault.adapter.read(`${OWN_FOLDER}/README.md`)).toBe(PLUGIN_SUBFOLDER_README);
    expect(PLUGIN_DATA_FOLDER_README).toContain(PLUGIN_DATA_FOLDER_DOCS_URL);
    expect(PLUGIN_SUBFOLDER_README).toContain(PLUGIN_DATA_FOLDER_DOCS_URL);
  });

  it('should never overwrite another plugin\'s README of the shared folder, but restore its own', async () => {
    await app.vault.createFolder(OWN_FOLDER);
    await app.vault.adapter.write(`${DEFAULT_PLUGIN_DATA_FOLDER}/README.md`, 'written by another plugin');
    await app.vault.adapter.write(`${OWN_FOLDER}/README.md`, 'edited by hand');

    await component.reconcile();

    expect(await app.vault.adapter.read(`${DEFAULT_PLUGIN_DATA_FOLDER}/README.md`)).toBe('written by another plugin');
    expect(await app.vault.adapter.read(`${OWN_FOLDER}/README.md`)).toBe(PLUGIN_SUBFOLDER_README);

    const write = vi.spyOn(app.vault.adapter, 'write');
    await component.reconcile();
    expect(write).not.toHaveBeenCalled();
  });

  it('should exclude every folder a move used and the folder the setting names, skipping hidden ones', async () => {
    storeFolders = [DEFAULT_PLUGIN_DATA_FOLDER, 'Meta/Sync', 'Meta/.old'];
    settings.pluginDataFolder = 'Next';

    await component.reconcile();

    expect(getFilters()).toEqual([`${DEFAULT_PLUGIN_DATA_FOLDER}/`, 'Meta/Sync/', 'Next/']);
  });

  it('should keep the user\'s entries, and never take over one they already had', async () => {
    app.vault.setConfig('userIgnoreFilters', ['Private/', `${DEFAULT_PLUGIN_DATA_FOLDER}/`]);

    await component.reconcile();
    expect(app.loadLocalStorage(MANAGED_KEY)).toBeNull();

    isSyncEnabled = false;
    await component.reconcile();
    expect(getFilters()).toEqual(['Private/', `${DEFAULT_PLUGIN_DATA_FOLDER}/`]);
  });

  it('should drop its entry once sync is turned off, unless another plugin still keeps a subfolder there', async () => {
    await component.reconcile();
    await app.vault.createFolder(OWN_FOLDER);
    await app.vault.createFolder(`${DEFAULT_PLUGIN_DATA_FOLDER}/obsidian-custom-attachment-location`);
    isSyncEnabled = false;

    await component.reconcile();
    expect(getFilters()).toEqual([`${DEFAULT_PLUGIN_DATA_FOLDER}/`]);
    expect(app.loadLocalStorage(MANAGED_KEY)).toEqual([`${DEFAULT_PLUGIN_DATA_FOLDER}/`]);

    await app.vault.adapter.rmdir(`${DEFAULT_PLUGIN_DATA_FOLDER}/obsidian-custom-attachment-location`, true);
    await component.reconcile();
    expect(getFilters()).toEqual([]);
    expect(app.loadLocalStorage(MANAGED_KEY)).toBeNull();
  });

  it('should not rewrite the vault config when nothing changed', async () => {
    await component.reconcile();
    const setConfig = vi.spyOn(app.vault, 'setConfig');

    await component.reconcile();

    expect(setConfig).not.toHaveBeenCalled();
  });

  it('should ignore damaged remembered entries', async () => {
    app.saveLocalStorage(MANAGED_KEY, 'damaged');
    app.vault.setConfig('userIgnoreFilters', ['damaged']);

    await component.reconcile();

    expect(getFilters()).toEqual(['damaged', `${DEFAULT_PLUGIN_DATA_FOLDER}/`]);
  });

  it('should follow folder setting changes and sync changes once loaded', async () => {
    component.load();
    castTo<LayoutReadyTrigger>(component).onLayoutReady();
    await waitForAllAsyncOperations();
    expect(getFilters()).toEqual([`${DEFAULT_PLUGIN_DATA_FOLDER}/`]);

    settings.pluginDataFolder = 'Meta/Sync data';
    await events.triggerAsync('saveSettings', state('Meta/Sync data'), state('Meta/Sync data'));
    await waitForAllAsyncOperations();
    expect(getFilters()).toEqual([`${DEFAULT_PLUGIN_DATA_FOLDER}/`]);

    await events.triggerAsync('saveSettings', state('Meta/Sync data'), state(DEFAULT_PLUGIN_DATA_FOLDER));
    await waitForAllAsyncOperations();
    expect(getFilters()).toEqual([`${DEFAULT_PLUGIN_DATA_FOLDER}/`, 'Meta/Sync data/']);

    isSyncEnabled = false;
    for (const callback of changedCallbacks) {
      callback();
    }
    await waitForAllAsyncOperations();
    expect(getFilters()).toEqual([]);

    component.unload();
    expect(changedCallbacks).toEqual([]);
  });

  it('should keep reconciling after a failed run', async () => {
    await app.vault.createFolder(OWN_FOLDER);
    vi.spyOn(app.vault.adapter, 'exists').mockRejectedValueOnce(new Error('offline'));

    await expect(component.reconcile()).rejects.toThrow('offline');
    await component.reconcile();

    expect(await app.vault.adapter.read(`${OWN_FOLDER}/README.md`)).toBe(PLUGIN_SUBFOLDER_README);
  });
});
