import type {
  App,
  TFile
} from 'obsidian';
import type { SettingsMigrationApi } from 'obsidian-dev-utils/obsidian/plugin/settings-migration-api';

import {
  noop,
  noopAsync
} from 'obsidian-dev-utils/function';
import { getFileOrNull } from 'obsidian-dev-utils/obsidian/file-system';

import type { TitleIndex } from './modules/titles/title-index.ts';
import type {
  AdvancedMetadataCacheApi,
  AdvancedMetadataCacheMigratableSettings,
  MigrateSettingsParams,
  MigrateSettingsResult
} from './plugin-api.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { showSettingsMigrationModal } from './settings-migration-modal.ts';
import {
  getProposedTitlePropertyNames,
  mergeTitlePropertyNames
} from './settings-migration.ts';

interface PluginApiImplConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly titleIndex: TitleIndex;
}

/**
 * The published API, implemented over the indexes the modules own.
 *
 * It is published for the plugin's whole life rather than for a module's, and answers emptily while the
 * module behind it is off. A registry record that came and went with a toggle would make "the plugin is
 * not installed" and "you switched a module off" the same observation for a consumer — the first is
 * something to repair, the second is a setting, and telling them apart is most of what the registry is
 * for.
 *
 * It implements the library's `SettingsMigrationApi` as well as `AdvancedMetadataCacheApi`, which is the
 * compile-time tether between the two: `api.d.ts` restates that envelope rather than importing it, so it
 * stays copyable, and this `implements` fails to compile the moment the restatement drifts from what a
 * proposing plugin's `SettingsMigrationComponent` calls.
 */
export class PluginApiImpl implements AdvancedMetadataCacheApi, SettingsMigrationApi<AdvancedMetadataCacheMigratableSettings> {
  private readonly app: App;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  /**
   * The tail of the dialog queue. Two proposals arriving at once would otherwise stack two dialogs, and the
   * second would merge into a list the first is about to change.
   */
  private queuedMigrations = noopAsync();

  private readonly titleIndex: TitleIndex;

  public constructor(params: PluginApiImplConstructorParams) {
    this.app = params.app;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.titleIndex = params.titleIndex;
  }

  /**
   * The frontmatter properties whose values currently count as a note's title.
   *
   * @returns The configured property names, empty while the `Titles` module is off.
   */
  public getTitlePropertyNames(): string[] {
    return this.titleIndex.getTitlePropertyNames();
  }

  /**
   * Reads one note's titles.
   *
   * @param pathOrFile - The vault-relative path of a note, or the note itself.
   * @returns Its titles, empty for a path no file answers to and while the `Titles` module is off.
   */
  public getTitles(pathOrFile: string | TFile): string[] {
    const file = getFileOrNull({ app: this.app, pathOrFile });

    return file ? [...this.titleIndex.getTitles(file)] : [];
  }

  /**
   * Offers the user title properties another plugin proposes, and adds the ones they approve.
   *
   * @param params - The proposal.
   * @returns Whether the user applied it.
   */
  // eslint-disable-next-line obsidian-dev-utils/params-options-name-match -- The type is the published contract's, shared with the interface this class implements; renaming it per class+method would rename it in every consumer.
  public async migrateSettings(params: MigrateSettingsParams): Promise<MigrateSettingsResult> {
    const previousMigrations = this.queuedMigrations;
    let releaseQueue: () => void = noop;
    this.queuedMigrations = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });

    await previousMigrations;

    try {
      return await this.migrateSettingsWithoutQueueing(params);
    } finally {
      releaseQueue();
    }
  }

  private getSourcePluginName(sourcePluginId: string): string {
    return this.app.plugins.manifests[sourcePluginId]?.name ?? sourcePluginId;
  }

  // eslint-disable-next-line obsidian-dev-utils/params-options-name-match -- Same published contract type, one call deeper.
  private async migrateSettingsWithoutQueueing(params: MigrateSettingsParams): Promise<MigrateSettingsResult> {
    const settings = this.pluginSettingsComponent.settings;
    const proposedTitlePropertyNames = getProposedTitlePropertyNames(params.proposedSettings);
    const currentTitlePropertyNames = [...settings.titlePropertyNames];
    const mergedTitlePropertyNames = mergeTitlePropertyNames({ currentTitlePropertyNames, proposedTitlePropertyNames });

    const areAllProposedNamesListed = mergedTitlePropertyNames.length === mergeTitlePropertyNames({ currentTitlePropertyNames, proposedTitlePropertyNames: [] }).length;

    /*
     * Nothing is proposed, or every proposed name is already on the list and the module that reads the list
     * is on, so there is nothing to ask about. The migration counts as done — the proposing plugin may
     * retire its value.
     */
    if (proposedTitlePropertyNames.length === 0 || (areAllProposedNamesListed && settings.isTitlesModuleEnabled)) {
      return { isApplied: true };
    }

    const approvedSettingsMigration = await showSettingsMigrationModal({
      app: this.app,
      currentTitlePropertyNames,
      isTitlesModuleEnabled: settings.isTitlesModuleEnabled,
      mergedTitlePropertyNames,
      proposedTitlePropertyNames,
      sourcePluginName: this.getSourcePluginName(params.sourcePluginId)
    });

    if (!approvedSettingsMigration) {
      return { isApplied: false };
    }

    await this.pluginSettingsComponent.editAndSave((settingsToEdit) => {
      settingsToEdit.titlePropertyNames = approvedSettingsMigration.titlePropertyNames;

      if (approvedSettingsMigration.shouldEnableTitlesModule) {
        settingsToEdit.isTitlesModuleEnabled = true;
      }
    });

    return { isApplied: true };
  }
}
