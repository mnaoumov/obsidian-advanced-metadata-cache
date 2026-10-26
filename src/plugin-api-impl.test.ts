import type {
  CustomArrayDict,
  LinkSuggestion
} from '@obsidian-typings/obsidian-public-latest';
import type {
  App as AppOriginal,
  PluginManifest,
  Reference,
  TFile
} from 'obsidian';

import {
  noop,
  noopAsync
} from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { BacklinkCacheComponent } from './modules/backlinks/backlink-cache-component.ts';
import type { NameIndexComponent } from './modules/names/name-index-component.ts';
import type { NameIndex } from './modules/names/name-index.ts';
import type { PropertyValueIndexComponent } from './modules/properties/property-value-index-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';
import type {
  ApprovedSettingsMigration,
  ShowSettingsMigrationModalParams
} from './settings-migration-modal.ts';

import { HeadingTimesIndex } from './modules/headings/heading-times-index.ts';
import { PropertyValueIndex } from './modules/properties/property-value-index.ts';
import { TitleIndex } from './modules/titles/title-index.ts';
import { PluginApiImpl } from './plugin-api-impl.ts';
import { PLUGIN_API_CONTRACT } from './plugin-api.ts';
import { PluginSettings } from './plugin-settings.ts';
import { showSettingsMigrationModal } from './settings-migration-modal.ts';

vi.mock('./settings-migration-modal.ts', () => ({
  showSettingsMigrationModal: vi.fn()
}));

interface BacklinksSource {
  getBacklinksForFile: (file: TFile) => CustomArrayDict<Reference>;
}

interface LinkSuggestionsSource {
  getLinkSuggestions: () => LinkSuggestion[];
}

const SOURCE_PLUGIN_ID = 'alias-quick-switcher';
const CACHED_BACKLINKS = castTo<CustomArrayDict<Reference>>({ source: 'cache' });
const CORE_BACKLINKS = castTo<CustomArrayDict<Reference>>({ source: 'core' });
const INDEXED_SUGGESTIONS: LinkSuggestion[] = [{ file: null, path: 'indexed' }];
const CORE_SUGGESTIONS: LinkSuggestion[] = [{ file: null, path: 'core' }];

