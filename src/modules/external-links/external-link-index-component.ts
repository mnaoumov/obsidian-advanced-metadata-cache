import type { IndexedFileRecord } from '@mnaoumov/obsidian-lib/components/incremental-file-index-component';
import type { App } from 'obsidian';

import { IncrementalFileIndexComponent } from '@mnaoumov/obsidian-lib/components/incremental-file-index-component';
import { LayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import { ensureMetadataCacheReady } from '@mnaoumov/obsidian-lib/metadata-cache';
import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import { noop } from '@mnaoumov/typescript-lib/function';

import type { IndexStorage } from '../../persistence/index-storage.ts';
import type { ExternalLink } from '../../plugin-api.ts';

import { isPluginDataPath } from '../../persistence/storage-paths.ts';
import { ExternalLinkIndex } from './external-link-index.ts';
import { findExternalLinks } from './external-links.ts';
import {
  parsePersistedExternalLinks,
  stringifyPersistedExternalLinks
} from './persisted-external-links.ts';

interface ExternalLinkIndexComponentConstructorParams {
  readonly app: App;
  readonly storage?: IndexStorage;
}

/**
 * The `External links` module: keeps an {@link ExternalLinkIndex} current for as long as it is on.
 *
 * Obsidian's metadata cache holds no external link, so each note without a reusable record is read after the cache is ready, and then
 * followed through the text `changed` hands over after Obsidian parses it again; a note is never read twice for one
 * edit. The reads, the rename moves and the deletes are `@mnaoumov/obsidian-lib`'s `IncrementalFileIndexComponent`, the
 * `files` child. Between a note's `modify` and its `changed` its links are absent, as the child drops a record it
 * knows to be stale.
 *
 * The index is the component's own, as `TagIndex` is: nothing subscribes to it. The reader restores valid records
 * with matching stats from device-local storage, and saves completed checkpoints on its debounce and unload.
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
      load: async (): Promise<ReadonlyMap<string, IndexedFileRecord<readonly ExternalLink[]>>> => parsePersistedExternalLinks(await params.storage?.read() ?? null),
      onRemove: (path): void => {
        this.externalLinkIndex.deletePath(path);
      },
      onSet: (path, links): void => {
        this.externalLinkIndex.setPath(path, links);
      },
      save: async (records): Promise<void> => {
        await params.storage?.write(stringifyPersistedExternalLinks(records));
      },
      shouldAwaitMetadataChange: (file): boolean => file.extension === 'md',
      // Links and their positions depend on the text alone.
      shouldMoveRecordsOnRename: true
    });
    // Children flush before registered cleanup runs; wait for that flush before closing the connection.
    this.register(() => {
      invokeAsyncSafely(async () => {
        try {
          await this.files.flush();
        } finally {
          await params.storage?.close?.();
        }
      });
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
