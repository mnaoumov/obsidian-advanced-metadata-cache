import type { PluginApiDeclaration } from '@mnaoumov/obsidian-lib/plugin/plugin-api';

import { OpenDemoVaultCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/open-demo-vault-command-handler';
import { PluginSettingsTabComponent } from '@mnaoumov/obsidian-lib/components/plugin-settings-tab-component';
import { PluginDataHandler } from '@mnaoumov/obsidian-lib/data-handler';
import { PluginBase } from '@mnaoumov/obsidian-lib/plugin/plugin';
import { PluginEventSourceImpl } from '@mnaoumov/obsidian-lib/plugin/plugin-event-source';
import { normalizePath } from 'obsidian';

import type { BacklinkCacheComponent } from './modules/backlinks/backlink-cache-component.ts';

import { BacklinksModuleComponent } from './modules/backlinks/backlinks-module-component.ts';
import { HeadingTimesComponent } from './modules/headings/heading-times-component.ts';
import { HeadingTimesIndex } from './modules/headings/heading-times-index.ts';
import { LinkTextIndexComponent } from './modules/link-texts/link-text-index-component.ts';
import { LinkTextIndex } from './modules/link-texts/link-text-index.ts';
import { ModulesComponent } from './modules/modules-component.ts';
import { NameIndexComponent } from './modules/names/name-index-component.ts';
import { PropertyValueIndexComponent } from './modules/properties/property-value-index-component.ts';
import { PropertyValueIndex } from './modules/properties/property-value-index.ts';
import { TitleIndexComponent } from './modules/titles/title-index-component.ts';
import { TitleIndex } from './modules/titles/title-index.ts';
import { UnlinkedMentionsComponent } from './modules/unlinked-mentions/unlinked-mentions-component.ts';
import { PluginIndexStorage } from './persistence/plugin-index-storage.ts';
import { PluginApiImpl } from './plugin-api-impl.ts';
import { PLUGIN_API_VERSION } from './plugin-api-version.ts';
import { PLUGIN_API_CONTRACT } from './plugin-api.ts';
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
    // Owned here for the same reason: the published API reads it for the plugin's whole life.
    const headingTimesIndex = new HeadingTimesIndex({
      app: this.app,
      getDataFilePath: (): string => this.getDataFilePath('heading-times.json'),
      pluginSettingsComponent,
      storage: new PluginIndexStorage({ app: this.app, getLegacyPath: (): string => this.getDataFilePath('heading-times.json'), kind: 'headings', pluginId: this.manifest.id })
    });
    // Owned here too: a registration must outlive the module being switched off and on again.
    const propertyValueIndex = new PropertyValueIndex({
      app: this.app,
      getDataFilePath: (): string => this.getDataFilePath('property-values.json'),
      pluginSettingsComponent,
      storage: new PluginIndexStorage({ app: this.app, getLegacyPath: (): string => this.getDataFilePath('property-values.json'), kind: 'properties', pluginId: this.manifest.id })
    });
    // Owned here too: a consumer subscribes to its changes once, for the plugin's whole life.
    const linkTextIndex = new LinkTextIndex();
    const modulesComponent = new ModulesComponent({
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
        },
        {
          createComponent: (): HeadingTimesComponent => new HeadingTimesComponent({ app: this.app, headingTimesIndex }),
          getIsEnabled: (settings): boolean => settings.isHeadingsModuleEnabled,
          moduleId: 'headings'
        },
        {
          createComponent: (): PropertyValueIndexComponent => new PropertyValueIndexComponent({ app: this.app, pluginSettingsComponent, propertyValueIndex }),
          getIsEnabled: (settings): boolean => settings.isPropertiesModuleEnabled,
          moduleId: 'properties'
        },
        {
          createComponent: (): UnlinkedMentionsComponent =>
            new UnlinkedMentionsComponent({
              app: this.app,
              getDataFilePath: (): string => this.getDataFilePath('unlinked-mentions.json'),
              storage: new PluginIndexStorage({ app: this.app, getLegacyPath: (): string => this.getDataFilePath('unlinked-mentions.json'), kind: 'mentions', pluginId: this.manifest.id })
            }),
          getIsEnabled: (settings): boolean => settings.isUnlinkedMentionsModuleEnabled,
          moduleId: 'unlinked-mentions'
        },
        {
          createComponent: (): LinkTextIndexComponent => new LinkTextIndexComponent({ app: this.app, linkTextIndex }),
          getIsEnabled: (settings): boolean => settings.isLinkTextsModuleEnabled,
          moduleId: 'link-texts'
        }
      ],
      pluginSettingsComponent
    });

    this.pluginApi = new PluginApiImpl({
      app: this.app,
      getBacklinkCacheComponent: (): BacklinkCacheComponent | null => {
        const moduleComponent = modulesComponent.getModuleComponent('backlinks');
        return moduleComponent instanceof BacklinksModuleComponent ? moduleComponent.backlinkCacheComponent : null;
      },
      getLinkTextIndexComponent: (): LinkTextIndexComponent | null => {
        const moduleComponent = modulesComponent.getModuleComponent('link-texts');
        return moduleComponent instanceof LinkTextIndexComponent ? moduleComponent : null;
      },
      getNameIndexComponent: (): NameIndexComponent | null => {
        const moduleComponent = modulesComponent.getModuleComponent('names');
        return moduleComponent instanceof NameIndexComponent ? moduleComponent : null;
      },
      getPropertyValueIndexComponent: (): null | PropertyValueIndexComponent => {
        const moduleComponent = modulesComponent.getModuleComponent('properties');
        return moduleComponent instanceof PropertyValueIndexComponent ? moduleComponent : null;
      },
      getUnlinkedMentionsComponent: (): null | UnlinkedMentionsComponent => {
        const moduleComponent = modulesComponent.getModuleComponent('unlinked-mentions');
        return moduleComponent instanceof UnlinkedMentionsComponent ? moduleComponent : null;
      },
      headingTimesIndex,
      linkTextIndex,
      pluginSettingsComponent,
      propertyValueIndex,
      titleIndex
    });

    this.addChild(modulesComponent);

    await this.commandHandlerComponent.registerCommandHandlers(() => [
      new OpenDemoVaultCommandHandler({
        app: this.app,
        pluginId: this.manifest.id,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginVersion: this.manifest.version
      })
    ]);
  }

  /**
   * Where a module reads its legacy migration source: a file in this plugin's folder, so it never mixes into
   * `data.json`, which holds settings and is rewritten whenever one changes.
   *
   * @param fileName - The index file's name.
   * @returns The vault-relative path.
   */
  private getDataFilePath(fileName: string): string {
    return normalizePath(`${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`}/${fileName}`);
  }
}
