import type { App } from 'obsidian';

import { IncrementalFileIndexComponent } from '@mnaoumov/obsidian-lib/components/incremental-file-index-component';
import { LayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import { ensureMetadataCacheReady } from '@mnaoumov/obsidian-lib/metadata-cache';
import {
  noop,
  noopAsync
} from '@mnaoumov/typescript-lib/function';

import type { ExternalLink } from '../../plugin-api.ts';

import { isPluginDataPath } from '../../persistence/storage-paths.ts';
import { ExternalLinkIndex } from './external-link-index.ts';
import { findExternalLinks } from './external-links.ts';

interface ExternalLinkIndexComponentConstructorParams {
  readonly app: App;
}

/**
 * The `External links` module: keeps an {@link ExternalLinkIndex} current for as long as it is on.
 *
 * Obsidian's metadata cache holds no external link, so every note is READ once, after the cache is ready, and then
 * followed through the text `changed` hands over after Obsidian parses it again; a note is never read twice for one
 * edit. The reads, the rename moves and the deletes are `@mnaoumov/obsidian-lib`'s `IncrementalFileIndexComponent`, the
 * `files` child. Between a note's `modify` and its `changed` its links are absent, as the child drops a record it
 * knows to be stale.
 *
 * The index is the component's own, as `TagIndex` is: nothing subscribes to it. Nothing is persisted yet, so each
 * switch-on reads every note.
 */
export class ExternalLinkIndexComponent extends LayoutReadyComponent {
  public readonly externalLinkIndex = new ExternalLinkIndex();

  /**
   * Whether the index has been built since the module was switched on.
   */
  public get isBuilt(): boolean {
    return this.isBuiltValue;
  }

  private readonly builtPromise: Promise<void>;
  private readonly files: IncrementalFileIndexComponent<readonly ExternalLink[]>;
  private isBuiltValue = false;
  private resolveBuiltPromise: () => void = noop;

  public constructor(params: ExternalLinkIndexComponentConstructorParams) {
    super(params.app);

    this.builtPromise = new Promise<void>((resolve) => {
      this.resolveBuiltPromise = resolve;
    });

    this.files = new IncrementalFileIndexComponent({
      // The plugin's own sync transport is generated data, never a note the user linked from.
      accepts: (file): boolean => file.extension === 'md' && !isPluginDataPath(file.path),
      app: this.app,
      indexFile: ({ content }): readonly ExternalLink[] => findExternalLinks(content),
      load: async (): Promise<ReadonlyMap<string, never>> => {
        await noopAsync();
        return new Map();
      },
      onRemove: (path): void => {
        this.externalLinkIndex.deletePath(path);
      },
      onSet: (path, links): void => {
        this.externalLinkIndex.setPath(path, links);
      },
      save: noopAsync,
      shouldAwaitMetadataChange: (file): boolean => file.extension === 'md',
      // Links and their positions depend on the text alone.
      shouldMoveRecordsOnRename: true
    });
  }

  public override onunload(): void {
    this.externalLinkIndex.clear();
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
    // Not competing with Obsidian's own startup parse, which reads the same notes.
    await ensureMetadataCacheReady(this.app);
    if (this.isUnloaded()) {
      return;
    }

    this.addChild(this.files);
    // The child starts loading inside addChild; loading it again after an unload there would restart it.
    if (this.isUnloaded()) {
      return;
    }
    await this.files.loadWithPromises();

    if (this.isUnloaded()) {
      return;
    }

    this.isBuiltValue = true;
    this.resolveBuiltPromise();
  }
}
