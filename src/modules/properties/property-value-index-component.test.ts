import type { App as AppOriginal } from 'obsidian';
import type { TFile } from 'obsidian-test-mocks/obsidian';

import { setTimeoutAsync } from '@mnaoumov/typescript-lib/async';
import { noop } from '@mnaoumov/typescript-lib/function';
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

const DATA_FILE_PATH = 'property-values.json';

describe('PropertyValueIndexComponent', () => {
  let app: App;
  let component: PropertyValueIndexComponent;
  let index: PropertyValueIndex;

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();

    index = new PropertyValueIndex({
      app: castTo<AppOriginal>(app),
      getDataFilePath: (): string => DATA_FILE_PATH,
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings: new PluginSettings() })
    });
    component = new PropertyValueIndexComponent({ app: castTo<AppOriginal>(app), propertyValueIndex: index });
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
