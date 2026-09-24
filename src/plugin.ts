import type { PluginApiDeclaration } from 'obsidian-dev-utils/obsidian/plugin/plugin-api';

import { OpenDemoVaultCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/open-demo-vault-command-handler';
import { PluginSettingsTabComponent } from 'obsidian-dev-utils/obsidian/components/plugin-settings-tab-component';
import { PluginDataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import { PluginBase } from 'obsidian-dev-utils/obsidian/plugin/plugin';
import { PluginEventSourceImpl } from 'obsidian-dev-utils/obsidian/plugin/plugin-event-source';

import { BacklinksModuleComponent } from './modules/backlinks/backlinks-module-component.ts';
import { ModulesComponent } from './modules/modules-component.ts';
import { NameIndexComponent } from './modules/names/name-index-component.ts';
import { TitleIndexComponent } from './modules/titles/title-index-component.ts';
import { TitleIndex } from './modules/titles/title-index.ts';
import { PluginApiImpl } from './plugin-api-impl.ts';
import {
  PLUGIN_API_CONTRACT,
  PLUGIN_API_VERSION
} from './plugin-api.ts';
import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { PluginSettingsTab } from './plugin-settings-tab.ts';

export class Plugin extends PluginBase {
  private pluginApi: null | PluginApiImpl = null;

  /**
   * Declares the API for the base to publish, once `onloadImpl` has built it.
   *
   * Published by the base rather than by hand: the `plugin-loaded` broadcast's `apiVersions` is derived
   * from this method alone, so a hand `publishPluginApi` call would announce this plugin as publishing
   * no API at all — while the registry still worked, which is what makes that mistake invisible.
   *
   * @returns The declaration, or none before the plugin has loaded.
   */
  protected override getPluginApis(): PluginApiDeclaration[] {
    if (!this.pluginApi) {
      return [];
    }

    return [
      {
        api: this.pluginApi,
        apiVersion: PLUGIN_API_VERSION,
        contract: PLUGIN_API_CONTRACT
      }
    ];
  }

  protected override async onloadImpl(): Promise<void> {
    const pluginSettingsComponent = this.addChild(
      new PluginSettingsComponent({
        dataHandler: new PluginDataHandler(this),
        pluginEventSource: new PluginEventSourceImpl(this)
      })
    );
    this.pluginSettingsComponent = pluginSettingsComponent;

    const pluginSettingsTab = new PluginSettingsTab({
      plugin: this,
      pluginSettingsComponent
    });
    this.addChild(
      new PluginSettingsTabComponent({
        plugin: this,
        pluginSettingsTab
      })
    );

    /*
     * The one object two modules share, and the reason it is built here rather than inside either of
     * them: `names` reads titles while indexing, and `titles` keeps them current, but each is switched
     * on independently of the other. Owned by the plugin, gated on its own module's toggle, so either
     * module finds the same answer whatever the other is doing.
     */
    const titleIndex = new TitleIndex({ app: this.app, pluginSettingsComponent });
    this.pluginApi = new PluginApiImpl({ app: this.app, pluginSettingsComponent, titleIndex });

    this.addChild(
      new ModulesComponent({
        moduleDefinitions: [
          {
            createComponent: (): BacklinksModuleComponent =>
              new BacklinksModuleComponent({
                abortSignalComponent: this.abortSignalComponent,
                app: this.app,
                commandHandlerComponent: this.commandHandlerComponent,
                consoleDebugComponent: this.consoleDebugComponent,
                pluginNoticeComponent: this.pluginNoticeComponent,
                pluginSettingsComponent
              }),
            getIsEnabled: (settings): boolean => settings.isBacklinksModuleEnabled,
            moduleId: 'backlinks'
          },
          {
            // The index component IS the module: unlike `backlinks` it registers no command, so a
            // wrapper component would own nothing but the child below.
            createComponent: (): NameIndexComponent =>
              new NameIndexComponent({
                app: this.app,
                pluginSettingsComponent,
                titleIndex
              }),
            getIsEnabled: (settings): boolean => settings.isNamesModuleEnabled,
            moduleId: 'names'
          },
          {
            createComponent: (): TitleIndexComponent => new TitleIndexComponent({ app: this.app, titleIndex }),
            getIsEnabled: (settings): boolean => settings.isTitlesModuleEnabled,
            moduleId: 'titles'
          }
        ],
        pluginSettingsComponent
      })
    );

    await this.commandHandlerComponent.registerCommandHandlers(() => [
      new OpenDemoVaultCommandHandler({
        app: this.app,
        pluginId: this.manifest.id,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginVersion: this.manifest.version
      })
    ]);
  }
}
