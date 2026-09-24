import type { App as AppOriginal } from 'obsidian';
import type { AsyncEventRef } from 'obsidian-dev-utils/async-events';
import type {
  TFile,
  TFolder
} from 'obsidian-test-mocks/obsidian';
import type { Mock } from 'vitest';

import { Component } from 'obsidian';
import {
  setTimeoutAsync,
  waitForAllAsyncOperations
} from 'obsidian-dev-utils/async';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../../plugin-settings-component.ts';

import { PluginSettings } from '../../plugin-settings.ts';
import { TitleIndex } from '../titles/title-index.ts';

const hoisted = vi.hoisted(() => ({
  patchComponentConstructor: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/metadata-cache', () => ({
  ensureMetadataCacheReady: vi.fn().mockResolvedValue(undefined)
}));

// Extends the real obsidian-test-mocks Component so the real addChild lifecycle can load it.
vi.mock('./patches/metadata-cache-get-link-suggestions-patch-component.ts', () => ({
  MetadataCacheGetLinkSuggestionsPatchComponent: class extends Component {
    public constructor(params: unknown) {
      super();
      hoisted.patchComponentConstructor(params);
    }
  }
}));

/* eslint-disable import-x/first, import-x/imports-first -- vi.mock must precede imports. */
import { NameIndexComponent } from './name-index-component.ts';
/* eslint-enable import-x/first, import-x/imports-first -- End of the mocked imports. */

