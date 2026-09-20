import type { SettingDefinitionItem } from 'obsidian';

import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/plugin/plugin-settings-tab';

import type { PluginSettings } from './plugin-settings.ts';

export class PluginSettingsTab extends PluginSettingsTabBase<PluginSettings> {
  protected override getSettingDefinitionItems(): SettingDefinitionItem[] {
    return [
      this.settingEx({
        desc: 'Whether to index backlinks and answer `app.metadataCache.getBacklinksForFile()` from that index. When off, the built-in implementation answers instead and nothing is indexed.',
        name: 'Backlinks module',
        render: (setting) => {
          setting.addToggle((toggle) => {
            this.bind({
              onChanged: () => {
                this.refresh();
              },
              propertyName: 'isBacklinksModuleEnabled',
              valueComponent: toggle
            });
          });
        }
      }),
      this.settingEx({
        desc: 'Whether to index what every note is called - its name and its `aliases` - and answer `app.metadataCache.getLinkSuggestions()` from that index. That is what the `[[` autocomplete asks on every open, and the built-in implementation answers it by rescanning the whole vault each time. When off, the built-in implementation answers instead and nothing is indexed.',
        name: 'Names module',
        render: (setting) => {
          setting.addToggle((toggle) => {
            this.bind({
              onChanged: () => {
                this.refresh();
              },
              propertyName: 'isNamesModuleEnabled',
              valueComponent: toggle
            });
          });
        }
      }),
      this.settingEx({
        desc: 'Whether to refresh the backlink panels automatically when a note is saved.',
        name: 'Should automatically refresh backlink panels',
        render: (setting) => {
          setting.addToggle((toggle) => {
            this.bind({
              propertyName: 'shouldAutomaticallyRefreshBacklinkPanels',
              valueComponent: toggle
            });
          });
        },
        visible: () => this.pluginSettingsComponent.settings.isBacklinksModuleEnabled
      }),
      this.settingEx({
        desc: 'Whether to show progress bar on load.',
        name: 'Should show progress bar on load',
        render: (setting) => {
          setting.addToggle((toggle) => {
            this.bind({
              propertyName: 'shouldShowProgressBarOnLoad',
              valueComponent: toggle
            });
          });
        },
        visible: () => this.pluginSettingsComponent.settings.isBacklinksModuleEnabled
      })
    ];
  }
}
