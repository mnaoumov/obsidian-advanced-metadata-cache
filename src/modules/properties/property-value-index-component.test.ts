import type { App as AppOriginal } from 'obsidian';
import type { TFile } from 'obsidian-test-mocks/obsidian';

import { setTimeoutAsync } from '@mnaoumov/typescript-lib/async';
import { noop } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { waitForAllAsyncOperations } from '@mnaoumov/typescript-test-toolkit/async-operation-tracking';
import {
  App,
  Events
} from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../../plugin-settings-component.ts';

import { PluginSettings } from '../../plugin-settings.ts';
import { PropertyValueIndex } from './property-value-index.ts';

const hoisted = vi.hoisted(() => ({
  ensureMetadataCacheReady: vi.fn<() => Promise<void>>(async () => {
    // Ready at once unless a test says otherwise.
  })
}));

vi.mock('@mnaoumov/obsidian-lib/metadata-cache', () => ({
  ensureMetadataCacheReady: hoisted.ensureMetadataCacheReady
}));

/* eslint-disable import-x/first, import-x/imports-first -- vi.mock must precede imports. */
import {
  PropertyValueIndexComponent,
  SAVE_DEBOUNCE_IN_MILLISECONDS
} from './property-value-index-component.ts';
/* eslint-enable import-x/first, import-x/imports-first -- End of the mocked imports. */

/**
 * The part of the settings component both read: its settings, and the event a settings change fires.
 */
interface SettingsComponentStub extends Events {
  readonly settings: PluginSettings;
}

const DATA_FILE_PATH = 'property-values.json';

