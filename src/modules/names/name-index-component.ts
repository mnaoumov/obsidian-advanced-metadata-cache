import type { LinkSuggestion } from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  TAbstractFile
} from 'obsidian';

import {
  TFile,
  Vault
} from 'obsidian';
import { LayoutReadyComponent } from 'obsidian-dev-utils/obsidian/components/layout-ready-component';
import { isFolder } from 'obsidian-dev-utils/obsidian/file-system';
import { ensureMetadataCacheReady } from 'obsidian-dev-utils/obsidian/metadata-cache';

import type { PluginSettingsComponent } from '../../plugin-settings-component.ts';
import type { TitleIndex } from '../titles/title-index.ts';

import { NameIndex } from './name-index.ts';
import { MetadataCacheGetLinkSuggestionsPatchComponent } from './patches/metadata-cache-get-link-suggestions-patch-component.ts';

interface NameIndexComponentConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly titleIndex: TitleIndex;
}

/**
 * Owns the {@link NameIndex}'s lifecycle: builds it once the metadata cache can answer, then keeps it
 * honest by dropping what the vault changed under it.
 *
 * Split from the index the way `obsidian-alias-quick-switcher` splits `LabelIndex` from its component
 * — the index answers questions, the component decides when its answers stopped being true.
 */
export class NameIndexComponent extends LayoutReadyComponent {
  public readonly nameIndex: NameIndex;

  /**
   * Whether the eager build has happened.
   *
   * The patch reads this: until the index holds every file, the honest answer to
   * `getLinkSuggestions()` is Obsidian's own, so the patch defers to it rather than to a half-built
   * index that no event will ever be fired to complete.
   */
  public get isBuilt(): boolean {
    return this.isBuiltValue;
  }

  private buildPromise: null | Promise<void> = null;
  private isBuiltValue = false;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private shouldOfferTitlesInLinkSuggestions: boolean;
  private readonly titleIndex: TitleIndex;
  private titlePropertyNamesKey: string;

  public constructor(params: NameIndexComponentConstructorParams) {
    super(params.app);

    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.titleIndex = params.titleIndex;
    this.titlePropertyNamesKey = this.titleIndex.getTitlePropertyNames().join('\n');
    this.shouldOfferTitlesInLinkSuggestions = params.pluginSettingsComponent.settings.shouldOfferTitlesInLinkSuggestions;
    this.nameIndex = new NameIndex({
      app: params.app,
      pluginSettingsComponent: params.pluginSettingsComponent,
      titleIndex: params.titleIndex
    });
  }

  /**
   * Finds every note that answers to a name, building the index first when it is not built yet.
   *
   * @param name - A basename or alias, in any casing and spacing.
   * @returns The vault-relative paths of the notes carrying that name.
   */
  public async getPathsByNameSafe(name: string): Promise<string[]> {
    await this.ensureBuilt();
    return this.nameIndex.getPathsByName(name);
  }

  /**
   * Answers `getLinkSuggestions()` from the index, building it first when it is not built yet.
   *
   * @returns The link suggestions.
   */
  public async getSuggestionsSafe(): Promise<LinkSuggestion[]> {
    await this.ensureBuilt();
    return this.nameIndex.getSuggestions();
  }

  protected override async onLayoutReady(): Promise<void> {
    /*
     * Installed BEFORE the build, not after: while the index is empty the patch falls through to
     * Obsidian's implementation, so there is no window in which a caller gets an incomplete answer.
     */
    this.addChild(
      new MetadataCacheGetLinkSuggestionsPatchComponent({
        metadataCache: this.app.metadataCache,
        nameIndexComponent: this
      })
    );

    await this.ensureBuilt();

    this.registerEvent(this.app.metadataCache.on('changed', (file) => {
      this.nameIndex.refresh(file);
    }));

    /*
     * `unresolvedLinks` is Obsidian's, not this index's, and it supplies the `{ file: null }` half of
     * the suggestions. It moves whenever link resolution settles, with no `changed` for the files
     * whose links now resolve elsewhere — so the memo is dropped here and rebuilt on the next ask.
     */
    this.registerEvent(this.app.metadataCache.on('resolved', () => {
      this.nameIndex.invalidateSuggestions();
    }));

    this.registerEvent(this.app.vault.on('create', (abstractFile) => {
      this.refreshAbstractFile(abstractFile);
    }));

    this.registerEvent(this.app.vault.on('delete', (abstractFile) => {
      this.removeAbstractFile(abstractFile);
    }));

    this.registerEvent(this.app.vault.on('rename', (abstractFile, oldPath) => {
      this.handleRename(abstractFile, oldPath);
    }));

    /*
     * A title is a name, so changing WHICH properties are titles — or switching the `Titles` module off
     * — changes what every file in the vault is called, and no vault event says so. The whole index is
     * rebuilt, because that is what "every file's names may have moved" means.
     *
     * The comparison is against the `Titles` module's own answer, which is already gated on its toggle,
     * so both causes are one test. `ModulesComponent` registers its `saveSettings` listener when the
     * plugin adds it as a child — before any module component exists — so by the time this one runs the
     * titles module has already loaded or unloaded and dropped its memo.
     *
     * `shouldOfferTitlesInLinkSuggestions` rides the same listener and is deliberately the cheaper of
     * the two: see `handleTitlesOfferedChange`.
     */
    const eventRef = this.pluginSettingsComponent.on('saveSettings', () => {
      this.handleSaveSettings();
    });
    this.register(() => {
      this.pluginSettingsComponent.offref(eventRef);
    });
  }

