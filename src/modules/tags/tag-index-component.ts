import type {
  App,
  TAbstractFile
} from 'obsidian';

import { LayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import {
  isFolder,
  isMarkdownFile
} from '@mnaoumov/obsidian-lib/file-system';
import { ensureMetadataCacheReady } from '@mnaoumov/obsidian-lib/metadata-cache';
import { sleep } from '@mnaoumov/typescript-lib/async';
import { noop } from '@mnaoumov/typescript-lib/function';

import { isPluginDataPath } from '../../persistence/storage-paths.ts';
import {
  readTags,
  TagIndex
} from './tag-index.ts';

/**
 * How many notes the build reads before it yields to the event loop.
 */
export const BUILD_BATCH_SIZE = 500;

interface TagIndexComponentConstructorParams {
  readonly app: App;
}

/**
 * The `Tags` module: keeps a {@link TagIndex} current for as long as it is on.
 *
 * Built from the metadata cache Obsidian already holds, never from a note read, once that cache is ready; then kept
 * current by `changed`, which Obsidian fires after it parses a note again. A `delete` or `rename` is handled at once,
 * since Obsidian fires no `changed` for a note that only moved.
 *
 * The index is the component's own, unlike `LinkTextIndex`: nothing subscribes to it, so nothing needs it to outlive
 * the module. Nothing is persisted, because the build costs one pass over memory Obsidian already holds.
 */
export class TagIndexComponent extends LayoutReadyComponent {
  public readonly tagIndex = new TagIndex();

  /**
   * Whether the index has been built since the module was switched on.
   */
  public get isBuilt(): boolean {
    return this.isBuiltValue;
  }

  private readonly builtPromise: Promise<void>;
  private isBuiltValue = false;
  private resolveBuiltPromise: () => void = noop;

  public constructor(params: TagIndexComponentConstructorParams) {
    super(params.app);

    this.builtPromise = new Promise<void>((resolve) => {
      this.resolveBuiltPromise = resolve;
    });
  }

  public override onunload(): void {
    this.tagIndex.clear();
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
    this.registerEvent(this.app.metadataCache.on('changed', (file) => {
      this.refreshPath(file.path);
    }));

    this.registerEvent(this.app.vault.on('delete', (abstractFile) => {
      this.handlePathGone(abstractFile.path, isFolder(abstractFile), null);
    }));

    this.registerEvent(this.app.vault.on('rename', (abstractFile, oldPath) => {
      this.handlePathGone(oldPath, isFolder(abstractFile), abstractFile);
    }));

    await ensureMetadataCacheReady(this.app);

    if (this.isUnloaded()) {
      return;
    }

    // In batches, yielding between them, as the `Link texts` build does. A note changed, moved or deleted between two
    // batches is handled by its own event, and re-reading it here is harmless.
    const files = this.app.vault.getMarkdownFiles();
    for (let start = 0; start < files.length; start += BUILD_BATCH_SIZE) {
      if (start > 0) {
        await sleep({ milliseconds: 0 });
        if (this.isUnloaded()) {
          return;
        }
      }

      for (const file of files.slice(start, start + BUILD_BATCH_SIZE)) {
        this.refreshPath(file.path);
      }
    }

    this.isBuiltValue = true;
    this.resolveBuiltPromise();
  }

  /**
   * Drops what was at a path and, for a rename, carries it to the new one: a note's tags depend on its text alone,
   * which a rename does not touch. A folder's files each fire an event of their own too, in an order that is not a
   * contract; every step here is a no-op for a path already handled, so either order ends in the same state.
   *
   * @param oldPath - The path that was deleted, or renamed away from.
   * @param isFolderPath - Whether it is a folder's.
   * @param renamedTo - The file or folder at its new path, for a rename.
   */
  private handlePathGone(oldPath: string, isFolderPath: boolean, renamedTo: null | TAbstractFile): void {
    for (const path of this.tagIndex.getPaths(oldPath, isFolderPath)) {
      const newPath = renamedTo ? renamedTo.path + path.slice(oldPath.length) : null;
      const newFile = newPath === null ? null : this.app.vault.getFileByPath(newPath);

      // A note renamed to another extension is no note any more. One renamed TO a note's extension had no entry here
      // to carry; Obsidian parses it and fires `changed`.
      if (newPath !== null && newFile && isMarkdownFile(newFile) && !isPluginDataPath(newPath)) {
        this.tagIndex.movePath(path, newPath);
      } else {
        this.tagIndex.deletePath(path);
      }
    }
  }

  /**
   * Re-reads one note's tags from the metadata cache.
   *
   * @param path - The note's path.
   */
  private refreshPath(path: string): void {
    // The plugin's own sync transport is generated data, never a note the user tagged.
    if (isPluginDataPath(path)) {
      return;
    }

    const file = this.app.vault.getFileByPath(path);
    const cache = file && isMarkdownFile(file) ? this.app.metadataCache.getFileCache(file) : null;

    if (!cache) {
      this.tagIndex.deletePath(path);
      return;
    }

    this.tagIndex.setPath(path, readTags(cache));
  }
}