describe('PropertyValueIndexComponent', () => {
  let app: App;
  let assignedTypes: Record<string, string>;
  let component: PropertyValueIndexComponent;
  let index: PropertyValueIndex;
  let metadataTypeManager: Events;
  let pluginSettingsComponent: SettingsComponentStub;

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    assignedTypes = {};
    // The mocks have no `metadataTypeManager`; this is the part of it the component reads.
    metadataTypeManager = Object.assign(new Events(), {
      getAssignedWidget: (propertyName: string): null | string => assignedTypes[propertyName.toLowerCase()] ?? null
    });
    castTo<Record<'metadataTypeManager', unknown>>(app).metadataTypeManager = metadataTypeManager;

    pluginSettingsComponent = Object.assign(new Events(), { settings: new PluginSettings() });

    index = new PropertyValueIndex({
      app: castTo<AppOriginal>(app),
      getDataFilePath: (): string => DATA_FILE_PATH,
      pluginSettingsComponent: castTo<PluginSettingsComponent>(pluginSettingsComponent)
    });
    component = new PropertyValueIndexComponent({
      app: castTo<AppOriginal>(app),
      pluginSettingsComponent: castTo<PluginSettingsComponent>(pluginSettingsComponent),
      propertyValueIndex: index
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should build from the metadata cache on layout ready, forgetting saved notes that are gone', async () => {
    await app.vault.adapter.write(DATA_FILE_PATH, JSON.stringify({ properties: { keys: { 'Gone.md': ['a'] } }, version: 1 }));
    createNote('Alpha.md', '---\nkeys:\n  - a\n---\n');
    createNote('Beta.md', 'no frontmatter\n');

    await load();

    expect(component.isBuilt).toBe(true);
    expect(index.getPathsByPropertyValue('keys', 'a')).toEqual(['Alpha.md']);
  });

  it('should answer from the saved index before the metadata cache is ready, and wait for it when asked to', async () => {
    await app.vault.adapter.write(DATA_FILE_PATH, JSON.stringify({ properties: { keys: { 'Gone.md': ['a'] } }, version: 1 }));
    let resolveReady: () => void = noop;
    hoisted.ensureMetadataCacheReady.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
    });

    // Not `load()`: it waits for every async operation, and the metadata cache is held unready here.
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);

    expect(component.isBuilt).toBe(false);
    expect(index.getPathsByPropertyValue('keys', 'a')).toEqual(['Gone.md']);

    let isWaitOver = false;
    const waitPromise = component.waitForBuild().then(() => {
      isWaitOver = true;
    });
    await setTimeoutAsync(0);
    expect(isWaitOver).toBe(false);

    resolveReady();
    await waitPromise;

    expect(index.getPathsByPropertyValue('keys', 'a')).toEqual([]);
  });

  it('should fill a property registered after the build at once, and mark it for saving', async () => {
    createNote('Alpha.md', '---\nkeys: a\n---\n');
    await load();
    await index.save();

    component.registerPropertyName('keys');
    component.registerPropertyName('keys');

    expect(index.getPathsByPropertyValue('keys', 'a')).toEqual(['Alpha.md']);
    expect(index.isDirty).toBe(true);
  });

  it('should save on its debounce', async () => {
    vi.useFakeTimers();
    component.registerPropertyName('keys');
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await vi.advanceTimersByTimeAsync(0);

    expect(await app.vault.adapter.exists(DATA_FILE_PATH)).toBe(false);

    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_IN_MILLISECONDS);

    expect(JSON.parse(await app.vault.adapter.read(DATA_FILE_PATH))).toEqual({ properties: { keys: {} }, version: 1 });
  });

  it('should keep a property registered before the load, and fill it at the build', async () => {
    createNote('Alpha.md', '---\nkeys: a\n---\n');
    component.registerPropertyName('keys');

    await load();

    expect(index.getPathsByPropertyValue('keys', 'a')).toEqual(['Alpha.md']);
  });

  it('should follow changes, deletions and renames', async () => {
    const alpha = createNote('Alpha.md', '---\nkeys: a\n---\n');
    const folder = app.vault.createFolderSync__('Folder');
    createNote('Folder/Beta.md', '---\nkeys: b\n---\n');
    component.registerPropertyName('keys');
    await load();

    app.metadataCache.trigger('changed', alpha, '', { frontmatter: { keys: ['c'] } });
    expect(index.getPathsByPropertyValue('keys', 'c')).toEqual(['Alpha.md']);

    app.vault.trigger('rename', alpha, 'Old.md');
    app.vault.trigger('rename', folder, 'OldFolder');
    expect(index.getPathsWithProperty('keys')).toEqual(['Folder/Beta.md', 'Alpha.md']);

    app.vault.trigger('delete', alpha);
    app.vault.trigger('delete', folder);
    expect(index.getPathsWithProperty('keys')).toEqual([]);
  });

  it('should save once more on unload, clear its values, and release a waiting caller', async () => {
    createNote('Alpha.md', '---\nkeys: a\n---\n');
    component.registerPropertyName('keys');
    await load();

    component.unload();
    await waitForAllAsyncOperations();

    expect(index.getPathsWithProperty('keys')).toEqual([]);
    expect(JSON.parse(await app.vault.adapter.read(DATA_FILE_PATH))).toEqual({ properties: { keys: { 'Alpha.md': ['a'] } }, version: 1 });
  });

  it('should not overwrite the saved index when unloaded before it was loaded', async () => {
    const json = JSON.stringify({ properties: { keys: { 'Alpha.md': ['a'] } }, version: 1 });
    await app.vault.adapter.write(DATA_FILE_PATH, json);
    await component.loadWithPromises();
    component.registerPropertyName('other');

    const waitPromise = component.waitForBuild();
    component.unload();
    await waitPromise;
    await waitForAllAsyncOperations();

    expect(await app.vault.adapter.read(DATA_FILE_PATH)).toBe(json);
  });

  it('should stop without building when unloaded while the metadata cache was settling', async () => {
    let resolveReady: () => void = noop;
    hoisted.ensureMetadataCacheReady.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
    });
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);

    component.unload();
    resolveReady();
    await waitForAllAsyncOperations();

    expect(component.isBuilt).toBe(false);
  });

  it('should stop without following events when unloaded while the saved index was loading', async () => {
    let resolveExists: (isExisting: boolean) => void = noop;
    vi.spyOn(app.vault.adapter, 'exists').mockImplementationOnce(async () =>
      await new Promise<boolean>((resolve) => {
        resolveExists = resolve;
      })
    );
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);

    component.unload();
    resolveExists(false);
    await waitForAllAsyncOperations();

    expect(component.isBuilt).toBe(false);
    expect(hoisted.ensureMetadataCacheReady).not.toHaveBeenCalled();
  });

  it('should register every date-typed property at the build, in each casing a note spells it', async () => {
    assignedTypes = { birthday: 'date', created: 'datetime', status: 'text' };
    createNote('Alpha.md', '---\nbirthday: 1990-10-26\nstatus: 2026-01-01\n---\n');
    createNote('Beta.md', '---\nBirthday: 1985-10-27\ncreated: 2026-10-25T09:30\n---\n');

    await load();

    expect(index.getPropertyNames()).toEqual(['birthday', 'Birthday', 'created']);
    expect(index.getDatedValues({})).toEqual([
      { path: 'Beta.md', propertyName: 'Birthday', value: '1985-10-27' },
      { path: 'Alpha.md', propertyName: 'birthday', value: '1990-10-26' },
      { path: 'Beta.md', propertyName: 'created', value: '2026-10-25T09:30' }
    ]);
  });

  it('should register a date-typed property a changed note introduces, and read it from every note', async () => {
    assignedTypes = { due: 'date' };
    createNote('Alpha.md', '---\ndue: 2026-10-26\n---\n');
    const beta = createNote('Beta.md', '');
    // Not in the metadata cache at the build, as a note created after it would not be.
    vi.spyOn(app.metadataCache, 'getFileCache').mockReturnValue(null);
    await load();

    expect(index.getPropertyNames()).toEqual([]);

    vi.mocked(app.metadataCache.getFileCache).mockRestore();
    app.metadataCache.trigger('changed', beta, '', { frontmatter: { due: '2026-10-27' } });

    expect(index.getPropertyNames()).toEqual(['due']);
    expect(index.getDatedValues({})?.map((datedValue) => datedValue.path)).toEqual(['Alpha.md']);
  });

  it('should register a property once a date type is assigned to it, and only after the build', async () => {
    createNote('Alpha.md', '---\ndue: 2026-10-26\n---\n');
    createNote('Beta.md', '---\nstart: 2026-10-26T09:30\n---\n');
    let resolveReady: () => void = noop;
    hoisted.ensureMetadataCacheReady.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
    });
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);

    assignedTypes = { due: 'date' };
    metadataTypeManager.trigger('changed', 'due');
    expect(index.getPropertyNames()).toEqual([]);

    resolveReady();
    await waitForAllAsyncOperations();
    expect(index.getPropertyNames()).toEqual(['due']);

    metadataTypeManager.trigger('changed', 'due');
    expect(index.getPropertyNames()).toEqual(['due']);

    assignedTypes = { due: 'date', start: 'datetime' };
    metadataTypeManager.trigger('changed', 'start');
    expect(index.getPropertyNames()).toEqual(['due', 'start']);
    expect(index.getDatedValues({ propertyNames: ['start'] })).toEqual([{ path: 'Beta.md', propertyName: 'start', value: '2026-10-26T09:30' }]);
    expect(index.isDirty).toBe(true);
  });

  it('should register a property by its name, whatever its type, and list its values that are not dates', async () => {
    assignedTypes = { birthdate: 'text' };
    createNote('Alpha.md', '---\nbirthDate: 1990-10-26\ndate: "2026-10-26T00:21:46-06:00"\nupdate: 2026-01-01\n---\n');
    createNote('Beta.md', '---\nbirthDate: unknown\nDate: "14:30"\n---\n');

    await load();

    expect(index.getPropertyNames()).toEqual(['birthDate', 'date', 'Date']);
    expect(index.getDatedValues({})).toEqual([
      { path: 'Alpha.md', propertyName: 'birthDate', value: '1990-10-26' },
      { path: 'Alpha.md', propertyName: 'date', value: '2026-10-26T00:21:46-06:00' }
    ]);
    expect(index.getNonDateValues()).toEqual([
      { path: 'Beta.md', propertyName: 'Date', value: '14:30' },
      { path: 'Beta.md', propertyName: 'birthDate', value: 'unknown' }
    ]);
  });

  it('should register the properties a name added to the setting matches, and only once the names change', async () => {
    createNote('Alpha.md', '---\nctime: "2026-10-26T09:00+02:00"\nmtime: "2026-10-26T08:00Z"\n---\n');
    await load();

    expect(index.getPropertyNames()).toEqual([]);

    pluginSettingsComponent.trigger('saveSettings');
    expect(index.getPropertyNames()).toEqual([]);

    pluginSettingsComponent.settings.datePropertyNames = ['date', '*Date', 'ctime', 'mtime'];
    pluginSettingsComponent.trigger('saveSettings');

    expect(index.getPropertyNames()).toEqual(['ctime', 'mtime']);
    // Ordered by the time as written, not by the instant, which would put 09:00+02:00 (07:00Z) first.
    expect(index.getDatedValues({ from: '2026-10-26', to: '2026-10-26' })?.map((datedValue) => datedValue.value)).toEqual([
      '2026-10-26T08:00Z',
      '2026-10-26T09:00+02:00'
    ]);
    expect(index.isDirty).toBe(true);
  });

  it('should stop following the setting once unloaded', async () => {
    createNote('Alpha.md', '---\nctime: "2026-10-26T09:00+02:00"\n---\n');
    await load();
    component.unload();

    pluginSettingsComponent.settings.datePropertyNames = ['ctime'];
    pluginSettingsComponent.trigger('saveSettings');

    expect(index.getPropertyNames()).toEqual([]);
  });

  it('should fill arriving registrations and synchronize transport changes, polling and focus', async () => {
    createNote('A.md', '---\nremote: value\n---\n');
    const intervals = vi.spyOn(window, 'setInterval');
    await load();
    const synchronize = vi.spyOn(index, 'synchronize').mockImplementation(() => Promise.resolve(index.register('remote')));
    vi.useFakeTimers();
    const journal = createNote('Plugin data/advanced-metadata-cache/names/journal.md', 'internal');
    const acknowledgement = createNote('Plugin data/advanced-metadata-cache/names/have.md', 'ack');

    app.metadataCache.trigger('changed', journal, 'internal', {});
    app.metadataCache.trigger('changed', acknowledgement, 'ack', {});
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    await waitForAllAsyncOperations();
    expect(index.getPropertyNames()).toContain('remote');
    const callback = intervals.mock.calls.find(([, delay]) => delay === 30_000)?.[0];
    castTo<() => void>(callback)();
    window.dispatchEvent(new Event('focus'));
    await waitForAllAsyncOperations();
    expect(synchronize).toHaveBeenCalledTimes(3);
    component.unload();
  });

  it('should avoid rebuilding if switched off while shared registrations are arriving', async () => {
    await load();
    vi.spyOn(index, 'synchronize').mockImplementation(() => {
      component.unload();
      return Promise.resolve(true);
    });
    window.dispatchEvent(new Event('focus'));
    await waitForAllAsyncOperations();
    expect(index.getPropertyNames()).toEqual([]);
  });
  function createNote(path: string, content: string): TFile {
    return app.vault.createSync__(path, content);
  }

  async function load(): Promise<void> {
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);
    await waitForAllAsyncOperations();
  }
});