describe('NameIndexComponent', () => {
  let app: App;
  let component: NameIndexComponent;
  let offref: Mock<(eventRef: AsyncEventRef) => void>;
  let settings: PluginSettings;
  let triggerSaveSettings: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();

    settings = new PluginSettings();
    offref = vi.fn();
    let saveSettingsCallback: (() => void) | undefined;

    const pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
      offref,
      on: vi.fn((_name: string, callback: () => void) => {
        saveSettingsCallback = callback;
        return strictProxy<AsyncEventRef>({});
      }),
      settings
    });
    triggerSaveSettings = (): void => {
      saveSettingsCallback?.();
    };

    component = new NameIndexComponent({
      app: castTo<AppOriginal>(app),
      pluginSettingsComponent,
      titleIndex: new TitleIndex({ app: castTo<AppOriginal>(app), pluginSettingsComponent })
    });
  });

  it('should build the index and install the patch once the layout is ready', async () => {
    createNote('Alpha.md', '---\naliases:\n  - First\n---\n');

    await load();

    expect(component.isBuilt).toBe(true);
    expect(component.nameIndex.getPathsByName('first')).toEqual(['Alpha.md']);
    expect(hoisted.patchComponentConstructor).toHaveBeenCalledOnce();
  });

  it('should hand the patch the cache it patches and the component it asks', async () => {
    await load();

    expect(hoisted.patchComponentConstructor).toHaveBeenCalledWith({
      metadataCache: app.metadataCache,
      nameIndexComponent: component
    });
  });

  it('should answer a safe call by building first, before the layout is ready', async () => {
    createNote('Alpha.md');

    expect(component.isBuilt).toBe(false);
    await expect(component.getPathsByNameSafe('alpha')).resolves.toEqual(['Alpha.md']);
    expect(component.isBuilt).toBe(true);
    await expect(component.getSuggestionsSafe()).resolves.toHaveLength(1);
  });

  it('should build once however many callers ask at the same moment', async () => {
    createNote('Alpha.md');
    const buildAll = vi.spyOn(component.nameIndex, 'buildAll');

    await Promise.all([component.getSuggestionsSafe(), component.getPathsByNameSafe('alpha'), load()]);

    expect(buildAll).toHaveBeenCalledOnce();
  });

  it('should re-read a file whose metadata changed', async () => {
    const file = createNote('Alpha.md', '---\naliases:\n  - Before\n---\n');
    await load();

    await app.vault.modify(file, '---\naliases:\n  - After\n---\n');
    app.metadataCache.trigger('changed', file, '', castTo<never>({}));

    expect(component.nameIndex.getPathsByName('before')).toEqual([]);
    expect(component.nameIndex.getPathsByName('after')).toEqual(['Alpha.md']);
  });

  it('should drop the memoized suggestions when link resolution settles', async () => {
    createNote('Alpha.md');
    await load();
    const invalidateSuggestions = vi.spyOn(component.nameIndex, 'invalidateSuggestions');

    app.metadataCache.trigger('resolved');

    expect(invalidateSuggestions).toHaveBeenCalledOnce();
  });

  it('should index a created file and forget a deleted one', async () => {
    await load();

    const file = createNote('Alpha.md');
    app.vault.trigger('create', file);
    expect(component.nameIndex.getPathsByName('alpha')).toEqual(['Alpha.md']);

    app.vault.trigger('delete', file);
    expect(component.nameIndex.getPathsByName('alpha')).toEqual([]);
  });

  it('should ignore a created folder, which carries no name of its own', async () => {
    await load();

    const folder = app.vault.createFolderSync__('Folder');
    app.vault.trigger('create', folder);

    expect(component.nameIndex.getSuggestions()).toEqual([]);
  });

  it('should forget a deleted folder subtree', async () => {
    const folder = createFolder('Folder');
    createNote('Folder/Inside.md');
    await load();

    app.vault.trigger('delete', folder);

    expect(component.nameIndex.getPathsByName('inside')).toEqual([]);
  });

  it('should re-key a renamed file', async () => {
    const file = createNote('Alpha.md');
    await load();

    await app.fileManager.renameFile(file, 'Renamed.md');
    expect(component.nameIndex.getPathsByName('alpha')).toEqual([]);
    expect(component.nameIndex.getPathsByName('renamed')).toEqual(['Renamed.md']);
  });

  it('should re-key every descendant of a renamed folder, whatever order the events arrive in', async () => {
    createFolder('Old');
    createNote('Old/Inside.md', '---\naliases:\n  - Nested\n---\n');
    await load();

    const folder = renameFolderInVault('Old', 'New');
    component.nameIndex.getSuggestions();

    // The folder's own event, with no per-descendant events at all - one of the orders Obsidian
    // does not promise NOT to use.
    app.vault.trigger('rename', folder, 'Old');

    expect(component.nameIndex.getPathsByName('inside')).toEqual(['New/Inside.md']);
    expect(component.nameIndex.getPathsByName('nested')).toEqual(['New/Inside.md']);
    expect(component.nameIndex.getSuggestions().map((suggestion) => suggestion.path)).toEqual(['New/Inside', 'New/Inside']);

    // And again, plus the descendant's own event afterwards - carrying the file at its NEW path,
    // as a real rename does: re-keying is idempotent.
    app.vault.trigger('rename', folder, 'Old');
    app.vault.trigger('rename', castTo<TFile>(app.vault.getFileByPath('New/Inside.md')), 'Old/Inside.md');

    expect(component.nameIndex.getPathsByName('inside')).toEqual(['New/Inside.md']);
  });

  it('should rebuild when the Titles module is switched on, and again when it goes off', async () => {
    createNote('Alpha.md', '---\ntitle: The Real Name\n---\n');
    await load();

    expect(component.nameIndex.getPathsByName('the real name')).toEqual([]);

    settings.isTitlesModuleEnabled = true;
    triggerSaveSettings();
    expect(component.nameIndex.getPathsByName('the real name')).toEqual(['Alpha.md']);

    settings.isTitlesModuleEnabled = false;
    triggerSaveSettings();
    expect(component.nameIndex.getPathsByName('the real name')).toEqual([]);
  });

  it('should rebuild when the configured title properties change', async () => {
    settings.isTitlesModuleEnabled = true;
    createNote('Alpha.md', '---\nheading: The Real Name\n---\n');
    await load();

    expect(component.nameIndex.getPathsByName('the real name')).toEqual([]);

    settings.titlePropertyNames = ['title', 'heading'];
    triggerSaveSettings();

    expect(component.nameIndex.getPathsByName('the real name')).toEqual(['Alpha.md']);
  });

  it('should drop the memoized suggestions when the titles-in-autocomplete setting is flipped, without rebuilding', async () => {
    settings.isTitlesModuleEnabled = true;
    createNote('Alpha.md', '---\ntitle: The Real Name\n---\n');
    await load();

    // The component was constructed before the Titles module was switched on, so its first save is
    // the one that notices the title properties and rebuilds. What this case is about is the flip
    // AFTER that, which must cost nothing.
    triggerSaveSettings();
    const buildAll = vi.spyOn(component.nameIndex, 'buildAll');

    expect(component.nameIndex.getSuggestions()).toHaveLength(1);

    settings.shouldOfferTitlesInLinkSuggestions = true;
    triggerSaveSettings();

    // A memo drop, not a vault walk: no file's names moved, only which of two known halves is served.
    expect(buildAll).not.toHaveBeenCalled();
    expect(component.nameIndex.getSuggestions()).toEqual([
      { file: expect.anything() as unknown, path: 'Alpha' },
      { alias: 'The Real Name', file: expect.anything() as unknown, path: 'Alpha' }
    ]);

    settings.shouldOfferTitlesInLinkSuggestions = false;
    triggerSaveSettings();

    expect(component.nameIndex.getSuggestions()).toHaveLength(1);
    expect(buildAll).not.toHaveBeenCalled();
  });

  it('should leave the index alone when the saved settings changed nothing it reads', async () => {
    createNote('Alpha.md');
    await load();
    const buildAll = vi.spyOn(component.nameIndex, 'buildAll');

    settings.shouldShowProgressBarOnLoad = false;
    triggerSaveSettings();

    expect(buildAll).not.toHaveBeenCalled();
  });

  it('should not hear a settings change before the index is built, so no rebuild can race the build', () => {
    component.load();
    const buildAll = vi.spyOn(component.nameIndex, 'buildAll');

    settings.isTitlesModuleEnabled = true;
    triggerSaveSettings();

    expect(buildAll).not.toHaveBeenCalled();
    expect(component.isBuilt).toBe(false);
  });

  it('should stop listening for settings changes when unloaded', async () => {
    await load();
    component.unload();

    expect(offref).toHaveBeenCalledOnce();
  });

  function createFolder(path: string): TFolder {
    return app.vault.createFolderSync__(path);
  }

  function createNote(path: string, content = ''): TFile {
    return app.vault.createSync__(path, content);
  }

  /**
   * Loads the component and lets its layout-ready work finish.
   *
   * `LayoutReadyComponent` hands `onLayoutReady` to a `setTimeout(0)` and then to
   * `invokeAsyncSafely`, so a bare `await loadWithPromises()` returns before the index exists.
   *
   * @returns A {@link Promise} that resolves once the component has finished loading.
   */
  async function load(): Promise<void> {
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);
    await waitForAllAsyncOperations();
  }

  /**
   * Moves a folder and its files in the mocked vault WITHOUT firing any event, so the test decides
   * which events the component gets to see.
   *
   * @param oldPath - The folder's path today.
   * @param newPath - Where it moves to.
   * @returns The moved folder.
   */
  function renameFolderInVault(oldPath: string, newPath: string): TFolder {
    const movedFiles = app.vault.getFiles().filter((file) => file.path.startsWith(`${oldPath}/`));

    for (const movedFile of movedFiles) {
      app.vault.deleteVaultAbstractFile__(movedFile.path);
    }

    app.vault.deleteVaultAbstractFile__(oldPath);
    const folder = app.vault.createFolderSync__(newPath);

    for (const movedFile of movedFiles) {
      app.vault.createSync__(`${newPath}/${movedFile.name}`, app.vault.readSync__(movedFile));
    }

    return folder;
  }
});