describe('PluginApiImpl', () => {
  let app: App;
  let backlinkCacheComponent: BacklinkCacheComponent | null;
  let editAndSaveCallCount: number;
  let nameIndexComponent: NameIndexComponent | null;
  let pluginApi: PluginApiImpl;
  let propertyValueIndex: PropertyValueIndex;
  let propertyValueIndexComponent: null | PropertyValueIndexComponent;
  let settings: PluginSettings;

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    settings = new PluginSettings();
    settings.isTitlesModuleEnabled = true;
    editAndSaveCallCount = 0;
    backlinkCacheComponent = null;
    nameIndexComponent = null;
    propertyValueIndexComponent = null;

    const pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
      async editAndSave(settingsEditor: (settingsToEdit: PluginSettings) => Promise<void> | void): Promise<void> {
        editAndSaveCallCount++;
        await settingsEditor(settings);
      },
      settings
    });

    const titleIndex = new TitleIndex({
      app: castTo<AppOriginal>(app),
      pluginSettingsComponent
    });

    const headingTimesIndex = new HeadingTimesIndex({
      app: castTo<AppOriginal>(app),
      getDataFilePath: (): string => 'heading-times.json',
      pluginSettingsComponent
    });

    propertyValueIndex = new PropertyValueIndex({
      app: castTo<AppOriginal>(app),
      getDataFilePath: (): string => 'property-values.json',
      pluginSettingsComponent
    });

    pluginApi = new PluginApiImpl({
      app: castTo<AppOriginal>(app),
      getBacklinkCacheComponent: (): BacklinkCacheComponent | null => backlinkCacheComponent,
      getNameIndexComponent: (): NameIndexComponent | null => nameIndexComponent,
      getPropertyValueIndexComponent: (): null | PropertyValueIndexComponent => propertyValueIndexComponent,
      headingTimesIndex,
      pluginSettingsComponent,
      propertyValueIndex,
      titleIndex
    });
  });

  function approveAsShown(): void {
    vi.mocked(showSettingsMigrationModal).mockImplementation(
      (params: ShowSettingsMigrationModalParams): Promise<ApprovedSettingsMigration | null> =>
        Promise.resolve({
          shouldEnableTitlesModule: !params.isTitlesModuleEnabled,
          titlePropertyNames: [...params.mergedTitlePropertyNames]
        })
    );
  }

  it('should declare every method the contract names', () => {
    for (const methodName of Object.keys(PLUGIN_API_CONTRACT)) {
      expect(pluginApi).toHaveProperty(methodName, expect.any(Function));
    }
  });

  describe('backlinks', () => {
    it('should answer from the module cache, by path or by file', async () => {
      const getBacklinksForFileAsCore = vi.fn().mockReturnValue(CACHED_BACKLINKS);
      const getBacklinksForFileAsCoreSafe = vi.fn().mockResolvedValue(CACHED_BACKLINKS);
      const getBacklinksForFileOriginal = vi.fn().mockReturnValue(CORE_BACKLINKS);
      backlinkCacheComponent = strictProxy<BacklinkCacheComponent>({
        getBacklinksForFileAsCore,
        getBacklinksForFileAsCoreSafe,
        getBacklinksForFileOriginal
      });
      const file = castTo<TFile>({ path: 'Alpha.md' });

      expect(pluginApi.getBacklinksForFile('Alpha.md')).toBe(CACHED_BACKLINKS);
      await expect(pluginApi.getBacklinksForFileSafe(file)).resolves.toBe(CACHED_BACKLINKS);
      expect(pluginApi.getBacklinksForFileOriginal(file)).toBe(CORE_BACKLINKS);
      expect(getBacklinksForFileAsCore).toHaveBeenCalledWith('Alpha.md');
      expect(getBacklinksForFileAsCoreSafe).toHaveBeenCalledWith(file);
      expect(getBacklinksForFileOriginal).toHaveBeenCalledWith(file);
    });

    it('should answer null while the module is off, and the original from core', async () => {
      const getBacklinksForFile = vi.fn().mockReturnValue(CORE_BACKLINKS);
      castTo<BacklinksSource>(app.metadataCache).getBacklinksForFile = getBacklinksForFile;
      const file = castTo<TFile>({ path: 'Alpha.md' });

      expect(pluginApi.getBacklinksForFile('Alpha.md')).toBeNull();
      await expect(pluginApi.getBacklinksForFileSafe('Alpha.md')).resolves.toBeNull();
      expect(pluginApi.getBacklinksForFileOriginal(file)).toBe(CORE_BACKLINKS);
      expect(getBacklinksForFile).toHaveBeenCalledWith(file);
    });
  });

  describe('names', () => {
    it('should answer from the module index', async () => {
      const getPathsByName = vi.fn().mockReturnValue(['Indexed.md']);
      const getPathsByNameSafe = vi.fn().mockResolvedValue(['Safe.md']);
      nameIndexComponent = strictProxy<NameIndexComponent>({
        getLinkSuggestions: () => INDEXED_SUGGESTIONS,
        getLinkSuggestionsOriginal: () => CORE_SUGGESTIONS,
        getPathsByNameSafe,
        getSuggestionsSafe: () => Promise.resolve(INDEXED_SUGGESTIONS),
        nameIndex: strictProxy<NameIndex>({ getPathsByName })
      });

      expect(pluginApi.getLinkSuggestions()).toBe(INDEXED_SUGGESTIONS);
      await expect(pluginApi.getLinkSuggestionsSafe()).resolves.toBe(INDEXED_SUGGESTIONS);
      expect(pluginApi.getLinkSuggestionsOriginal()).toBe(CORE_SUGGESTIONS);
      expect(pluginApi.getPathsByName('alpha')).toEqual(['Indexed.md']);
      await expect(pluginApi.getPathsByNameSafe('alpha')).resolves.toEqual(['Safe.md']);
      expect(getPathsByName).toHaveBeenCalledWith('alpha');
      expect(getPathsByNameSafe).toHaveBeenCalledWith('alpha');
    });

    it('should answer null while the module is off, and the original from core', async () => {
      const getLinkSuggestions = vi.fn().mockReturnValue(CORE_SUGGESTIONS);
      castTo<LinkSuggestionsSource>(app.metadataCache).getLinkSuggestions = getLinkSuggestions;

      expect(pluginApi.getLinkSuggestions()).toBeNull();
      await expect(pluginApi.getLinkSuggestionsSafe()).resolves.toBeNull();
      expect(pluginApi.getPathsByName('alpha')).toBeNull();
      await expect(pluginApi.getPathsByNameSafe('alpha')).resolves.toBeNull();
      expect(pluginApi.getLinkSuggestionsOriginal()).toBe(CORE_SUGGESTIONS);
      expect(getLinkSuggestions).toHaveBeenCalledOnce();
    });
  });

  it('should read a note heading times by path as well as by file', () => {
    settings.isHeadingsModuleEnabled = true;
    const file = app.vault.createSync__('Alpha.md', '# One\n');
    const expected = [{ created: null, heading: 'One', level: 1, line: 0, modified: null, seen: null }];

    expect(pluginApi.getHeadingTimes('Alpha.md')).toEqual(expected);
    expect(pluginApi.getHeadingTimes(castTo<never>(file))).toEqual(expected);
  });

  it('should answer no heading times for a path no file answers to', () => {
    settings.isHeadingsModuleEnabled = true;

    expect(pluginApi.getHeadingTimes('Never/Written.md')).toEqual([]);
  });

  it('should answer with the configured property names', () => {
    settings.titlePropertyNames = ['title', 'heading'];

    expect(pluginApi.getTitlePropertyNames()).toEqual(['title', 'heading']);
  });

  it('should read a note titles by path as well as by file', () => {
    const file = app.vault.createSync__('Alpha.md', '---\ntitle: The Real Name\n---\n');

    expect(pluginApi.getTitles('Alpha.md')).toEqual(['The Real Name']);
    expect(pluginApi.getTitles(castTo<never>(file))).toEqual(['The Real Name']);
  });

  it('should answer with nothing for a path no file answers to', () => {
    expect(pluginApi.getTitles('Never/Written.md')).toEqual([]);
  });

  it('should answer with nothing while the module is off', () => {
    app.vault.createSync__('Alpha.md', '---\ntitle: The Real Name\n---\n');
    settings.isTitlesModuleEnabled = false;

    expect(pluginApi.getTitlePropertyNames()).toEqual([]);
    expect(pluginApi.getTitles('Alpha.md')).toEqual([]);
  });

  it('should hand back a fresh array, so a caller may sort it', () => {
    app.vault.createSync__('Alpha.md', '---\ntitle: The Real Name\n---\n');

    const titles = pluginApi.getTitles('Alpha.md');
    titles.length = 0;

    expect(pluginApi.getTitles('Alpha.md')).toEqual(['The Real Name']);
  });

  describe('properties', () => {
    it('should answer null for a property nobody registered', async () => {
      expect(pluginApi.getPathsByPropertyValue('keys', 'a')).toBeNull();
      expect(pluginApi.getPathsWithProperty('keys')).toBeNull();
      expect(await pluginApi.getPathsByPropertyValueSafe('keys', 'a')).toBeNull();
      expect(await pluginApi.getPathsWithPropertySafe('keys')).toBeNull();
    });

    it('should register into the index while the module is off, and answer null until it is on', () => {
      settings.isPropertiesModuleEnabled = false;
      pluginApi.registerPropertyName('keys');
      propertyValueIndex.refresh({ frontmatter: { keys: ['a'] }, path: 'Alpha.md' });

      expect(pluginApi.getPathsByPropertyValue('keys', 'a')).toBeNull();

      settings.isPropertiesModuleEnabled = true;
      expect(pluginApi.getPathsByPropertyValue('keys', 'a')).toEqual(['Alpha.md']);
      expect(pluginApi.getPathsWithProperty('keys')).toEqual(['Alpha.md']);
    });

    it('should register through the module component while the module is on', () => {
      const registerPropertyName = vi.fn();
      propertyValueIndexComponent = strictProxy<PropertyValueIndexComponent>({ registerPropertyName });

      pluginApi.registerPropertyName('keys');

      expect(registerPropertyName).toHaveBeenCalledWith('keys');
      expect(propertyValueIndex.getPropertyNames()).toEqual([]);
    });

    it('should wait for the build before a safe answer', async () => {
      pluginApi.registerPropertyName('keys');
      let resolveBuild: () => void = noop;
      const buildPromise = new Promise<void>((resolve) => {
        resolveBuild = resolve;
      });
      propertyValueIndexComponent = strictProxy<PropertyValueIndexComponent>({
        waitForBuild: async (): Promise<void> => {
          await buildPromise;
        }
      });

      const byValuePromise = pluginApi.getPathsByPropertyValueSafe('keys', 'a');
      const withPropertyPromise = pluginApi.getPathsWithPropertySafe('keys');
      propertyValueIndex.refresh({ frontmatter: { keys: 'a' }, path: 'Alpha.md' });
      resolveBuild();

      expect(await byValuePromise).toEqual(['Alpha.md']);
      expect(await withPropertyPromise).toEqual(['Alpha.md']);
    });

    it('should list dated values, at once and after the build, and null while the module is off', async () => {
      pluginApi.registerPropertyName('due');
      propertyValueIndexComponent = strictProxy<PropertyValueIndexComponent>({ waitForBuild: noopAsync });
      propertyValueIndex.refresh({ frontmatter: { due: '2026-10-26' }, path: 'Alpha.md' });
      const expected = [{ path: 'Alpha.md', propertyName: 'due', value: '2026-10-26' }];

      expect(pluginApi.getDatedValues({ from: '2026-10' })).toEqual(expected);
      expect(await pluginApi.getDatedValuesSafe({ isRecurring: true, to: '10-26' })).toEqual(expected);
      expect(pluginApi.getDatedValues({ propertyNames: ['other'] })).toBeNull();

      settings.isPropertiesModuleEnabled = false;
      expect(pluginApi.getDatedValues({})).toBeNull();
    });

    it('should list the values of a date property that are not dates, at once and after the build, and null while the module is off', async () => {
      // The mocks have no `metadataTypeManager`; no type is assigned, so `birthDate` is a date property by its name.
      castTo<Record<'metadataTypeManager', unknown>>(app).metadataTypeManager = { getAssignedWidget: (): null => null };
      pluginApi.registerPropertyName('birthDate');
      pluginApi.registerPropertyName('keys');
      propertyValueIndexComponent = strictProxy<PropertyValueIndexComponent>({ waitForBuild: noopAsync });
      propertyValueIndex.refresh({ frontmatter: { birthDate: ['1990-10-26', 'unknown'], keys: 'abc' }, path: 'Alpha.md' });
      const expected = [{ path: 'Alpha.md', propertyName: 'birthDate', value: 'unknown' }];

      expect(pluginApi.getNonDateValues()).toEqual(expected);
      expect(await pluginApi.getNonDateValuesSafe()).toEqual(expected);

      settings.isPropertiesModuleEnabled = false;
      expect(pluginApi.getNonDateValues()).toBeNull();
    });
  });

  describe('migrateSettings', () => {
    it('should add the proposed name to the list, keeping the current one', async () => {
      approveAsShown();

      const result = await pluginApi.migrateSettings({
        proposedSettings: { titlePropertyNames: ['subtitle'] },
        sourcePluginId: SOURCE_PLUGIN_ID
      });

      expect(result).toEqual({ isApplied: true });
      expect(settings.titlePropertyNames).toEqual(['title', 'subtitle']);
      expect(editAndSaveCallCount).toBe(1);
      expect(vi.mocked(showSettingsMigrationModal)).toHaveBeenCalledWith(expect.objectContaining({
        currentTitlePropertyNames: ['title'],
        mergedTitlePropertyNames: ['title', 'subtitle'],
        proposedTitlePropertyNames: ['subtitle']
      }));
    });

    it('should write what the user edited the list to', async () => {
      vi.mocked(showSettingsMigrationModal).mockResolvedValue({
        shouldEnableTitlesModule: false,
        titlePropertyNames: ['heading']
      });

      await pluginApi.migrateSettings({
        proposedSettings: { titlePropertyNames: ['subtitle'] },
        sourcePluginId: SOURCE_PLUGIN_ID
      });

      expect(settings.titlePropertyNames).toEqual(['heading']);
    });

    it('should write nothing and report it when the user cancels', async () => {
      vi.mocked(showSettingsMigrationModal).mockResolvedValue(null);

      const result = await pluginApi.migrateSettings({
        proposedSettings: { titlePropertyNames: ['subtitle'] },
        sourcePluginId: SOURCE_PLUGIN_ID
      });

      expect(result).toEqual({ isApplied: false });
      expect(settings.titlePropertyNames).toEqual(['title']);
      expect(editAndSaveCallCount).toBe(0);
    });

    it('should ask nothing when the name is already listed in another casing and the module is on', async () => {
      const result = await pluginApi.migrateSettings({
        proposedSettings: { titlePropertyNames: ['Title'] },
        sourcePluginId: SOURCE_PLUGIN_ID
      });

      expect(result).toEqual({ isApplied: true });
      expect(vi.mocked(showSettingsMigrationModal)).not.toHaveBeenCalled();
      expect(editAndSaveCallCount).toBe(0);
    });

    it('should ask nothing when nothing is proposed', async () => {
      settings.isTitlesModuleEnabled = false;

      const result = await pluginApi.migrateSettings({
        proposedSettings: {},
        sourcePluginId: SOURCE_PLUGIN_ID
      });

      expect(result).toEqual({ isApplied: true });
      expect(vi.mocked(showSettingsMigrationModal)).not.toHaveBeenCalled();
    });

    it('should still ask, and offer the module, when the name is listed but the module is off', async () => {
      settings.isTitlesModuleEnabled = false;
      approveAsShown();

      const result = await pluginApi.migrateSettings({
        proposedSettings: { titlePropertyNames: ['title'] },
        sourcePluginId: SOURCE_PLUGIN_ID
      });

      expect(result).toEqual({ isApplied: true });
      expect(vi.mocked(showSettingsMigrationModal)).toHaveBeenCalledWith(expect.objectContaining({ isTitlesModuleEnabled: false }));
      expect(settings.isTitlesModuleEnabled).toBe(true);
    });

    it('should name the proposing plugin by its manifest name, falling back to its id', async () => {
      approveAsShown();
      app.plugins.manifests[SOURCE_PLUGIN_ID] = castTo<PluginManifest>({ name: 'Alias Quick Switcher' });

      await pluginApi.migrateSettings({
        proposedSettings: { titlePropertyNames: ['subtitle'] },
        sourcePluginId: SOURCE_PLUGIN_ID
      });
      await pluginApi.migrateSettings({
        proposedSettings: { titlePropertyNames: ['heading'] },
        sourcePluginId: 'unknown-plugin'
      });

      expect(vi.mocked(showSettingsMigrationModal).mock.calls.map(([params]) => params.sourcePluginName)).toEqual([
        'Alias Quick Switcher',
        'unknown-plugin'
      ]);
    });

    it('should refuse a proposal whose names are not strings', async () => {
      await expect(pluginApi.migrateSettings({
        proposedSettings: castTo<never>({ titlePropertyNames: [42] }),
        sourcePluginId: SOURCE_PLUGIN_ID
      })).rejects.toThrow(TypeError);
    });

    it('should show two proposals one after another, the second merging into what the first wrote', async () => {
      approveAsShown();

      await Promise.all([
        pluginApi.migrateSettings({ proposedSettings: { titlePropertyNames: ['subtitle'] }, sourcePluginId: SOURCE_PLUGIN_ID }),
        pluginApi.migrateSettings({ proposedSettings: { titlePropertyNames: ['heading'] }, sourcePluginId: 'another-plugin' })
      ]);

      expect(settings.titlePropertyNames).toEqual(['title', 'subtitle', 'heading']);
    });

    it('should release the queue after a failure, so the next proposal still runs', async () => {
      await expect(pluginApi.migrateSettings({
        proposedSettings: castTo<never>({ titlePropertyNames: 'subtitle' }),
        sourcePluginId: SOURCE_PLUGIN_ID
      })).rejects.toThrow(TypeError);

      approveAsShown();
      const result = await pluginApi.migrateSettings({
        proposedSettings: { titlePropertyNames: ['subtitle'] },
        sourcePluginId: SOURCE_PLUGIN_ID
      });

      expect(result).toEqual({ isApplied: true });
    });
  });
});
