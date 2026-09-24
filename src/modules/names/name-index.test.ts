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
import { TitleIndex } from '../titles/title-index.ts';
import {
  NameIndex,
  normalizeName
} from './name-index.ts';

describe('NameIndex', () => {
  let app: App;
  let nameIndex: NameIndex;
  let settings: PluginSettings;

  beforeEach(() => {
    app = App.createConfigured__();
    // `getLinkSuggestions` asks `isSupportedFile` per file, and so does the index. That asks the view registry,
    // which holds only the Markdown view until Obsidian's canvas and image views claim their extensions at startup.
    app.viewRegistry.registerExtensions(['canvas'], 'canvas');
    app.viewRegistry.registerExtensions(['png'], 'image');
    settings = new PluginSettings();

    const pluginSettingsComponent = strictProxy<PluginSettingsComponent>({ settings });
    const titleIndex = new TitleIndex({
      app: castTo<AppOriginal>(app),
      pluginSettingsComponent
    });

    nameIndex = new NameIndex({ app: castTo<AppOriginal>(app), pluginSettingsComponent, titleIndex });
  });

  describe('normalizeName', () => {
    it('should lowercase and collapse runs of whitespace', () => {
      expect(normalizeName('Some  Alias')).toBe('some alias');
      expect(normalizeName('already fine')).toBe('already fine');
    });
  });

  describe('getPathsByName', () => {
    it('should answer with a note basename, whatever the casing and spacing', () => {
      createNote('Notes/Meeting  Note.md');
      nameIndex.buildAll();

      expect(nameIndex.getPathsByName('meeting note')).toEqual(['Notes/Meeting  Note.md']);
      expect(nameIndex.getPathsByName('MEETING   NOTE')).toEqual(['Notes/Meeting  Note.md']);
    });

    it('should answer with frontmatter aliases as well as the basename', () => {
      createNote('Notes/Alpha.md', '---\naliases:\n  - First\n  - Second One\n---\n');
      nameIndex.buildAll();

      expect(nameIndex.getPathsByName('alpha')).toEqual(['Notes/Alpha.md']);
      expect(nameIndex.getPathsByName('first')).toEqual(['Notes/Alpha.md']);
      expect(nameIndex.getPathsByName('second one')).toEqual(['Notes/Alpha.md']);
    });

    it('should list EVERY note carrying a shared name, unranked', () => {
      createNote('One.md', '---\naliases:\n  - Shared\n---\n');
      createNote('Two.md', '---\naliases:\n  - shared\n---\n');
      nameIndex.buildAll();

      expect([...nameIndex.getPathsByName('Shared')].sort()).toEqual(['One.md', 'Two.md']);
    });

    it('should answer with nothing for a name no note carries', () => {
      createNote('One.md');
      nameIndex.buildAll();

      expect(nameIndex.getPathsByName('absent')).toEqual([]);
    });

    it('should keep an attachment reachable by its full name, extension included', () => {
      createNote('Attachments/image.png', '');
      nameIndex.buildAll();

      expect(nameIndex.getPathsByName('image.png')).toEqual(['Attachments/image.png']);
    });

    it('should answer with a title while the Titles module is on, and not while it is off', () => {
      createNote('Notes/Alpha.md', '---\ntitle: The Real Name\n---\n');
      nameIndex.buildAll();

      expect(nameIndex.getPathsByName('the real name')).toEqual([]);

      settings.isTitlesModuleEnabled = true;
      nameIndex.buildAll();

      expect(nameIndex.getPathsByName('the real name')).toEqual(['Notes/Alpha.md']);
      expect(nameIndex.getPathsByName('alpha')).toEqual(['Notes/Alpha.md']);
    });

    it('should forget the OLD title of a refreshed file', async () => {
      settings.isTitlesModuleEnabled = true;
      const file = createNote('Alpha.md', '---\ntitle: Before\n---\n');
      nameIndex.buildAll();
      await app.vault.modify(file, '---\ntitle: After\n---\n');

      nameIndex.refresh(castTo<TFileOriginal>(file));

      expect(nameIndex.getPathsByName('before')).toEqual([]);
      expect(nameIndex.getPathsByName('after')).toEqual(['Alpha.md']);
    });
  });

  describe('getSuggestions', () => {
    it('should offer one entry per file plus one per alias', () => {
      createNote('Alpha.md', '---\naliases:\n  - First\n---\n');
      createNote('Beta.md');
      nameIndex.buildAll();

      expect(nameIndex.getSuggestions()).toEqual([
        { file: expect.anything() as unknown, path: 'Alpha' },
        { alias: 'First', file: expect.anything() as unknown, path: 'Alpha' },
        { file: expect.anything() as unknown, path: 'Beta' }
      ]);
    });

    it('should leave an unsupported file out entirely, as Obsidian does', () => {
      createNote('Notes/notes.zip', 'binary');
      createNote('Notes/Alpha.md');
      nameIndex.buildAll();

      expect(nameIndex.getSuggestions().map((suggestion) => suggestion.path)).toEqual(['Notes/Alpha']);
      expect(nameIndex.getPathsByName('notes.zip')).toEqual([]);
    });

    it('should hand back a fresh array each time, so a caller may sort it', () => {
      createNote('Alpha.md');
      nameIndex.buildAll();

      const first = nameIndex.getSuggestions();
      first.length = 0;

      expect(nameIndex.getSuggestions()).toHaveLength(1);
    });

    it('should offer an unresolved link text that no file already answers to', () => {
      createNote('Alpha.md', 'See [[Not Yet Written]].');
      nameIndex.buildAll();

      expect(nameIndex.getSuggestions()).toContainEqual({ file: null, path: 'Not Yet Written' });
    });

    it('should not offer an unresolved link text twice, nor one an existing note already answers to', () => {
      createNote('Alpha.md', 'See [[Not Yet Written]].');
      createNote('Beta.md', 'Also see [[Not Yet Written]], and [[Alpha]].');
      nameIndex.buildAll();

      const unresolvedEntries = nameIndex.getSuggestions().filter((suggestion) => suggestion.file === null);
      expect(unresolvedEntries).toEqual([{ file: null, path: 'Not Yet Written' }]);
    });

    it('should truncate an unresolved link text the way Obsidian does', () => {
      const longLinkText = 'x'.repeat(600);
      createNote('Alpha.md', `See [[${longLinkText}]].`);
      nameIndex.buildAll();

      const unresolvedEntry = nameIndex.getSuggestions().find((suggestion) => suggestion.file === null);
      expect(unresolvedEntry?.path).toHaveLength(500);
    });

    it('should index a file the events never reached, so the answer is never short', () => {
      createNote('Alpha.md');
      nameIndex.buildAll();
      createNote('Late.md');

      expect(nameIndex.getSuggestions().map((suggestion) => suggestion.path)).toEqual(['Alpha', 'Late']);
      expect(nameIndex.getPathsByName('late')).toEqual(['Late.md']);
    });

    it('should leave a title out of the array while the setting is off, even with the Titles module on', () => {
      settings.isTitlesModuleEnabled = true;
      createNote('Alpha.md', '---\ntitle: The Real Name\n---\n');
      nameIndex.buildAll();

      // The name is there; the ENTRY is not. That split is the whole point of the setting.
      expect(nameIndex.getPathsByName('the real name')).toEqual(['Alpha.md']);
      expect(nameIndex.getSuggestions()).toEqual([{ file: expect.anything() as unknown, path: 'Alpha' }]);
    });

    it('should offer a title as an aliased entry at the note display path while the setting is on', () => {
      settings.isTitlesModuleEnabled = true;
      settings.shouldOfferTitlesInLinkSuggestions = true;
      createNote('Notes/Alpha.md', '---\ntitle: The Real Name\n---\n');
      nameIndex.buildAll();

      // `{ alias, path }` is what makes Obsidian write `[[Notes/Alpha|The Real Name]]`, which resolves
      // without this plugin.
      expect(nameIndex.getSuggestions()).toEqual([
        { file: expect.anything() as unknown, path: 'Notes/Alpha' },
        { alias: 'The Real Name', file: expect.anything() as unknown, path: 'Notes/Alpha' }
      ]);
    });

    it('should append every title entry AFTER the whole array Obsidian would have built', () => {
      settings.isTitlesModuleEnabled = true;
      createNote('Alpha.md', '---\ntitle: Alpha Real Name\naliases:\n  - First\n---\nSee [[Not Yet Written]].');
      createNote('Beta.md', '---\ntitle: Beta Real Name\n---\n');
      nameIndex.buildAll();

      const withoutTitles = nameIndex.getSuggestions();

      settings.shouldOfferTitlesInLinkSuggestions = true;
      nameIndex.invalidateSuggestions();
      const withTitles = nameIndex.getSuggestions();

      // Obsidian's own array stays a strict PREFIX, unresolved-link entries and all, so the two
      // answers differ by a suffix and by nothing else.
      expect(withTitles.slice(0, withoutTitles.length)).toEqual(withoutTitles);
      expect(withTitles.slice(withoutTitles.length)).toEqual([
        { alias: 'Alpha Real Name', file: expect.anything() as unknown, path: 'Alpha' },
        { alias: 'Beta Real Name', file: expect.anything() as unknown, path: 'Beta' }
      ]);
    });

    it('should not offer a title the note already answers to under its own name or an alias', () => {
      settings.isTitlesModuleEnabled = true;
      settings.shouldOfferTitlesInLinkSuggestions = true;
      createNote('Alpha.md', '---\ntitle: alpha\n---\n');
      createNote('Beta.md', '---\ntitle: First\naliases:\n  - first\n---\n');
      nameIndex.buildAll();

      // Offering either would be the same note under the same text, twice.
      expect(nameIndex.getSuggestions()).toEqual([
        { file: expect.anything() as unknown, path: 'Alpha' },
        { file: expect.anything() as unknown, path: 'Beta' },
        { alias: 'first', file: expect.anything() as unknown, path: 'Beta' }
      ]);
    });

    it('should offer nothing extra while the Titles module is off, whatever the setting says', () => {
      settings.shouldOfferTitlesInLinkSuggestions = true;
      createNote('Alpha.md', '---\ntitle: The Real Name\n---\n');
      nameIndex.buildAll();

      expect(nameIndex.getSuggestions()).toEqual([{ file: expect.anything() as unknown, path: 'Alpha' }]);
    });

    it('should answer from the memo until something invalidates it', () => {
      createNote('Alpha.md');
      nameIndex.buildAll();
      const before = nameIndex.getSuggestions();

      // Reaching past the index, so nothing invalidates the memo: the answer must not move.
      app.metadataCache.unresolvedLinks['Alpha.md'] = { 'Not Yet Written': 1 };
      expect(nameIndex.getSuggestions()).toEqual(before);

      nameIndex.invalidateSuggestions();
      expect(nameIndex.getSuggestions()).toContainEqual({ file: null, path: 'Not Yet Written' });
    });
  });

  describe('maintenance', () => {
    it('should drop a removed path from both maps', async () => {
      createNote('Alpha.md', '---\naliases:\n  - First\n---\n');
      nameIndex.buildAll();
      await app.fileManager.trashFile(getFile('Alpha.md'));

      nameIndex.remove('Alpha.md');

      expect(nameIndex.getPathsByName('alpha')).toEqual([]);
      expect(nameIndex.getPathsByName('first')).toEqual([]);
      expect(nameIndex.getSuggestions()).toEqual([]);
    });

    it('should leave a name another note still carries', () => {
      createNote('One.md', '---\naliases:\n  - Shared\n---\n');
      createNote('Two.md', '---\naliases:\n  - Shared\n---\n');
      nameIndex.buildAll();

      nameIndex.remove('One.md');

      expect(nameIndex.getPathsByName('shared')).toEqual(['Two.md']);
    });

    it('should ignore the removal of a path it never knew', () => {
      createNote('Alpha.md');
      nameIndex.buildAll();

      nameIndex.remove('Never/Indexed.md');

      expect(nameIndex.getPathsByName('alpha')).toEqual(['Alpha.md']);
    });

    it('should forget the OLD names of a refreshed file', async () => {
      const file = createNote('Alpha.md', '---\naliases:\n  - Before\n---\n');
      nameIndex.buildAll();
      await app.vault.modify(file, '---\naliases:\n  - After\n---\n');

      nameIndex.refresh(castTo<TFileOriginal>(file));

      expect(nameIndex.getPathsByName('before')).toEqual([]);
      expect(nameIndex.getPathsByName('after')).toEqual(['Alpha.md']);
    });

    it('should drop a whole subtree, and only that subtree', () => {
      createNote('Folder/Inside.md');
      createNote('Folder Sibling/Outside.md');
      nameIndex.buildAll();

      nameIndex.removeSubtree('Folder');

      expect(nameIndex.getPathsByName('inside')).toEqual([]);
      expect(nameIndex.getPathsByName('outside')).toEqual(['Folder Sibling/Outside.md']);
    });

    it('should forget everything when cleared', () => {
      createNote('Alpha.md');
      nameIndex.buildAll();

      nameIndex.clear();

      expect(nameIndex.getPathsByName('alpha')).toEqual([]);
    });

    it('should record a note aliased with its own name once', () => {
      createNote('Alpha.md', '---\naliases:\n  - alpha\n---\n');
      nameIndex.buildAll();

      nameIndex.remove('Alpha.md');

      expect(nameIndex.getPathsByName('alpha')).toEqual([]);
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

  function getFile(path: string): TFile {
    return castTo<TFile>(app.vault.getFileByPath(path));
  }
});
