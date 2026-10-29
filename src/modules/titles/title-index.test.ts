import type {
  App as AppOriginal,
  TFile as TFileOriginal
} from 'obsidian';
import type { TFile } from 'obsidian-test-mocks/obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsComponent } from '../../plugin-settings-component.ts';

import { PluginSettings } from '../../plugin-settings.ts';
import {
  parseNamePatterns,
  TitleIndex
} from './title-index.ts';

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

  describe('name patterns', () => {
    beforeEach(() => {
      settings.titlePropertyNames = [];
    });

    it('should drop the blanks and the repeats a free-text list collects', () => {
      settings.titleNamePatterns = [[' lastName ', '', 'firstName'], [], ['  '], ['lastName', 'firstName']];

      expect(titleIndex.getTitleNamePatterns()).toEqual([['lastName', 'firstName']]);
    });

    it('should answer with no patterns while the module is off', () => {
      settings.titleNamePatterns = [['lastName', 'firstName']];
      settings.isTitlesModuleEnabled = false;

      expect(titleIndex.getTitleNamePatterns()).toEqual([]);
    });

    it('should parse a settings line into a pattern', () => {
      expect(parseNamePatterns(['lastName, firstName , middleName', '', ' , ', 'firstName'])).toEqual([
        ['lastName', 'firstName', 'middleName'],
        ['firstName']
      ]);
    });

    it('should join plain parts with a space, skipping a missing one', () => {
      settings.titleNamePatterns = [['lastName', 'firstName', 'middleName'], ['firstName', 'lastName']];
      const file = createNote('Smith John.md', '---\nlastName: Smith\nfirstName: John\n---\n');

      expect(readTitles(file)).toEqual(['Smith John', 'John Smith']);
    });

    it('should follow the title properties, and drop a built name equal to a title', () => {
      settings.titlePropertyNames = ['title'];
      settings.titleNamePatterns = [['lastName', 'firstName'], ['firstName', 'lastName']];
      const file = createNote('Smith John.md', '---\ntitle: smith john\nlastName: Smith\nfirstName: John\n---\n');

      expect(readTitles(file)).toEqual(['smith john', 'John Smith']);
    });

    it('should multiply the forms of a list-valued part', () => {
      settings.titleNamePatterns = [['firstName', 'lastName']];
      const file = createNote('Smith Alex.md', '---\nlastName: Smith\nfirstName: [Alexander, Alex]\n---\n');

      expect(readTitles(file)).toEqual(['Alexander Smith', 'Alex Smith']);
    });

    it('should build once per language, never mixing two', () => {
      settings.titleNamePatterns = [['lastName', 'firstName', 'middleName'], ['firstName', 'lastName']];
      const file = createNote('Naumov Michael.md', [
        '---',
        'lastName: {Наумов: [ru, uk], Naumov: [en]}',
        'firstName: {Михайло: [uk], Михаил: [ru], Mykhailo: [en], Michael: [en]}',
        'middleName: {Євгенович: [uk], Евгеньевич: [ru]}',
        '---',
        ''
      ].join('\n'));

      expect(readTitles(file)).toEqual([
        'Наумов Михаил Евгеньевич',
        'Наумов Михайло Євгенович',
        'Naumov Mykhailo',
        'Naumov Michael',
        'Михайло Наумов',
        'Михаил Наумов',
        'Mykhailo Naumov',
        'Michael Naumov'
      ]);
    });

    it('should give a plain part to every language', () => {
      settings.titleNamePatterns = [['lastName', 'firstName']];
      const file = createNote('Maizlish Alex.md', '---\nlastName: Maizlish\nfirstName: {Oleksandr: en, Олександр: [uk]}\n---\n');

      expect(readTitles(file)).toEqual(['Maizlish Oleksandr', 'Maizlish Олександр']);
    });

    it('should skip a part with nothing in a language rather than borrow another language', () => {
      settings.titleNamePatterns = [['lastName', 'firstName']];
      const file = createNote('Maizlish Alex.md', '---\nlastName: {Майзліш: [uk]}\nfirstName: {Alex: [en]}\n---\n');

      expect(readTitles(file)).toEqual(['Майзліш', 'Alex']);
    });

    it('should leave values that are not forms or languages', () => {
      settings.titleNamePatterns = [['lastName', 'firstName']];
      const file = createNote('Odd.md', '---\nlastName: {"  ": [en], Smith: [1, "  ", en]}\nfirstName: true\n---\n');

      expect(readTitles(file)).toEqual(['Smith']);
    });

    it('should build nothing for a note carrying none of the parts', () => {
      settings.titleNamePatterns = [['lastName', 'firstName']];
      const file = createNote('Alpha.md', '---\ntitle: Alpha\n---\n');

      expect(readTitles(file)).toEqual([]);
    });

    it('should drop the memo when the patterns change', () => {
      const file = createNote('Smith John.md', '---\nlastName: Smith\nfirstName: John\n---\n');
      settings.titleNamePatterns = [['lastName', 'firstName']];
      expect(readTitles(file)).toEqual(['Smith John']);

      settings.titleNamePatterns = [['firstName', 'lastName']];

      expect(readTitles(file)).toEqual(['John Smith']);
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
