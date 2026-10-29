import type { SettingDefinitionItem } from 'obsidian';

import { PluginSettingsTabBase } from '@mnaoumov/obsidian-lib/plugin/plugin-settings-tab';

import type { PluginSettings } from './plugin-settings.ts';

import { parseNamePatterns } from './modules/titles/title-index.ts';

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
        desc: 'Whether links and embeds written inside code blocks of the languages listed below count like any other link: in backlinks, outgoing links, the graph, and the updates a rename makes. Obsidian skips everything inside a code block, which is wrong for a block a plugin renders as a note, such as an `ad-note` admonition. Only notes with such a block are read. When off, those links are ignored as before.',
        name: 'Code block links module',
        render: (setting) => {
          setting.addToggle((toggle) => {
            this.bind({
              onChanged: () => {
                this.refresh();
              },
              propertyName: 'isCodeBlockLinksModuleEnabled',
              valueComponent: toggle
            });
          });
        }
      }),
      this.settingEx({
        desc: 'The code block languages whose content is a note, one per line. An exact name, or a pattern in which `*` stands for anything: `ad-*` matches `ad-note` and `ad-warning`. Case-sensitive. Empty by default, so nothing changes until a language is listed here. Other plugins can add their own languages.',
        name: 'Code block languages',
        render: (setting) => {
          setting.addMultipleText((multipleText) => {
            this.bind({
              propertyName: 'codeBlockLinkLanguages',
              valueComponent: multipleText
            });
          });
        },
        visible: () => this.pluginSettingsComponent.settings.isCodeBlockLinksModuleEnabled
      }),
      this.settingEx({
        desc: 'Whether to record when each heading of a note was created, last modified and last seen on screen, so other plugins can sort headings by those times. Obsidian keeps no such record. It is kept in a file in the plugin folder, never in the note, and only for notes opened, created or changed while this is on. A change made on another device is stamped when it arrives here.',
        name: 'Headings module',
        render: (setting) => {
          setting.addToggle((toggle) => {
            // No `onChanged` refresh: no other row depends on this module.
            this.bind({
              propertyName: 'isHeadingsModuleEnabled',
              valueComponent: toggle
            });
          });
        }
      }),
      this.settingEx({
        desc: 'Whether to index the display texts that links use for a file instead of its name, such as `alpha` in `[alpha](bravo.md)` or `[[bravo|alpha]]`, or `boarding pass` in `![[IMG_2231.jpg|boarding pass]]`, so other plugins can find a note or an attachment by them. It reads the links Obsidian has already parsed, never a note. When off, nothing is indexed.',
        name: 'Link texts module',
        render: (setting) => {
          setting.addToggle((toggle) => {
            // No `onChanged` refresh: no other row depends on this module.
            this.bind({
              propertyName: 'isLinkTextsModuleEnabled',
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
        desc: 'Whether other plugins may ask which notes carry a frontmatter property, or a given value of it, without scanning the whole vault. Only the properties another plugin registers are indexed, so with none registered this costs nothing. The index is kept in a file in the plugin folder, so it answers at startup straight away. When off, those plugins scan the vault themselves.',
        name: 'Properties module',
        render: (setting) => {
          setting.addToggle((toggle) => {
            this.bind({
              onChanged: () => {
                this.refresh();
              },
              propertyName: 'isPropertiesModuleEnabled',
              valueComponent: toggle
            });
          });
        }
      }),
      this.settingEx({
        desc: 'The frontmatter properties whose values are dates, one per line, so other plugins can find notes by date or by a recurring date. An exact name, or a pattern in which `*` stands for anything: `*Date` matches `birthDate` and `startDate`. Case-sensitive. A property whose type is Date or Date & time is a date property without being listed here.',
        name: 'Date properties',
        render: (setting) => {
          setting.addMultipleText((multipleText) => {
            this.bind({
              propertyName: 'datePropertyNames',
              valueComponent: multipleText
            });
          });
        },
        visible: () => this.pluginSettingsComponent.settings.isPropertiesModuleEnabled
      }),
      this.settingEx({
        desc: 'The IANA time zone used for dates without a zone in UTC queries, for example Europe/Kyiv. Leave empty to follow this device. A caller can override this for each query.',
        name: 'Default time zone',
        render: (setting) => {
          setting.addText((text) => {
            this.bind({ propertyName: 'defaultTimeZone', valueComponent: text });
          });
        },
        visible: () => this.pluginSettingsComponent.settings.isPropertiesModuleEnabled
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
        desc: 'Names built from name parts, one pattern per line, its properties separated by commas: `lastName, firstName` names a note with `lastName: Smith` and `firstName: John` as `Smith John`. A missing part is skipped. A part may hold several forms, as a list, or keyed by the form with its languages as the value - `{Наумов: [ru, uk], Naumov: [en]}` - and then each pattern is built once per language, never mixing two.',
        name: 'Name patterns',
        render: (setting) => {
          setting.addMultipleText((multipleText) => {
            this.bind({
              componentToPluginSettingsValueConverter: (lines: readonly string[]) => parseNamePatterns(lines),
              pluginSettingsToComponentValueConverter: (namePatterns: readonly (readonly string[])[]): readonly string[] => namePatterns.map((namePattern) => namePattern.join(', ')),
              propertyName: 'titleNamePatterns',
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
        desc: 'Whether to index which notes mention which note names, so the Backlinks pane\'s `Unlinked mentions` section reads only the notes that mention the open note instead of every note in the vault. It finds exactly what the built-in section finds. Every note is read once when it starts, in the background; until then the built-in section answers. When off, nothing is indexed.',
        name: 'Unlinked mentions module',
        render: (setting) => {
          setting.addToggle((toggle) => {
            // No `onChanged` refresh: no other row depends on this module.
            this.bind({
              propertyName: 'isUnlinkedMentionsModuleEnabled',
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
