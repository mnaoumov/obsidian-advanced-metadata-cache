import type {
  App as AppOriginal,
  PluginManifest
} from 'obsidian';

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

import type { PluginSettingsComponent } from './plugin-settings-component.ts';
import type {
  ApprovedSettingsMigration,
  ShowSettingsMigrationModalParams
} from './settings-migration-modal.ts';

import { TitleIndex } from './modules/titles/title-index.ts';
import { PluginApiImpl } from './plugin-api-impl.ts';
import { PLUGIN_API_CONTRACT } from './plugin-api.ts';
import { PluginSettings } from './plugin-settings.ts';
import { showSettingsMigrationModal } from './settings-migration-modal.ts';

vi.mock('./settings-migration-modal.ts', () => ({
  showSettingsMigrationModal: vi.fn()
}));

const SOURCE_PLUGIN_ID = 'alias-quick-switcher';

describe('PluginApiImpl', () => {
  let app: App;
  let editAndSaveCallCount: number;
  let pluginApi: PluginApiImpl;
  let settings: PluginSettings;

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    settings = new PluginSettings();
    settings.isTitlesModuleEnabled = true;
    editAndSaveCallCount = 0;

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

    pluginApi = new PluginApiImpl({ app: castTo<AppOriginal>(app), pluginSettingsComponent, titleIndex });
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
