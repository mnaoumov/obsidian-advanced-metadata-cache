import type { DataHandler } from '@mnaoumov/obsidian-lib/data-handler';
import type { PluginEventSource } from '@mnaoumov/obsidian-lib/plugin/plugin-event-source';

import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  describe,
  expect,
  it
} from 'vitest';

import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { PluginSettings } from './plugin-settings.ts';

describe('PluginSettingsComponent', () => {
  it('should create with PluginSettings class', () => {
    const dataHandler = strictProxy<DataHandler>({});
    const pluginEventSource = strictProxy<PluginEventSource>({});

    const component = new PluginSettingsComponent({
      dataHandler,
      pluginEventSource
    });

    expect(component.settings).toBeInstanceOf(PluginSettings);
  });

  it('should refuse a hidden plugin data folder and accept a visible one', async () => {
    const component = new PluginSettingsComponent({
      dataHandler: strictProxy<DataHandler>({}),
      pluginEventSource: strictProxy<PluginEventSource>({})
    });
    const settings = new PluginSettings();

    settings.pluginDataFolder = 'Meta/.sync';
    const hidden = await component.validate(settings);
    expect(hidden.pluginDataFolder).toContain('hidden');

    settings.pluginDataFolder = 'Meta/Sync';
    const visible = await component.validate(settings);
    expect(visible.pluginDataFolder).toBeUndefined();
  });
});