  private async build(): Promise<void> {
    // An alias read before the cache can answer would be memoized as absent, and no later event
    // would say otherwise for a file Obsidian had already finished parsing.
    await ensureMetadataCacheReady(this.app);

    this.nameIndex.buildAll();
    this.isBuiltValue = true;
  }

  /**
   * Builds the index once, however many callers ask at once.
   *
   * The promise is kept rather than a done flag re-checked after the `await`: `onLayoutReady` and a
   * `safe` call from another plugin can both arrive while the metadata cache is still settling, and
   * two builds would be two full vault walks for one answer.
   *
   * @returns A {@link Promise} that resolves once the index holds every file.
   */
  private async ensureBuilt(): Promise<void> {
    this.buildPromise ??= this.build();
    await this.buildPromise;
  }

  private handleRename(abstractFile: TAbstractFile, oldPath: string): void {
    if (!isFolder(abstractFile)) {
      this.nameIndex.remove(oldPath);
      this.refreshAbstractFile(abstractFile);
      return;
    }

    /*
     * A folder rename changes every descendant's path and not one of their names, and Obsidian's
     * event order for the folder against its descendants is not a contract — each descendant may
     * fire its own `rename` too, before or after this one. So both sides of the move are dropped and
     * the folder's files are re-read from the live vault: the same state is reached whether this runs
     * before those events, after them, or twice.
     *
     * MEASURED (Obsidian 1.14.2): a folder rename DOES fire a `rename` per descendant, so this
     * branch is not what keeps today's Obsidian correct — the descendants' own events would.
     * `folder-rename-rekeying.desktop.integration.test.ts` records that sequence and goes red if it
     * ever changes; this branch is what makes the index survive it when it does, and the folder-only
     * order is pinned by `name-index-component.test.ts`.
     */
    this.nameIndex.removeSubtree(oldPath);
    this.nameIndex.removeSubtree(abstractFile.path);

    Vault.recurseChildren(abstractFile, (descendant) => {
      this.refreshAbstractFile(descendant);
    });
  }

  private handleSaveSettings(): void {
    this.handleTitlesOfferedChange();

    const titlePropertyNamesKey = this.titleIndex.getTitlePropertyNames().join('\n');

    if (this.titlePropertyNamesKey === titlePropertyNamesKey) {
      return;
    }

    this.titlePropertyNamesKey = titlePropertyNamesKey;

    // No readiness guard is needed: this listener is registered AFTER the eager build has finished, so
    // there is no window in which it can fire against an index that does not exist yet.
    this.nameIndex.buildAll();
  }

  /**
   * Drops the memoized suggestion array when `shouldOfferTitlesInLinkSuggestions` has been flipped.
   *
   * A MEMO drop rather than a rebuild, and that is the whole reason the index records a file's title
   * entries whatever the setting says: flipping it changes which of two already-known halves are
   * assembled, not what any file is called. A rebuild here would be a full vault walk for an answer
   * every file already holds.
   */
  private handleTitlesOfferedChange(): void {
    const shouldOfferTitlesInLinkSuggestions = this.pluginSettingsComponent.settings.shouldOfferTitlesInLinkSuggestions;

    if (this.shouldOfferTitlesInLinkSuggestions === shouldOfferTitlesInLinkSuggestions) {
      return;
    }

    this.shouldOfferTitlesInLinkSuggestions = shouldOfferTitlesInLinkSuggestions;
    this.nameIndex.invalidateSuggestions();
  }

  private refreshAbstractFile(abstractFile: TAbstractFile): void {
    if (abstractFile instanceof TFile) {
      this.nameIndex.refresh(abstractFile);
    }
  }

  private removeAbstractFile(abstractFile: TAbstractFile): void {
    if (isFolder(abstractFile)) {
      this.nameIndex.removeSubtree(abstractFile.path);
      return;
    }

    this.nameIndex.remove(abstractFile.path);
  }
}
