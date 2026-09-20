import type { App as AppOriginal } from 'obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { TitleIndex } from './modules/titles/title-index.ts';
import { PluginApiImpl } from './plugin-api-impl.ts';
import { PLUGIN_API_CONTRACT } from './plugin-api.ts';
import { PluginSettings } from './plugin-settings.ts';

describe('PluginApiImpl', () => {
  let app: App;
  let pluginApi: PluginApiImpl;
  let settings: PluginSettings;

  beforeEach(() => {
    app = App.createConfigured__();
    settings = new PluginSettings();
    settings.isTitlesModuleEnabled = true;

    const titleIndex = new TitleIndex({
      app: castTo<AppOriginal>(app),
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings })
    });

    pluginApi = new PluginApiImpl({ app: castTo<AppOriginal>(app), titleIndex });
  });

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
});
