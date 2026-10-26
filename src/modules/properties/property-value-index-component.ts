import type {
  App,
  Debouncer,
  TAbstractFile
} from 'obsidian';

import { LayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import { isFolder } from '@mnaoumov/obsidian-lib/file-system';
import { ensureMetadataCacheReady } from '@mnaoumov/obsidian-lib/metadata-cache';
import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import { noop } from '@mnaoumov/typescript-lib/function';
import { debounce } from 'obsidian';

import type { PropertyValueIndex } from './property-value-index.ts';

interface PropertyValueIndexComponentConstructorParams {
  readonly app: App;
  readonly propertyValueIndex: PropertyValueIndex;
}

/**
 * How long changes are gathered before the index is written to disk. Not reset by each change, so a vault
 * edited without pause is still saved this often.
 */
export const SAVE_DEBOUNCE_IN_MILLISECONDS = 5000;

/**
 * The `Properties` module: keeps the {@link PropertyValueIndex} current for as long as it is on.
 *
 * On layout ready it loads the saved index, which answers at once, then rebuilds it from the metadata cache
 * once that is ready — a read of the cache Obsidian already holds for each note, never of the note itself —
 * and then follows the vault's own events. The `Safe` answers wait for that rebuild. The index is written
 * to disk on a debounce and once more when the module is switched off, and its values are cleared from
 * memory at both edges, since nothing keeps them current while the module is off.
 */
export class PropertyValueIndexComponent extends LayoutReadyComponent {
  /**
   * Whether the index has been rebuilt from the metadata cache since the module was switched on.
   */
  public get isBuilt(): boolean {
    return this.isBuiltValue;
  }

  private readonly builtPromise: Promise<void>;
  private isBuiltValue = false;
  private isLoaded = false;
  private readonly propertyValueIndex: PropertyValueIndex;
  private readonly requestSave: Debouncer<[], void>;
  private resolveBuiltPromise: () => void = noop;

  public constructor(params: PropertyValueIndexComponentConstructorParams) {
    super(params.app);

    this.propertyValueIndex = params.propertyValueIndex;
    this.builtPromise = new Promise<void>((resolve) => {
      this.resolveBuiltPromise = resolve;
    });
    this.requestSave = debounce(() => {
      invokeAsyncSafely(() => this.propertyValueIndex.save());
    }, SAVE_DEBOUNCE_IN_MILLISECONDS);
  }

  public override onunload(): void {
    this.requestSave.cancel();

    // Not before the load: what a registration made dirty is a names-only state that would overwrite the file.
    if (this.isLoaded && this.propertyValueIndex.isDirty) {
      // `save` serializes before its first `await`, so clearing straight after it still saves this state.
      invokeAsyncSafely(() => this.propertyValueIndex.save());
    }

    this.propertyValueIndex.clear();
    // A caller still waiting is answered by the index, which answers `null` while the module is off.
    this.resolveBuiltPromise();
    super.onunload();
  }

  /**
   * Starts indexing a property. While the index is already built, the new property is filled from the
   * metadata cache at once, so the next answer is complete; before that, the rebuild fills it.
   *
   * @param propertyName - The property name.
   */
  public registerPropertyName(propertyName: string): void {
    if (!this.propertyValueIndex.register(propertyName)) {
      return;
    }

    // Before the build, the build fills it and saves: a save before the load would overwrite the file.
    if (!this.isBuiltValue) {
      return;
    }

    this.refreshAll();
    this.requestSave();
  }

  /**
   * Waits for the rebuild from the metadata cache, or for the module to be switched off first.
   *
   * @returns A {@link Promise} that resolves once the index is built.
   */
  public async waitForBuild(): Promise<void> {
    await this.builtPromise;
  }

  protected override async onLayoutReady(): Promise<void> {
    await this.propertyValueIndex.load();

    if (this.isUnloaded()) {
      return;
    }

    this.isLoaded = true;

    /*
     * Registered BEFORE the rebuild, which awaits the metadata cache: a `changed` arriving meanwhile is
     * already the newer answer, and the rebuild reading the same cache afterwards agrees with it.
     */
    this.registerEvent(this.app.metadataCache.on('changed', (file, _data, cache) => {
      this.propertyValueIndex.refresh({ frontmatter: cache.frontmatter, path: file.path });
      this.requestSave();
    }));

    this.registerEvent(this.app.vault.on('delete', (abstractFile) => {
      this.handleDelete(abstractFile);
    }));

    this.registerEvent(this.app.vault.on('rename', (abstractFile, oldPath) => {
      this.handleRename(abstractFile, oldPath);
    }));

    await ensureMetadataCacheReady(this.app);

    if (this.isUnloaded()) {
      return;
    }

    this.refreshAll();
    this.isBuiltValue = true;
    this.resolveBuiltPromise();
    this.requestSave();
  }

  private handleDelete(abstractFile: TAbstractFile): void {
    if (isFolder(abstractFile)) {
      this.propertyValueIndex.deleteSubtree(abstractFile.path);
    } else {
      this.propertyValueIndex.delete(abstractFile.path);
    }

    this.requestSave();
  }

  /**
   * Moves a renamed note's values with it. A folder's descendants each fire a `rename` of their own too,
   * in an order that is not a contract; the subtree move here and the per-file moves are each a no-op for
   * a path already moved, so the same state is reached in either order.
   *
   * @param abstractFile - The file or folder, at its new path.
   * @param oldPath - The path it had.
   */
  private handleRename(abstractFile: TAbstractFile, oldPath: string): void {
    if (isFolder(abstractFile)) {
      this.propertyValueIndex.renameSubtree(oldPath, abstractFile.path);
    } else {
      this.propertyValueIndex.rename(oldPath, abstractFile.path);
    }

    this.requestSave();
  }

  /**
   * Reads every note's registered properties from the metadata cache, and forgets the notes that are gone.
   */
  private refreshAll(): void {
    const files = this.app.vault.getMarkdownFiles();
    this.propertyValueIndex.retain(new Set(files.map((file) => file.path)));

    for (const file of files) {
      this.propertyValueIndex.refresh({ frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter, path: file.path });
    }
  }
}
