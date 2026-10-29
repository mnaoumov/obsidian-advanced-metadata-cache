import type {
  App,
  CachedMetadata,
  EmbedCache,
  LinkCache,
  TFile
} from 'obsidian';

import { LayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import { ensureMetadataCacheReady } from '@mnaoumov/obsidian-lib/metadata-cache';
import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import { noop } from '@mnaoumov/typescript-lib/function';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';

import type { PluginSettingsComponent } from '../../plugin-settings-component.ts';
import type { CodeBlockLanguages } from './code-block-languages.ts';
import type { CodeBlockReference } from './code-block-references.ts';

import { isPluginDataPath } from '../../persistence/storage-paths.ts';
import {
  findCodeBlockReferences,
  hasCodeSection,
  hasIncludedCodeBlock
} from './code-block-references.ts';

interface CodeBlockLinksComponentConstructorParams {
  readonly app: App;
  readonly codeBlockLanguages: CodeBlockLanguages;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * A note whose entry gained references.
 */
interface InjectedNote {
  readonly cache: CachedMetadata;
  readonly file: TFile;
}

/**
 * What was added to one cache entry, and what its arrays were before, so it can be put back exactly.
 */
interface Injection {
  readonly codeBlockReferences: readonly CodeBlockReference[];
  readonly originalEmbeds: EmbedCache[] | undefined;
  readonly originalLinks: LinkCache[] | undefined;
}

/**
 * The `Code block links` module: puts the links and embeds written inside whitelisted code blocks into the
 * cache entries Obsidian holds, so backlinks, outgoing links, the graph and rename updates find them like any
 * other reference.
 *
 * The references are added to the IN-MEMORY `CachedMetadata` object only, never through `saveMetaCache`, so
 * nothing of this module reaches Obsidian's persisted cache: Obsidian deep-copies an entry when it saves it,
 * before it fires `changed`, which is where this module starts. The entry's arrays are put back as they were
 * when the module is switched off or the language list changes. A note whose content another note shares
 * shares the entry too, which is right, since the same text holds the same links.
 *
 * The worker parse lands after Obsidian has already announced the note, so once an entry gains or loses
 * references the note is queued for link resolution again and `changed` is fired again with the same entry,
 * for every index that reads the cache on `changed` (this plugin's own backlinks included). This module
 * recognizes the entry it has already handled and ignores its own re-fire.
 */
export class CodeBlockLinksComponent extends LayoutReadyComponent {
  /**
   * Whether the startup pass over the vault has ended since the module was switched on.
   */
  public get isBuilt(): boolean {
    return this.isBuiltValue;
  }

  private readonly builtPromise: Promise<void>;
  private readonly codeBlockLanguages: CodeBlockLanguages;
  /**
   * Bumped whenever everything is put back, so a parse started before is dropped when it lands.
   */
  private generation = 0;
  /**
   * The notes whose entries gained references, by path.
   */
  private readonly injectedNotes = new Map<string, InjectedNote>();
  /**
   * Every entry already handled, with what it gained, which may be nothing.
   */
  private injections = new WeakMap<CachedMetadata, Injection>();
  private isBuiltValue = false;
  private languagesKey = '';
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private resolveBuiltPromise: () => void = noop;

  public constructor(params: CodeBlockLinksComponentConstructorParams) {
    super(params.app);

    this.codeBlockLanguages = params.codeBlockLanguages;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.builtPromise = new Promise<void>((resolve) => {
      this.resolveBuiltPromise = resolve;
    });
  }

  /**
   * The references this module added to a note.
   *
   * @param path - The note's path.
   * @returns The references, in the order they appear in the note; empty for a note with none.
   */
  public getCodeBlockReferences(path: string): CodeBlockReference[] {
    const file = this.app.vault.getFileByPath(path);
    if (!file) {
      return [];
    }

    const cache = this.app.metadataCache.getFileCache(file);
    return cache ? [...this.injections.get(cache)?.codeBlockReferences ?? []] : [];
  }

  public override onunload(): void {
    this.removeAll();
    // A caller still waiting is answered by the API, which answers `null` while the module is off.
    this.resolveBuiltPromise();
    super.onunload();
  }

  /**
   * Waits for the startup pass, or for the module to be switched off first.
   *
   * @returns A {@link Promise} that resolves once every note has been looked at.
   */
  public async waitForBuild(): Promise<void> {
    await this.builtPromise;
  }

  protected override async onLayoutReady(): Promise<void> {
    this.languagesKey = this.getLanguagesKey();

    // Registered BEFORE the pass waits for the cache: a note changed meanwhile is handled here, and the pass
    // then finds its entry already handled.
    this.registerEvent(this.app.metadataCache.on('changed', (file, data, cache) => {
      invokeAsyncSafely(async () => {
        await this.handleChanged(file, data, cache);
      });
    }));
    this.registerEvent(this.app.vault.on('rename', (_file, oldPath) => {
      // The note keeps its `TFile` and its entry; only the key moves.
      const injectedNote = this.injectedNotes.get(oldPath);
      if (!injectedNote) {
        return;
      }

      this.injectedNotes.delete(oldPath);
      this.injectedNotes.set(injectedNote.file.path, injectedNote);
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => {
      this.injectedNotes.delete(file.path);
    }));

    const settingsEventRef = this.pluginSettingsComponent.on('saveSettings', () => {
      this.handleLanguagesChanged();
    });
    this.register(() => {
      this.pluginSettingsComponent.offref(settingsEventRef);
    });
    this.register(this.codeBlockLanguages.onChange(() => {
      this.handleLanguagesChanged();
    }));

    await ensureMetadataCacheReady(this.app);
    await this.processAllNotes();

    if (this.isUnloaded()) {
      return;
    }

    this.isBuiltValue = true;
    this.resolveBuiltPromise();
  }

  private getLanguagesKey(): string {
    return JSON.stringify([this.pluginSettingsComponent.settings.codeBlockLinkLanguages, this.codeBlockLanguages.getRegisteredLanguages()]);
  }

  private async handleChanged(file: TFile, data: string, cache: CachedMetadata): Promise<void> {
    const injection = this.injections.get(cache);
    if (injection) {
      // This module's own re-fire, or a note whose content another handled note shares.
      this.track(file, cache, injection);
      return;
    }

    this.injectedNotes.delete(file.path);
    await this.processNote(file, data, cache);
  }

  private handleLanguagesChanged(): void {
    const languagesKey = this.getLanguagesKey();
    if (languagesKey === this.languagesKey) {
      return;
    }
    this.languagesKey = languagesKey;

    this.removeAll();
    invokeAsyncSafely(async () => {
      await this.processAllNotes();
    });
  }

  private hasAnyLanguage(): boolean {
    return this.pluginSettingsComponent.settings.codeBlockLinkLanguages.some((language) => language.trim() !== '')
      || this.codeBlockLanguages.getRegisteredLanguages().length > 0;
  }

  private inject(cache: CachedMetadata, codeBlockReferences: readonly CodeBlockReference[]): Injection {
    const injection: Injection = { codeBlockReferences, originalEmbeds: cache.embeds, originalLinks: cache.links };
    this.injections.set(cache, injection);

    const links = codeBlockReferences.filter((codeBlockReference) => !codeBlockReference.isEmbed).map((codeBlockReference) => codeBlockReference.reference);
    const embeds = codeBlockReferences.filter((codeBlockReference) => codeBlockReference.isEmbed).map((codeBlockReference) => codeBlockReference.reference);

    if (links.length > 0) {
      cache.links = sortByOffset([...cache.links ?? [], ...links]);
    }
    if (embeds.length > 0) {
      cache.embeds = sortByOffset([...cache.embeds ?? [], ...embeds]);
    }

    return injection;
  }

  private isLanguageIncluded(language: string): boolean {
    return this.codeBlockLanguages.isIncluded(this.pluginSettingsComponent.settings.codeBlockLinkLanguages, language);
  }

  private notifyChanged(file: TFile, data: string, cache: CachedMetadata): void {
    this.app.metadataCache.queueFileForLinkResolution(file);
    this.app.metadataCache.trigger('changed', file, data, cache);
  }

  private async processAllNotes(): Promise<void> {
    const generation = this.generation;
    if (!this.hasAnyLanguage()) {
      return;
    }

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (this.isUnloaded() || generation !== this.generation) {
        return;
      }

      const cache = this.app.metadataCache.getFileCache(file);
      // Only a note Obsidian lists a code section for is read at all.
      if (!cache || this.injections.has(cache) || !hasCodeSection(cache)) {
        continue;
      }

      // A note whose entry is behind its file is about to be parsed again, and its `changed` handles it.
      const fileInfo = this.app.metadataCache.getFileInfo(file.path);
      if (fileInfo?.mtime !== file.stat.mtime || fileInfo.size !== file.stat.size) {
        continue;
      }

      const data = await this.app.vault.cachedRead(file);
      if (this.app.metadataCache.getFileCache(file) !== cache) {
        continue;
      }

      await this.processNote(file, data, cache);
    }
  }

  private async processNote(file: TFile, data: string, cache: CachedMetadata): Promise<void> {
    // The plugin's own sync transport is generated data, never a note a user wrote.
    if (isPluginDataPath(file.path) || !this.hasAnyLanguage()) {
      return;
    }

    const isLanguageIncluded = this.isLanguageIncluded.bind(this);
    if (!hasIncludedCodeBlock({ cache, isLanguageIncluded, text: data })) {
      return;
    }

    const generation = this.generation;
    const codeBlockReferences = await findCodeBlockReferences({
      cache,
      isLanguageIncluded,
      parseMarkdown: async (markdown) => await this.app.metadataCache.computeMetadataAsync(new TextEncoder().encode(markdown).buffer) ?? null,
      text: data
    });

    if (this.isUnloaded() || generation !== this.generation) {
      return;
    }

    // Another note sharing the entry may have filled it meanwhile.
    const injection = this.injections.get(cache) ?? this.inject(cache, codeBlockReferences);

    // A note changed again meanwhile is handled by its own `changed`.
    if (this.app.metadataCache.getFileCache(file) !== cache) {
      return;
    }

    this.track(file, cache, injection);
    if (injection.codeBlockReferences.length > 0) {
      this.notifyChanged(file, data, cache);
    }
  }

  /**
   * Puts every entry's arrays back as they were, and announces each note that lost references.
   */
  private removeAll(): void {
    const injectedNotes = [...this.injectedNotes.values()];
    for (const { cache } of injectedNotes) {
      const injection = ensureNonNullable(this.injections.get(cache));
      restore(cache, injection);
    }

    this.injectedNotes.clear();
    this.injections = new WeakMap();
    this.generation++;

    for (const { cache, file } of injectedNotes) {
      invokeAsyncSafely(async () => {
        const data = await this.app.vault.cachedRead(file);
        this.notifyChanged(file, data, cache);
      });
    }
  }

  private track(file: TFile, cache: CachedMetadata, injection: Injection): void {
    if (injection.codeBlockReferences.length > 0) {
      this.injectedNotes.set(file.path, { cache, file });
    } else {
      this.injectedNotes.delete(file.path);
    }
  }
}

/**
 * Puts an entry's arrays back. A note sharing the entry with another is listed under both paths, and putting
 * it back twice gives the same arrays.
 *
 * @param cache - The entry.
 * @param injection - What was added to it.
 */
function restore(cache: CachedMetadata, injection: Injection): void {
  if (injection.originalLinks) {
    cache.links = injection.originalLinks;
  } else {
    delete cache.links;
  }

  if (injection.originalEmbeds) {
    cache.embeds = injection.originalEmbeds;
  } else {
    delete cache.embeds;
  }
}

function sortByOffset<T extends EmbedCache | LinkCache>(references: T[]): T[] {
  return references.sort((a, b) => a.position.start.offset - b.position.start.offset);
}
