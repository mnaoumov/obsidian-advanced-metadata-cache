import type {
  App as AppOriginal,
  TFile as TFileOriginal
} from 'obsidian';
import type {
  TFile,
  TFolder
} from 'obsidian-test-mocks/obsidian';

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
import { TitleIndexComponent } from './title-index-component.ts';
import { TitleIndex } from './title-index.ts';

describe('TitleIndexComponent', () => {
  let app: App;
  let component: TitleIndexComponent;
  let settings: PluginSettings;
  let titleIndex: TitleIndex;

  beforeEach(() => {
    app = App.createConfigured__();
    settings = new PluginSettings();
    settings.isTitlesModuleEnabled = true;

    titleIndex = new TitleIndex({
      app: castTo<AppOriginal>(app),
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings })
    });

    component = new TitleIndexComponent({ app: castTo<AppOriginal>(app), titleIndex });
  });

  it('should re-read a file whose metadata changed', async () => {
    const file = createNote('Alpha.md', '---\ntitle: Before\n---\n');
    component.load();
    expect(readTitles(file)).toEqual(['Before']);

    await app.vault.modify(file, '---\ntitle: After\n---\n');
    app.metadataCache.trigger('changed', file, '', castTo<never>({}));

    expect(readTitles(file)).toEqual(['After']);
  });

  it('should forget a created path, which a memo may already answer for as absent', () => {
    const invalidate = vi.spyOn(titleIndex, 'invalidate');
    component.load();

    app.vault.trigger('create', createNote('Alpha.md'));

    expect(invalidate).toHaveBeenCalledWith('Alpha.md');
  });

  it('should forget a deleted path', () => {
    const file = createNote('Alpha.md');
    component.load();
    const invalidate = vi.spyOn(titleIndex, 'invalidate');

    app.vault.trigger('delete', file);

    expect(invalidate).toHaveBeenCalledWith('Alpha.md');
  });

  it('should forget BOTH sides of a renamed file', async () => {
    const file = createNote('Alpha.md');
    component.load();
    const invalidate = vi.spyOn(titleIndex, 'invalidate');

    await app.fileManager.renameFile(file, 'Renamed.md');

    expect(invalidate).toHaveBeenCalledWith('Alpha.md');
    expect(invalidate).toHaveBeenCalledWith('Renamed.md');
  });

  it('should forget a whole subtree when a folder is renamed, on both sides', () => {
    const folder = createFolder('New');
    createNote('New/Inside.md');
    component.load();
    const invalidateSubtree = vi.spyOn(titleIndex, 'invalidateSubtree');

    app.vault.trigger('rename', folder, 'Old');

    expect(invalidateSubtree).toHaveBeenCalledWith('Old');
    expect(invalidateSubtree).toHaveBeenCalledWith('New');
  });

  it('should forget a whole subtree when a folder is deleted', () => {
    const folder = createFolder('Folder');
    createNote('Folder/Inside.md');
    component.load();
    const invalidateSubtree = vi.spyOn(titleIndex, 'invalidateSubtree');

    app.vault.trigger('delete', folder);

    expect(invalidateSubtree).toHaveBeenCalledWith('Folder');
  });

  it('should forget a whole subtree when a folder is created', () => {
    const folder = createFolder('Folder');
    component.load();
    const invalidateSubtree = vi.spyOn(titleIndex, 'invalidateSubtree');

    app.vault.trigger('create', folder);

    expect(invalidateSubtree).toHaveBeenCalledWith('Folder');
  });

  it('should clear at BOTH edges, because nothing invalidates the index while the module is off', async () => {
    const file = createNote('Alpha.md', '---\ntitle: Before\n---\n');
    component.load();
    expect(readTitles(file)).toEqual(['Before']);

    // The module goes off, so no event reaches the index and the change made in the meantime is one
    // nothing is left to replay.
    component.unload();
    await app.vault.modify(file, '---\ntitle: After\n---\n');
    component.load();

    expect(readTitles(file)).toEqual(['After']);
  });

  function createFolder(path: string): TFolder {
    return app.vault.createFolderSync__(path);
  }

  function createNote(path: string, content = ''): TFile {
    const lastSlashIndex = path.lastIndexOf('/');

    if (lastSlashIndex !== -1) {
      const folderPath = path.slice(0, lastSlashIndex);

      if (!app.vault.getFolderByPath(folderPath)) {
        app.vault.createFolderSync__(folderPath);
      }
    }

    return app.vault.createSync__(path, content);
  }

  function readTitles(file: TFile): readonly string[] {
    return titleIndex.getTitles(castTo<TFileOriginal>(file));
  }
});
