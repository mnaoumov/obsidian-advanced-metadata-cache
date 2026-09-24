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
        desc: 'Whether to treat a frontmatter property as a name for the note carrying it, alongside its own name and its `aliases`. Nothing is indexed up front: the properties are read per note, on demand, and they join what the `Names` module answers about. Other plugins can read the same list and the same per-note answer, so the property is named here once rather than in each of them.',
        name: 'Titles module',
        render: (setting) => {
          setting.addToggle((toggle) => {
            this.bind({
              onChanged: () => {
                this.refresh();
              },
              propertyName: 'isTitlesModuleEnabled',
              valueComponent: toggle
            });
          });
        }
      }),
      this.settingEx({
        desc: 'The frontmatter properties whose values name the note, one per line. Order matters only for the order the titles come back in.',
        name: 'Title properties',
        render: (setting) => {
          setting.addMultipleText((multipleText) => {
            this.bind({
              propertyName: 'titlePropertyNames',
              valueComponent: multipleText
            });
          });
        },
        visible: () => this.pluginSettingsComponent.settings.isTitlesModuleEnabled
      }),
      this.settingEx({
        desc: 'Whether the `[[` autocomplete offers a note under its titles as well as under its own name and its `aliases`. Off by default, because with it off the list this plugin answers with is the one Obsidian would have built, only faster. With it on, the title entries are appended to that list, and accepting one writes a link like `[[Notes/some-note|The Real Name]]` - which keeps working even if this plugin is switched off later. A title already matching the note name or one of the `aliases` is not offered twice.',
        name: 'Offer titles in the [[ autocomplete',
        render: (setting) => {
          setting.addToggle((toggle) => {
            this.bind({
              propertyName: 'shouldOfferTitlesInLinkSuggestions',
              valueComponent: toggle
            });
          });
        },
        // Both modules, because it does nothing without either: the `Names` module owns the list, and
        // the `Titles` module is what makes a title a name at all. An inert toggle would be worse than
        // an absent one.
        visible: () => this.pluginSettingsComponent.settings.isNamesModuleEnabled && this.pluginSettingsComponent.settings.isTitlesModuleEnabled
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
