import type { SettingsMigrationApi } from '@mnaoumov/obsidian-lib/plugin/settings-migration-api';
import type {
  CustomArrayDict,
  LinkSuggestion
} from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  Reference,
  TFile
} from 'obsidian';

import { getFileOrNull } from '@mnaoumov/obsidian-lib/file-system';
import {
  noop,
  noopAsync
} from '@mnaoumov/typescript-lib/function';

import type { BacklinkCacheComponent } from './modules/backlinks/backlink-cache-component.ts';
import type { HeadingTimesIndex } from './modules/headings/heading-times-index.ts';
import type { NameIndexComponent } from './modules/names/name-index-component.ts';
import type { PropertyValueIndexComponent } from './modules/properties/property-value-index-component.ts';
import type { PropertyValueIndex } from './modules/properties/property-value-index.ts';
import type { TitleIndex } from './modules/titles/title-index.ts';
import type { MentionRange } from './modules/unlinked-mentions/unlinked-mention-ranges.ts';
import type { UnlinkedMentionsComponent } from './modules/unlinked-mentions/unlinked-mentions-component.ts';
import type {
  AdvancedMetadataCacheApi,
  AdvancedMetadataCacheMigratableSettings,
  DatedValue,
  DatedValuesQuery,
  HeadingTimes,
  MigrateSettingsParams,
  MigrateSettingsResult,
  UnlinkedMention,
  UnlinkedMentionRange
} from './plugin-api.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { showSettingsMigrationModal } from './settings-migration-modal.ts';
import {
  getProposedTitlePropertyNames,
  mergeTitlePropertyNames
} from './settings-migration.ts';

interface PluginApiImplConstructorParams {
  readonly app: App;
  /**
   * Finds the `Backlinks` module's cache, or `null` while the module is off. Asked per call, because a
   * module switched off and on again is a fresh component.
   */
  readonly getBacklinkCacheComponent: () => BacklinkCacheComponent | null;
  /**
   * Finds the `Names` module's component, or `null` while the module is off. Asked per call, for the
   * same reason.
   */
  readonly getNameIndexComponent: () => NameIndexComponent | null;
  /**
   * Finds the `Properties` module's component, or `null` while the module is off. Asked per call, for the
   * same reason.
   */
  readonly getPropertyValueIndexComponent: () => null | PropertyValueIndexComponent;
  /**
   * Finds the `Unlinked mentions` module's component, or `null` while the module is off. Asked per call, for the
   * same reason.
   */
  readonly getUnlinkedMentionsComponent: () => null | UnlinkedMentionsComponent;
  readonly headingTimesIndex: HeadingTimesIndex;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly propertyValueIndex: PropertyValueIndex;
  readonly titleIndex: TitleIndex;
}

/**
 * The published API, implemented over the indexes the modules own.
 *
 * It is published for the plugin's whole life rather than for a module's, and answers emptily, or with
 * `null` where empty would be a real answer, while the module behind it is off. A registry record that
 * came and went with a toggle would make "the plugin is not installed" and "you switched a module off"
 * the same observation for a consumer — the first is something to repair, the second is a setting, and
 * telling them apart is most of what the registry is for.
 *
 * It implements the library's `SettingsMigrationApi` as well as `AdvancedMetadataCacheApi`, which is the
 * compile-time tether between the two: `api.d.ts` restates that envelope rather than importing it, so it
 * stays copyable, and this `implements` fails to compile the moment the restatement drifts from what a
 * proposing plugin's `SettingsMigrationComponent` calls.
 */
export class PluginApiImpl implements AdvancedMetadataCacheApi, SettingsMigrationApi<AdvancedMetadataCacheMigratableSettings> {
  private readonly app: App;
  private readonly getBacklinkCacheComponent: () => BacklinkCacheComponent | null;
  private readonly getNameIndexComponent: () => NameIndexComponent | null;
  private readonly getPropertyValueIndexComponent: () => null | PropertyValueIndexComponent;
  private readonly getUnlinkedMentionsComponent: () => null | UnlinkedMentionsComponent;
  private readonly headingTimesIndex: HeadingTimesIndex;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly propertyValueIndex: PropertyValueIndex;

  /**
   * The tail of the dialog queue. Two proposals arriving at once would otherwise stack two dialogs, and the
   * second would merge into a list the first is about to change.
   */
  private queuedMigrations = noopAsync();

  private readonly titleIndex: TitleIndex;

  public constructor(params: PluginApiImplConstructorParams) {
    this.app = params.app;
    this.getBacklinkCacheComponent = params.getBacklinkCacheComponent;
    this.getNameIndexComponent = params.getNameIndexComponent;
    this.getPropertyValueIndexComponent = params.getPropertyValueIndexComponent;
    this.getUnlinkedMentionsComponent = params.getUnlinkedMentionsComponent;
    this.headingTimesIndex = params.headingTimesIndex;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.propertyValueIndex = params.propertyValueIndex;
    this.titleIndex = params.titleIndex;
  }

