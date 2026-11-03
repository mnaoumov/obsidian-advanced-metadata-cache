import type { IndexedFileRecord } from '@mnaoumov/obsidian-lib/components/incremental-file-index-component';
import type { App } from 'obsidian';

import { IncrementalFileIndexComponent } from '@mnaoumov/obsidian-lib/components/incremental-file-index-component';
import { LayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import { ensureMetadataCacheReady } from '@mnaoumov/obsidian-lib/metadata-cache';
import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import { noop } from '@mnaoumov/typescript-lib/function';

import type { IndexStorage } from '../../persistence/index-storage.ts';
import type {
  HtmlDiagnostic,
  HtmlRange
} from '../../plugin-api.ts';

import { isPluginDataPath } from '../../persistence/storage-paths.ts';
import { findHtmlRanges } from './html-ranges.ts';
import { HtmlValidation } from './html-validation.ts';
import {
  parsePersistedHtmlRanges,
  stringifyPersistedHtmlRanges
} from './persisted-html.ts';

interface HtmlIndexComponentConstructorParams {
  readonly app: App;
  readonly storage?: IndexStorage;
}

/**
Owns incremental HTML candidates, shared validation and local checkpoints for one module lifetime.
*/
export class HtmlIndexComponent extends LayoutReadyComponent {
  /**
   * Whether the index has been built since the module was switched on.
   */
  public get isBuilt(): boolean {
    return this.isBuiltValue;
  }

  private readonly builtPromise: Promise<void>;

  private readonly files: IncrementalFileIndexComponent<readonly HtmlRange[]>;

  private isBuiltValue = false;
  private readonly ranges = new Map<string, readonly HtmlRange[]>();
  private resolveBuiltPromise: () => void = noop;
  private readonly validation = new HtmlValidation();

  public constructor(params: HtmlIndexComponentConstructorParams) {
    super(params.app);

    this.builtPromise = new Promise<void>((resolve) => {
      this.resolveBuiltPromise = resolve;
    });

    this.files = new IncrementalFileIndexComponent({
      // The plugin's own sync transport is generated data, never a note the user linked from.
      accepts: (file): boolean => file.extension === 'md' && !isPluginDataPath(file.path),
      app: this.app,
      indexFile: ({ content, file }): readonly HtmlRange[] => findHtmlRanges({ content, sections: this.app.metadataCache.getFileCache(file)?.sections ?? [] }),
      load: async (): Promise<ReadonlyMap<string, IndexedFileRecord<readonly HtmlRange[]>>> => parsePersistedHtmlRanges(await params.storage?.read() ?? null),
      onRemove: (path): void => {
        this.ranges.delete(path);
      },
      onSet: (path, links): void => {
        this.ranges.set(path, links);
      },
      save: async (records): Promise<void> => {
        await params.storage?.write(stringifyPersistedHtmlRanges(records));
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

  public getDiagnostics(path: string): HtmlDiagnostic[] | null {
    const ranges = this.ranges.get(path);
    return this.isBuiltValue && ranges ? this.validation.diagnose(ranges) : null;
  }

  public getRanges(path: string): HtmlRange[] | null {
    const ranges = this.ranges.get(path);
    return this.isBuiltValue && ranges ? ranges.map((range) => ({ ...range, position: { end: { ...range.position.end }, start: { ...range.position.start } } })) : null;
  }

  public override onunload(): void {
    this.ranges.clear();
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
