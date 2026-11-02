import type {
  App,
  CachedMetadata,
  TAbstractFile,
  TFile
} from 'obsidian';

import { LayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import { MonkeyAroundComponent } from '@mnaoumov/obsidian-lib/components/monkey-around-component';
import { isFile } from '@mnaoumov/obsidian-lib/file-system';
import {
  ensureMetadataCacheReady,
  getReferences
} from '@mnaoumov/obsidian-lib/metadata-cache';
import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import { noopAsync } from '@mnaoumov/typescript-lib/function';

import type { PluginSettingsComponent } from '../../plugin-settings-component.ts';
import type { MetadataParsers } from './metadata-parsers.ts';

import { isPluginDataPath } from '../../persistence/storage-paths.ts';
import { normalizeMetadataExtension } from './metadata-parsers.ts';

interface NonMarkdownComponentConstructorParams {
  readonly app: App;
  readonly metadataParsers: MetadataParsers;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

interface ParseAttempt {
  readonly file: TFile;
  readonly generation: number;
  readonly path: string;
  readonly revision: symbol;
}

/**
Supplies core metadata without putting a synthetic hash into Obsidian's persisted cache.
*/
export class NonMarkdownComponent extends LayoutReadyComponent {
  private readonly caches = new Map<string, CachedMetadata>();
  private generation = 0;
  private hasCoreMetadata = false;
  private readonly metadataParsers: MetadataParsers;
  private pending = noopAsync();
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly revisions = new Map<string, symbol>();
  private settingsKey = '';

  public constructor(params: NonMarkdownComponentConstructorParams) {
    super(params.app);
    this.metadataParsers = params.metadataParsers;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  public override onunload(): void {
    this.clear();
    super.onunload();
  }

  protected override async onLayoutReady(): Promise<void> {
    const patches = this.addChild(new MonkeyAroundComponent());
    const metadataCache = this.app.metadataCache;
    patches.registerMethodPatch({
      $object: metadataCache,
      methodName: 'getCache',
      patchHandler: ({ fallback, originalArguments: [path] }) => {
        const cache = this.caches.get(path);
        const original = fallback();
        return !cache || (original && Object.keys(original).length > 0) ? original : cache;
      }
    });
    patches.registerMethodPatch({
      $object: metadataCache,
      methodName: 'iterateAllRefs',
      patchHandler: ({ fallback, originalArguments: [callback] }) => {
        fallback();
        for (const [path, cache] of this.caches) {
          if (metadataCache.getCache(path) === cache) {
            for (const reference of getReferences({ cache })) {
              callback(path, reference);
            }
          }
        }
      }
    });
    patches.registerMethodPatch({
      $object: metadataCache,
      methodName: 'iterateFileCache',
      patchHandler: ({ fallback, originalArguments: [callback] }) => {
        fallback();
        for (const [path, cache] of this.caches) {
          if (!metadataCache.isUserIgnored(path) && metadataCache.getCache(path) === cache) {
            callback(path, cache);
          }
        }
      }
    });

    this.registerEvent(this.app.vault.on('create', (file) => {
      this.enqueue(file);
    }));
    this.registerEvent(this.app.vault.on('modify', (file) => {
      this.enqueue(file);
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => {
      this.revisions.delete(file.path);
      this.caches.delete(file.path);
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.revisions.delete(oldPath);
      this.caches.delete(oldPath);
      this.enqueue(file);
    }));
    this.register(this.metadataParsers.onChange(() => {
      this.rebuild();
    }));
    this.settingsKey = JSON.stringify(this.pluginSettingsComponent.settings.markdownFileExtensions);
    const settingsEvent = this.pluginSettingsComponent.on('saveSettings', () => {
      const settingsKey = JSON.stringify(this.pluginSettingsComponent.settings.markdownFileExtensions);
      if (settingsKey === this.settingsKey) {
        return;
      }

      this.settingsKey = settingsKey;
      this.rebuild();
    });
    this.register(() => {
      this.pluginSettingsComponent.offref(settingsEvent);
    });
    await ensureMetadataCacheReady(this.app);
    if (this.isUnloaded()) {
      return;
    }

    this.hasCoreMetadata = true;
    this.rebuild();
  }

  private clear(): void {
    this.generation++;
    this.revisions.clear();
    const paths = [...this.caches.keys()];
    this.caches.clear();
    for (const path of paths) {
      const file = this.app.vault.getFileByPath(path);
      if (file) {
        this.notify(file, '', this.app.metadataCache.getFileCache(file) ?? {});
      }
    }
  }

  private enqueue(file: TAbstractFile): void {
    if (!this.hasCoreMetadata || !isFile(file) || !this.isIncluded(file) || this.isUnloaded()) {
      return;
    }
    const path = file.path;
    const generation = this.generation;
    const revision = Symbol('metadata parse');
    const { mtime, size } = file.stat;
    this.revisions.set(path, revision);
    this.pending = this.pending.then(async () => {
      if (!this.isCurrent({ file, generation, path, revision })) {
        return;
      }
      const content = await this.app.vault.cachedRead(file);
      const parser = this.metadataParsers.getRegistration(file.extension)?.parser;
      const cache = parser
        ? await parser({ content, file })
        : await this.app.metadataCache.computeMetadataAsync(new TextEncoder().encode(content).buffer);
      if (!this.isCurrent({ file, generation, path, revision }) || file.stat.mtime !== mtime || file.stat.size !== size) {
        return;
      }
      if (cache) {
        this.caches.set(path, cache);
      } else {
        this.caches.delete(path);
      }
      this.notify(file, content, this.app.metadataCache.getFileCache(file) ?? {});
    }).catch((error: unknown) => {
      if (this.isCurrent({ file, generation, path, revision })) {
        this.caches.delete(path);
        this.notify(file, '', this.app.metadataCache.getFileCache(file) ?? {});
      }
      console.error('Non-Markdown metadata parsing failed', path, error);
    });
  }

  private isCurrent(params: ParseAttempt): boolean {
    return !this.isUnloaded() && params.generation === this.generation && this.revisions.get(params.path) === params.revision
      && params.file.path === params.path && this.app.vault.getFileByPath(params.path) === params.file;
  }

  private isIncluded(file: TFile): boolean {
    return !(!normalizeMetadataExtension(file.extension) || isPluginDataPath(file.path)) && (this.metadataParsers.getRegistration(file.extension) !== null
      || this.pluginSettingsComponent.settings.markdownFileExtensions.some((extension) => normalizeMetadataExtension(extension) === file.extension.toLowerCase()));
  }

  private notify(file: TFile, content: string, cache: CachedMetadata): void {
    this.app.metadataCache.queueFileForLinkResolution(file);
    this.app.metadataCache.trigger('changed', file, content, cache);
  }

  private rebuild(): void {
    if (!this.hasCoreMetadata) {
      return;
    }
    this.clear();
    for (const file of this.app.vault.getFiles()) {
      this.enqueue(file);
    }
    invokeAsyncSafely(async () => {
      await this.pending;
    });
  }
}