  /**
   * Reads a note's backlinks from the `Backlinks` module's cache.
   *
   * @param pathOrFile - The vault-relative path of a note, or the note itself.
   * @returns The backlinks, or `null` while the `Backlinks` module is off.
   */
  public getBacklinksForFile(pathOrFile: string | TFile): CustomArrayDict<Reference> | null {
    return this.getBacklinkCacheComponent()?.getBacklinksForFileAsCore(pathOrFile) ?? null;
  }

  /**
   * Calls Obsidian's own `getBacklinksForFile()`, bypassing the cache.
   *
   * @param file - The note.
   * @returns Obsidian's answer.
   */
  public getBacklinksForFileOriginal(file: TFile): CustomArrayDict<Reference> {
    return this.getBacklinkCacheComponent()?.getBacklinksForFileOriginal(file) ?? this.app.metadataCache.getBacklinksForFile(file);
  }

  /**
   * Reads a note's backlinks once every change already reported to the cache has been processed.
   *
   * @param pathOrFile - The vault-relative path of a note, or the note itself.
   * @returns The backlinks, or `null` while the `Backlinks` module is off.
   */
  public async getBacklinksForFileSafe(pathOrFile: string | TFile): Promise<CustomArrayDict<Reference> | null> {
    return await this.getBacklinkCacheComponent()?.getBacklinksForFileAsCoreSafe(pathOrFile) ?? null;
  }

  /**
   * Lists the date-shaped values of the indexed properties that fall in a range, in order.
   *
   * @param query - The range, and the properties to read.
   * @returns The values, or `null` for an unregistered property and while the `Properties` module is off.
   */
  public getDatedValues(query: DatedValuesQuery): DatedValue[] | null {
    return this.propertyValueIndex.getDatedValues(query);
  }

  /**
   * Lists the date-shaped values of the indexed properties that fall in a range, once the index is rebuilt.
   *
   * @param query - The range, and the properties to read.
   * @returns The values, or `null` for an unregistered property and while the `Properties` module is off.
   */
  public async getDatedValuesSafe(query: DatedValuesQuery): Promise<DatedValue[] | null> {
    await this.getPropertyValueIndexComponent()?.waitForBuild();
    return this.propertyValueIndex.getDatedValues(query);
  }

  /**
   * Reads when each of a note's headings was created, last modified and last seen.
   *
   * @param pathOrFile - The vault-relative path of a note, or the note itself.
   * @returns Its headings in document order, empty for a path no file answers to and while the `Headings`
   *   module is off.
   */
  public getHeadingTimes(pathOrFile: string | TFile): HeadingTimes[] {
    const file = getFileOrNull({ app: this.app, pathOrFile });

    return file ? this.headingTimesIndex.getHeadingTimes(file) : [];
  }

  /**
   * Every link target the `[[` autocomplete can offer, from the `Names` module's index.
   *
   * @returns The link suggestions, or `null` while the `Names` module is off.
   */
  public getLinkSuggestions(): LinkSuggestion[] | null {
    return this.getNameIndexComponent()?.getLinkSuggestions() ?? null;
  }

  /**
   * Calls Obsidian's own `getLinkSuggestions()`, bypassing the index.
   *
   * @returns Obsidian's answer.
   */
  public getLinkSuggestionsOriginal(): LinkSuggestion[] {
    return this.getNameIndexComponent()?.getLinkSuggestionsOriginal() ?? this.app.metadataCache.getLinkSuggestions();
  }

  /**
   * Every link target the `[[` autocomplete can offer, once the index is built.
   *
   * @returns The link suggestions, or `null` while the `Names` module is off.
   */
  public async getLinkSuggestionsSafe(): Promise<LinkSuggestion[] | null> {
    return await this.getNameIndexComponent()?.getSuggestionsSafe() ?? null;
  }

  /**
   * Lists the values of the date properties that are not date-shaped.
   *
   * @returns The values, or `null` while the `Properties` module is off.
   */
  public getNonDateValues(): DatedValue[] | null {
    return this.propertyValueIndex.getNonDateValues();
  }

  /**
   * Lists the values of the date properties that are not date-shaped, once the index is rebuilt.
   *
   * @returns The values, or `null` while the `Properties` module is off.
   */
  public async getNonDateValuesSafe(): Promise<DatedValue[] | null> {
    await this.getPropertyValueIndexComponent()?.waitForBuild();
    return this.propertyValueIndex.getNonDateValues();
  }

  /**
   * Finds every note that answers to a name.
   *
   * @param name - A basename, alias or title, in any casing and spacing.
   * @returns The vault-relative paths, or `null` while the `Names` module is off.
   */
  public getPathsByName(name: string): null | string[] {
    return this.getNameIndexComponent()?.nameIndex.getPathsByName(name) ?? null;
  }

  /**
   * Finds every note that answers to a name, once the index is built.
   *
   * @param name - A basename, alias or title, in any casing and spacing.
   * @returns The vault-relative paths, or `null` while the `Names` module is off.
   */
  public async getPathsByNameSafe(name: string): Promise<null | string[]> {
    return await this.getNameIndexComponent()?.getPathsByNameSafe(name) ?? null;
  }

