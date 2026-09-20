import type {
  App as AppOriginal,
  TFile as TFileOriginal
} from 'obsidian';
import type { TFile } from 'obsidian-test-mocks/obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsComponent } from '../../plugin-settings-component.ts';

import { PluginSettings } from '../../plugin-settings.ts';
import { TitleIndex } from './title-index.ts';

describe('TitleIndex', () => {
  let app: App;
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
  });

  describe('getTitlePropertyNames', () => {
    it('should answer with the configured properties', () => {
      settings.titlePropertyNames = ['title', 'heading'];

      expect(titleIndex.getTitlePropertyNames()).toEqual(['title', 'heading']);
    });

    it('should answer with nothing while the module is off', () => {
      settings.isTitlesModuleEnabled = false;

      expect(titleIndex.getTitlePropertyNames()).toEqual([]);
    });

    it('should drop the blanks and the repeats a free-text list collects', () => {
      settings.titlePropertyNames = ['title', '  ', ' heading ', 'title', ''];

      expect(titleIndex.getTitlePropertyNames()).toEqual(['title', 'heading']);
    });
  });

  describe('getTitles', () => {
    it('should read the configured property', () => {
      const file = createNote('Alpha.md', '---\ntitle: The Real Name\n---\n');

      expect(readTitles(file)).toEqual(['The Real Name']);
    });

    it('should answer with nothing while the module is off', () => {
      const file = createNote('Alpha.md', '---\ntitle: The Real Name\n---\n');
      settings.isTitlesModuleEnabled = false;

      expect(readTitles(file)).toEqual([]);
    });

    it('should answer with nothing when no property is configured', () => {
      const file = createNote('Alpha.md', '---\ntitle: The Real Name\n---\n');
      settings.titlePropertyNames = [];

      expect(readTitles(file)).toEqual([]);
    });

    it('should answer with nothing for a note carrying no frontmatter at all', () => {
      const file = createNote('Alpha.md');

      expect(readTitles(file)).toEqual([]);
    });

    it('should answer with nothing for a note whose frontmatter lacks the property', () => {
      const file = createNote('Alpha.md', '---\nauthor: Someone\n---\n');

      expect(readTitles(file)).toEqual([]);
    });

    it('should read every configured property, in the order they were typed', () => {
      settings.titlePropertyNames = ['heading', 'title'];
      const file = createNote('Alpha.md', '---\ntitle: Second\nheading: First\n---\n');

      expect(readTitles(file)).toEqual(['First', 'Second']);
    });

    it('should read a list-valued property as several titles', () => {
      const file = createNote('Alpha.md', '---\ntitle:\n  - One\n  - Two\n---\n');

      expect(readTitles(file)).toEqual(['One', 'Two']);
    });

    it('should take an unquoted number as the text the user typed', () => {
      const file = createNote('Alpha.md', '---\ntitle: 2026\n---\n');

      expect(readTitles(file)).toEqual(['2026']);
    });

    it('should leave a value that is not a name anybody typed', () => {
      settings.titlePropertyNames = ['title', 'flag', 'nested', 'blank'];
      const file = createNote('Alpha.md', '---\ntitle: Kept\nflag: true\nnested:\n  key: value\nblank: "   "\n---\n');

      expect(readTitles(file)).toEqual(['Kept']);
    });

    it('should trim a title, and drop a repeat of one already read', () => {
      settings.titlePropertyNames = ['title', 'heading'];
      const file = createNote('Alpha.md', '---\ntitle: "  Same Name  "\nheading: SAME NAME\n---\n');

      expect(readTitles(file)).toEqual(['Same Name']);
    });

    it('should answer from the memo until something invalidates it', async () => {
      const file = createNote('Alpha.md', '---\ntitle: Before\n---\n');
      expect(readTitles(file)).toEqual(['Before']);

      await app.vault.modify(file, '---\ntitle: After\n---\n');
      expect(readTitles(file)).toEqual(['Before']);

      titleIndex.invalidate(file.path);
      expect(readTitles(file)).toEqual(['After']);
    });

    it('should drop the memo when the configured properties change', async () => {
      const file = createNote('Alpha.md', '---\ntitle: Before\n---\n');
      expect(readTitles(file)).toEqual(['Before']);

      await app.vault.modify(file, '---\ntitle: After\n---\n');
      settings.titlePropertyNames = ['title', 'heading'];

      expect(readTitles(file)).toEqual(['After']);
    });
  });

  describe('maintenance', () => {
    it('should forget a whole subtree, and only that subtree', async () => {
      const inside = createNote('Folder/Inside.md', '---\ntitle: Before\n---\n');
      const outside = createNote('Folder Sibling/Outside.md', '---\ntitle: Before\n---\n');
      expect(readTitles(inside)).toEqual(['Before']);
      expect(readTitles(outside)).toEqual(['Before']);

      await app.vault.modify(inside, '---\ntitle: After\n---\n');
      await app.vault.modify(outside, '---\ntitle: After\n---\n');
      titleIndex.invalidateSubtree('Folder');

      expect(readTitles(inside)).toEqual(['After']);
      expect(readTitles(outside)).toEqual(['Before']);
    });

    it('should forget everything when cleared', async () => {
      const file = createNote('Alpha.md', '---\ntitle: Before\n---\n');
      expect(readTitles(file)).toEqual(['Before']);

      await app.vault.modify(file, '---\ntitle: After\n---\n');
      titleIndex.clear();

      expect(readTitles(file)).toEqual(['After']);
    });

    it('should ignore the invalidation of a path it never knew', () => {
      const file = createNote('Alpha.md', '---\ntitle: Kept\n---\n');
      expect(readTitles(file)).toEqual(['Kept']);

      titleIndex.invalidate('Never/Read.md');

      expect(readTitles(file)).toEqual(['Kept']);
    });
  });

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
