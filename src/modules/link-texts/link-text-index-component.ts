import type {
  App,
  Reference,
  TAbstractFile,
  TFile
} from 'obsidian';

import { LayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import {
  isFolder,
  isMarkdownFile
} from '@mnaoumov/obsidian-lib/file-system';
import { extractReferenceFile } from '@mnaoumov/obsidian-lib/link';
import { ensureMetadataCacheReady } from '@mnaoumov/obsidian-lib/metadata-cache';
import { noop } from '@mnaoumov/typescript-lib/function';

import type { LinkTextIndex } from './link-text-index.ts';

import { isPluginDataPath } from '../../persistence/storage-paths.ts';
import { readLinkTexts } from './link-texts.ts';

interface LinkTextIndexComponentConstructorParams {
  readonly app: App;
  readonly linkTextIndex: LinkTextIndex;
}

/**
 * The `Link texts` module: keeps the {@link LinkTextIndex} current for as long as it is on.
 *
 * Built from the metadata cache Obsidian already holds, never from a note read, once that cache is ready; then
 * kept current by `resolve`, which Obsidian fires for a note each time it resolves the note's links: after the note
 * changed, and after a file its links name was created, renamed or deleted. A `delete` or `rename` is handled here
 * as well, at once, so a note that moved or went away stops contributing before Obsidian gets round to it.
 *
 * Nothing is persisted: the build reads only what is already in memory. The index is cleared at both edges, since
 * nothing keeps it current while the module is off, and each clear and the end of the build tell the listeners
 * that everything may have changed.
 */
export class LinkTextIndexComponent extends LayoutReadyComponent {
  /**
   * Whether the index has been built since the module was switched on.
   */
  public get isBuilt(): boolean {
    return this.isBuiltValue;
  }

  private readonly builtPromise: Promise<void>;
  private isBuiltValue = false;
  private readonly linkTextIndex: LinkTextIndex;
  private resolveBuiltPromise: () => void = noop;

  public constructor(params: LinkTextIndexComponentConstructorParams) {
    super(params.app);

    this.linkTextIndex = params.linkTextIndex;
    this.builtPromise = new Promise<void>((resolve) => {
      this.resolveBuiltPromise = resolve;
    });
  }

  public override onload(): void {
    this.linkTextIndex.clear();
    super.onload();
  }

  public override onunload(): void {
    this.linkTextIndex.clear();
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
    // Registered BEFORE the build waits for the cache: a note resolved meanwhile is read again by the build, and
    // reading it twice gives the same answer.
    this.registerEvent(this.app.metadataCache.on('resolve', (file) => {
      this.linkTextIndex.notify(this.refreshSource(file.path));
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

    for (const file of this.app.vault.getMarkdownFiles()) {
      this.refreshSource(file.path);
    }

    this.isBuiltValue = true;
    this.resolveBuiltPromise();
    this.linkTextIndex.notify(null);
  }

  /**
   * Drops what was at a path, and re-reads every note whose links pointed there, which now resolve elsewhere or
   * nowhere. A folder's files each fire an event of their own too, in an order that is not a contract; every step
   * here is a no-op for a path already handled, so either order ends in the same state.
   *
   * @param oldPath - The path that was deleted, or renamed away from.
   * @param isFolderPath - Whether it is a folder's.
   * @param renamedTo - The file or folder at its new path, for a rename.
   */
  private handlePathGone(oldPath: string, isFolderPath: boolean, renamedTo: null | TAbstractFile): void {
    const changedTargetPaths = new Set<string>();
    const movedSourcePaths = this.linkTextIndex.getSourcePaths(oldPath, isFolderPath);
    const linkingSourcePaths = this.linkTextIndex.getSourcePathsLinkingTo(oldPath, isFolderPath);

    for (const sourcePath of movedSourcePaths) {
      addAll(changedTargetPaths, this.linkTextIndex.deleteSource(sourcePath));
    }

    const sourcePathsToRead = new Set(linkingSourcePaths.filter((sourcePath) => !movedSourcePaths.includes(sourcePath)));

    if (renamedTo) {
      for (const sourcePath of movedSourcePaths) {
        sourcePathsToRead.add(renamedTo.path + sourcePath.slice(oldPath.length));
      }
    }

    for (const sourcePath of sourcePathsToRead) {
      addAll(changedTargetPaths, this.refreshSource(sourcePath));
    }

    this.linkTextIndex.notify([...changedTargetPaths]);
  }

  /**
   * Re-reads one note's contributions from the metadata cache.
   *
   * @param sourcePath - The note's path.
   * @returns The target paths whose texts changed.
   */
  private refreshSource(sourcePath: string): string[] {
    // The plugin's own sync transport is generated data, never a name a user gave anything.
    if (isPluginDataPath(sourcePath)) {
      return [];
    }

    const file = this.app.vault.getFileByPath(sourcePath);
    const cache = file && isMarkdownFile(file) ? this.app.metadataCache.getFileCache(file) : null;

    if (!file || !cache) {
      return this.linkTextIndex.deleteSource(sourcePath);
    }

    return this.linkTextIndex.setSource(
      sourcePath,
      readLinkTexts({
        cache,
        resolveTargetPath: (reference) => resolveTargetPath(this.app, reference, file)
      })
    );
  }
}

function addAll(set: Set<string>, values: readonly string[]): void {
  for (const value of values) {
    set.add(value);
  }
}

function resolveTargetPath(app: App, reference: Reference, sourceFile: TFile): null | string {
  return extractReferenceFile({ app, reference, sourcePathOrFile: sourceFile })?.path ?? null;
}