  /**
   * Finds every note whose frontmatter property holds a value.
   *
   * @param propertyName - The property name.
   * @param value - The value to look for.
   * @returns The vault-relative paths, or `null` for an unregistered property and while the `Properties`
   *   module is off.
   */
  public getPathsByPropertyValue(propertyName: string, value: string): null | string[] {
    return this.propertyValueIndex.getPathsByPropertyValue(propertyName, value);
  }

  /**
   * Finds every note whose frontmatter property holds a value, once the index is rebuilt.
   *
   * @param propertyName - The property name.
   * @param value - The value to look for.
   * @returns The vault-relative paths, or `null` for an unregistered property and while the `Properties`
   *   module is off.
   */
  public async getPathsByPropertyValueSafe(propertyName: string, value: string): Promise<null | string[]> {
    await this.getPropertyValueIndexComponent()?.waitForBuild();
    return this.propertyValueIndex.getPathsByPropertyValue(propertyName, value);
  }

  /**
   * Finds every note carrying a frontmatter property.
   *
   * @param propertyName - The property name.
   * @returns The vault-relative paths, or `null` for an unregistered property and while the `Properties`
   *   module is off.
   */
  public getPathsWithProperty(propertyName: string): null | string[] {
    return this.propertyValueIndex.getPathsWithProperty(propertyName);
  }

  /**
   * Finds every note carrying a frontmatter property, once the index is rebuilt.
   *
   * @param propertyName - The property name.
   * @returns The vault-relative paths, or `null` for an unregistered property and while the `Properties`
   *   module is off.
   */
  public async getPathsWithPropertySafe(propertyName: string): Promise<null | string[]> {
    await this.getPropertyValueIndexComponent()?.waitForBuild();
    return this.propertyValueIndex.getPathsWithProperty(propertyName);
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
   * Finds every note that mentions a note without linking to it.
   *
   * @param pathOrFile - The vault-relative path of a note, or the note itself.
   * @returns The mentioning notes ordered by path, each with its spans ordered by position; empty for a path no file
   *   answers to, and `null` while the `Unlinked mentions` module is off.
   */
  public async getUnlinkedMentions(pathOrFile: string | TFile): Promise<null | UnlinkedMention[]> {
    const unlinkedMentionsComponent = this.getUnlinkedMentionsComponent();
    if (!unlinkedMentionsComponent) {
      return null;
    }

    const file = getFileOrNull({ app: this.app, pathOrFile });
    if (!file) {
      return [];
    }

    const unlinkedMentionMatches = await unlinkedMentionsComponent.getUnlinkedMentions(file);
    return unlinkedMentionMatches
      .map((unlinkedMentionMatch) => ({
        path: unlinkedMentionMatch.file.path,
        ranges: toUnlinkedMentionRanges(unlinkedMentionMatch.ranges)
      }))
      .sort((a, b) => compareByCodeUnits(a.path, b.path));
  }

  /**
   * Offers the user title properties another plugin proposes, and adds the ones they approve.
   *
   * @param params - The proposal.
   * @returns Whether the user applied it.
   */
  // eslint-disable-next-line typescript-dev-toolkit/params-options-name-match -- The type is the published contract's, shared with the interface this class implements; renaming it per class+method would rename it in every consumer.
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

  /**
   * Asks the `Properties` module to index a frontmatter property.
   *
   * @param propertyName - The property name.
   */
  public registerPropertyName(propertyName: string): void {
    const propertyValueIndexComponent = this.getPropertyValueIndexComponent();

    if (propertyValueIndexComponent) {
      propertyValueIndexComponent.registerPropertyName(propertyName);
    } else {
      // Kept for when the module is switched on, which loads the saved index and rebuilds it.
      this.propertyValueIndex.register(propertyName);
    }
  }

  private getSourcePluginName(sourcePluginId: string): string {
    return this.app.plugins.manifests[sourcePluginId]?.name ?? sourcePluginId;
  }

  // eslint-disable-next-line typescript-dev-toolkit/params-options-name-match -- Same published contract type, one call deeper.
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

// The same order on every machine, whatever its locale.
function compareByCodeUnits(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
}

/*
 * Obsidian lists a note's spans name by name, so a span two names both match appears twice; the API orders them by
 * position and lists each span once.
 */
function toUnlinkedMentionRanges(mentionRanges: readonly MentionRange[]): UnlinkedMentionRange[] {
  const unlinkedMentionRanges: UnlinkedMentionRange[] = [];
  const sortedMentionRanges = [...mentionRanges].sort(([startA, endA], [startB, endB]) => startA - startB || endA - endB);
  for (const [start, end] of sortedMentionRanges) {
    const previous = unlinkedMentionRanges.at(-1);
    if (previous?.start !== start || previous.end !== end) {
      unlinkedMentionRanges.push({ end, start });
    }
  }

  return unlinkedMentionRanges;
}
