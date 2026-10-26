import type { App as AppOriginal } from 'obsidian';

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
  PropertyValueIndex,
  readPropertyValues
} from './property-value-index.ts';

const DATA_FILE_PATH = 'property-values.json';

describe('readPropertyValues', () => {
  it.each([
    ['a string', 'a', ['a']],
    ['a number, in its string form', 7, ['7']],
    ['a boolean, in its string form', true, ['true']],
    ['a list, member by member, without repeats', ['a', 7, 'a'], ['a', '7']],
    ['null, as no value', null, []],
    ['an object, as no value', { a: 1 }, []],
    ['list members that are neither, as no value', [null, { a: 1 }, ['b']], []]
  ])('should read %s', (_description, value, expected) => {
    expect(readPropertyValues({ keys: value }, 'keys')).toEqual(expected);
  });

  it('should answer null for a note that does not carry the property, matched exactly', () => {
    expect(readPropertyValues(undefined, 'keys')).toBeNull();
    expect(readPropertyValues({ Keys: 'a' }, 'keys')).toBeNull();
  });
});

describe('PropertyValueIndex', () => {
  let app: App;
  let index: PropertyValueIndex;
  let settings: PluginSettings;

  beforeEach(() => {
    app = App.createConfigured__();
    settings = new PluginSettings();
    index = new PropertyValueIndex({
      app: castTo<AppOriginal>(app),
      getDataFilePath: (): string => DATA_FILE_PATH,
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings })
    });
  });

  it('should list the values of the date properties that are not dates, in order, and null while the module is off', () => {
    // The mocks have no `metadataTypeManager`; `due` is a date property by its type, the others by their name.
    castTo<Record<'metadataTypeManager', unknown>>(app).metadataTypeManager = {
      getAssignedWidget: (propertyName: string): null | string => propertyName === 'due' ? 'date' : null
    };
    for (const propertyName of ['due', 'startDate', 'date', 'keys']) {
      index.register(propertyName);
    }
    index.refresh({ frontmatter: { date: ['soon', '2026-10-26', 'later'], due: '14:30', keys: 'abc', startDate: 'never' }, path: 'Beta.md' });
    index.refresh({ frontmatter: { due: 'tomorrow' }, path: 'Alpha.md' });

    expect(index.getNonDateValues()).toEqual([
      { path: 'Alpha.md', propertyName: 'due', value: 'tomorrow' },
      { path: 'Beta.md', propertyName: 'date', value: 'later' },
      { path: 'Beta.md', propertyName: 'date', value: 'soon' },
      { path: 'Beta.md', propertyName: 'due', value: '14:30' },
      { path: 'Beta.md', propertyName: 'startDate', value: 'never' }
    ]);

    settings.isPropertiesModuleEnabled = false;
    expect(index.getNonDateValues()).toBeNull();
  });

  it('should answer null for a property nobody registered', () => {
    expect(index.getPathsByPropertyValue('keys', 'a')).toBeNull();
    expect(index.getPathsWithProperty('keys')).toBeNull();
  });

  it('should answer by value and by presence for a registered property only', () => {
    index.register('keys');
    index.refresh({ frontmatter: { keys: ['a', 'b'], other: 'a' }, path: 'Alpha.md' });
    index.refresh({ frontmatter: { keys: 'b' }, path: 'Beta.md' });
    index.refresh({ frontmatter: { keys: null }, path: 'Gamma.md' });
    index.refresh({ frontmatter: { other: 'a' }, path: 'Delta.md' });

    expect(index.getPathsByPropertyValue('keys', 'a')).toEqual(['Alpha.md']);
    expect(index.getPathsByPropertyValue('keys', 'b')).toEqual(['Alpha.md', 'Beta.md']);
    expect(index.getPathsByPropertyValue('keys', 'c')).toEqual([]);
    expect(index.getPathsWithProperty('keys')).toEqual(['Alpha.md', 'Beta.md', 'Gamma.md']);
    expect(index.getPathsWithProperty('other')).toBeNull();
  });

  it('should answer null while the module is off', () => {
    index.register('keys');
    settings.isPropertiesModuleEnabled = false;

    expect(index.getPathsByPropertyValue('keys', 'a')).toBeNull();
    expect(index.getPathsWithProperty('keys')).toBeNull();
  });

  it('should drop a value a note no longer holds, and the note once it no longer carries the property', () => {
    index.register('keys');
    index.refresh({ frontmatter: { keys: ['a', 'b'] }, path: 'Alpha.md' });
    index.refresh({ frontmatter: { keys: ['b'] }, path: 'Alpha.md' });

    expect(index.getPathsByPropertyValue('keys', 'a')).toEqual([]);
    expect(index.getPathsByPropertyValue('keys', 'b')).toEqual(['Alpha.md']);

    index.refresh({ frontmatter: undefined, path: 'Alpha.md' });

    expect(index.getPathsWithProperty('keys')).toEqual([]);
    expect(index.getPathsByPropertyValue('keys', 'b')).toEqual([]);
  });

  it('should become dirty only on a real change', async () => {
    expect(index.register('keys')).toBe(true);
    expect(index.isDirty).toBe(true);
    await index.save();

    expect(index.register('keys')).toBe(false);
    index.refresh({ frontmatter: undefined, path: 'Alpha.md' });
    expect(index.isDirty).toBe(false);

    index.refresh({ frontmatter: { keys: 'a' }, path: 'Alpha.md' });
    expect(index.isDirty).toBe(true);
    await index.save();

    index.refresh({ frontmatter: { keys: 'a' }, path: 'Alpha.md' });
    index.delete('Beta.md');
    index.rename('Beta.md', 'Gamma.md');
    expect(index.isDirty).toBe(false);
  });

  it('should forget deleted notes and folders, and the notes not retained', () => {
    index.register('keys');

    for (const path of ['Alpha.md', 'Folder/Beta.md', 'Folder/Sub/Gamma.md', 'Folder2.md', 'Delta.md']) {
      index.refresh({ frontmatter: { keys: 'a' }, path });
    }

    index.delete('Alpha.md');
    index.deleteSubtree('Folder');
    expect(index.getPathsWithProperty('keys')).toEqual(['Folder2.md', 'Delta.md']);

    index.retain(new Set(['Delta.md']));
    expect(index.getPathsByPropertyValue('keys', 'a')).toEqual(['Delta.md']);
  });

  it('should move renamed notes and folders with their values', () => {
    index.register('keys');
    index.refresh({ frontmatter: { keys: 'a' }, path: 'Alpha.md' });
    index.refresh({ frontmatter: { keys: 'b' }, path: 'Folder/Beta.md' });

    index.rename('Alpha.md', 'Renamed.md');
    index.renameSubtree('Folder', 'Moved');

    expect(index.getPathsByPropertyValue('keys', 'a')).toEqual(['Renamed.md']);
    expect(index.getPathsByPropertyValue('keys', 'b')).toEqual(['Moved/Beta.md']);
  });

  it('should save and load the registered names and the values, keeping names registered meanwhile', async () => {
    index.register('keys');
    index.refresh({ frontmatter: { keys: ['a'] }, path: 'Alpha.md' });
    const savePromise = index.save();
    index.clear();
    await savePromise;

    expect(index.getPathsWithProperty('keys')).toEqual([]);

    index.register('other');
    await index.load();

    expect(index.isDirty).toBe(false);
    expect(index.getPropertyNames()).toEqual(['keys', 'other']);
    expect(index.getPathsByPropertyValue('keys', 'a')).toEqual(['Alpha.md']);
  });

  it('should load an empty index when there is no file', async () => {
    index.register('keys');
    index.refresh({ frontmatter: { keys: 'a' }, path: 'Alpha.md' });
    await index.load();

    expect(index.getPathsWithProperty('keys')).toEqual([]);
  });

  it.each([
    ['not JSON', '{'],
    ['another version', JSON.stringify({ properties: {}, version: 2 })],
    ['properties that are not an object', JSON.stringify({ properties: null, version: 1 })]
  ])('should load an empty index from a file that is %s', async (_description, json) => {
    await app.vault.adapter.write(DATA_FILE_PATH, json);
    await index.load();

    expect(index.getPropertyNames()).toEqual([]);
  });

  it('should drop the malformed entries of a file and keep the rest', async () => {
    await app.vault.adapter.write(
      DATA_FILE_PATH,
      JSON.stringify({
        properties: {
          broken: ['a'],
          keys: { 'Alpha.md': ['a'], 'Beta.md': [1], 'Gamma.md': 'a' }
        },
        version: 1
      })
    );
    await index.load();

    expect(index.getPropertyNames()).toEqual(['keys']);
    expect(index.getPathsWithProperty('keys')).toEqual(['Alpha.md']);
  });

  describe('getDatedValues', () => {
    it('should list the date-shaped values of every registered property, list members included, in order', () => {
      index.register('birthday');
      index.register('due');
      index.refresh({ frontmatter: { birthday: '1990-10-26', due: ['2026-11-01', 'soon', 7] }, path: 'Alpha.md' });
      index.refresh({ frontmatter: { birthday: '1985-10-27', other: '2026-01-01' }, path: 'Beta.md' });

      expect(index.getDatedValues({})).toEqual([
        { path: 'Beta.md', propertyName: 'birthday', value: '1985-10-27' },
        { path: 'Alpha.md', propertyName: 'birthday', value: '1990-10-26' },
        { path: 'Alpha.md', propertyName: 'due', value: '2026-11-01' }
      ]);
      expect(index.getDatedValues({ from: '10-26', isRecurring: true, propertyNames: ['birthday'], to: '10-26' })).toEqual([
        { path: 'Alpha.md', propertyName: 'birthday', value: '1990-10-26' }
      ]);
    });

    it('should answer null for a property nobody registered, and while the module is off', () => {
      index.register('birthday');

      expect(index.getDatedValues({ propertyNames: ['birthday'] })).toEqual([]);
      expect(index.getDatedValues({ propertyNames: ['birthday', 'other'] })).toBeNull();

      settings.isPropertiesModuleEnabled = false;

      expect(index.getDatedValues({})).toBeNull();
    });

    it('should follow changes, deletions and renames, and forget everything on clear, and come back on load', async () => {
      index.register('due');
      index.refresh({ frontmatter: { due: '2026-10-26' }, path: 'Alpha.md' });
      index.refresh({ frontmatter: { due: '2026-10-27' }, path: 'Folder/Beta.md' });
      index.refresh({ frontmatter: { due: '2026-10-28' }, path: 'Alpha.md' });
      index.rename('Alpha.md', 'Renamed.md');
      index.renameSubtree('Folder', 'Moved');

      expect(index.getDatedValues({})).toEqual([
        { path: 'Moved/Beta.md', propertyName: 'due', value: '2026-10-27' },
        { path: 'Renamed.md', propertyName: 'due', value: '2026-10-28' }
      ]);

      index.delete('Renamed.md');
      await index.save();
      index.clear();

      expect(index.getDatedValues({})).toEqual([]);

      await index.load();

      expect(index.getDatedValues({ isRecurring: true })).toEqual([{ path: 'Moved/Beta.md', propertyName: 'due', value: '2026-10-27' }]);
    });
  });
});
