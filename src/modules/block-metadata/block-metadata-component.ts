import type {
  App,
  CachedMetadata,
  TAbstractFile,
  TFile
} from 'obsidian';

import { LayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import {
  isFolder,
  isMarkdownFile
} from '@mnaoumov/obsidian-lib/file-system';
import { ensureMetadataCacheReady } from '@mnaoumov/obsidian-lib/metadata-cache';
import { noop } from '@mnaoumov/typescript-lib/function';

import type { BlockMetadataIndex } from './block-metadata-index.ts';

import { isPluginDataPath } from '../../persistence/storage-paths.ts';
import {
  findBlockMetadata,
  hasCodeSection
} from './block-metadata-parser.ts';

interface BlockMetadataComponentConstructorParams {
  readonly app: App;
  readonly blockMetadataIndex: BlockMetadataIndex;
}

/**
 * The `Block metadata` module: keeps the plugin's {@link BlockMetadataIndex} current for as long as it is on.
 *
 * Built once the metadata cache is ready, reading only the notes whose cache lists a `code` section, since a metadata
 * fence is one; then kept current by `changed`, which hands over the note's text, so an edit reads nothing. A `delete`
 * or `rename` is handled at once, since Obsidian fires no `changed` for a note that only moved. Nothing is persisted:
 * the build reads the same notes `Code block links` reads.
 */
export class BlockMetadataComponent extends LayoutReadyComponent {
  /**
   * Whether the index has been built since the module was switched on.
   */
  public get isBuilt(): boolean {
    return this.isBuiltValue;
  }

  private readonly blockMetadataIndex: BlockMetadataIndex;
  private readonly builtPromise: Promise<void>;
  private isBuiltValue = false;
  private resolveBuiltPromise: () => void = noop;

  public constructor(params: BlockMetadataComponentConstructorParams) {
    super(params.app);

    this.blockMetadataIndex = params.blockMetadataIndex;
    this.builtPromise = new Promise<void>((resolve) => {
      this.resolveBuiltPromise = resolve;
    });
  }

  public override onunload(): void {
    this.blockMetadataIndex.clear();
    // A caller still waiting is answered by the API, which answers `null` while the module is off.
    this.resolveBuiltPromise();
    super.onunload();
  }

  /**
   * Waits for the build, or for the module to be switched off first.
   *
   * @returns A {@link Promise} that resolves once the index is built.
   */
  public async waitForBuild(): Promise<void> {
    await this.builtPromise;
  }

  protected override async onLayoutReady(): Promise<void> {
    // Registered BEFORE the build waits for the cache: a note parsed meanwhile is read again by the build, and reading
    // it twice gives the same answer.
    this.registerEvent(this.app.metadataCache.on('changed', (file, data, cache) => {
      this.processNote(file, data, cache);
    }));

    this.registerEvent(this.app.vault.on('delete', (abstractFile) => {
      this.handlePathGone(abstractFile.path, isFolder(abstractFile), null);
    }));

    this.registerEvent(this.app.vault.on('rename', (abstractFile, oldPath) => {
      this.handlePathGone(oldPath, isFolder(abstractFile), abstractFile);
    }));

    await ensureMetadataCacheReady(this.app);

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (this.isUnloaded()) {
        return;
      }

      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache || !hasCodeSection(cache)) {
        continue;
      }

      const data = await this.app.vault.cachedRead(file);
      // A note parsed again meanwhile was handled by its own `changed`, from text that matches its entry.
      if (this.isUnloaded() || this.app.metadataCache.getFileCache(file) !== cache) {
        continue;
      }

      this.processNote(file, data, cache);
    }

    if (this.isUnloaded()) {
      return;
    }

    this.isBuiltValue = true;
    this.resolveBuiltPromise();
    this.blockMetadataIndex.notify(null);
  }

  /**
   * Drops what was at a path and, for a rename, carries it to the new one. A folder's files each fire an event of their
   * own too, in an order that is not a contract; every step here is a no-op for a path already handled.
   *
   * @param oldPath - The path that was deleted, or renamed away from.
   * @param isFolderPath - Whether it is a folder's.
   * @param renamedTo - The file or folder at its new path, for a rename.
   */
  private handlePathGone(oldPath: string, isFolderPath: boolean, renamedTo: null | TAbstractFile): void {
    for (const path of this.blockMetadataIndex.getPaths(oldPath, isFolderPath)) {
      const newPath = renamedTo ? renamedTo.path + path.slice(oldPath.length) : null;
      const newFile = newPath === null ? null : this.app.vault.getFileByPath(newPath);

      if (newPath !== null && newFile && isMarkdownFile(newFile) && !isPluginDataPath(newPath)) {
        this.blockMetadataIndex.movePath(path, newPath);
      } else {
        this.blockMetadataIndex.deletePath(path);
      }
    }
  }

  private processNote(file: TFile, data: string, cache: CachedMetadata): void {
    // The plugin's own sync transport is generated data, never a note a user wrote.
    if (!isMarkdownFile(file) || isPluginDataPath(file.path)) {
      return;
    }

    this.blockMetadataIndex.setPath(file.path, findBlockMetadata({ cache, text: data }));
  }
}
