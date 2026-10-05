import type {
  App,
  CachedMetadata,
  Debouncer,
  TAbstractFile,
  TFile
} from 'obsidian';

import {
  debounce,
  MarkdownView
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { LayoutReadyComponent } from 'obsidian-dev-utils/obsidian/components/layout-ready-component';
import {
  isFile,
  isFolder,
  isMarkdownFile
} from 'obsidian-dev-utils/obsidian/file-system';
import { ensureMetadataCacheReady } from 'obsidian-dev-utils/obsidian/metadata-cache';

import type { HeadingTimesIndex } from './heading-times-index.ts';
import type { VisibleLineRange } from './visible-lines.ts';

import { readHeadingSnapshots } from './heading-snapshot.ts';
import { getVisibleLineRange } from './visible-lines.ts';

interface HeadingTimesComponentConstructorParams {
  readonly app: App;
  readonly headingTimesIndex: HeadingTimesIndex;
}

interface HeadingTimesComponentRecordNowParams {
  readonly cache: CachedMetadata | null;
  readonly content: string;
  readonly file: TFile;
  readonly time: number;
}

/**
 * How often the active editor is looked at for the `seen` time. A heading counts as seen once it has been
 * on screen at two polls in a row, so this is also the dwell: a section scrolled past faster than this is
 * not read, and is not stamped.
 */
export const SEEN_POLL_INTERVAL_IN_MILLISECONDS = 2000;

/**
 * How long changes are gathered before the index is written to disk. Not reset by each change, so a note
 * edited without pause is still saved this often.
 */
export const SAVE_DEBOUNCE_IN_MILLISECONDS = 5000;

/**
 * The `Headings` module: keeps the {@link HeadingTimesIndex} current for as long as it is on.
 *
 * On layout ready it loads the saved index, then catches up with what changed while nothing was watching —
 * a tracked note whose `mtime` moved is re-read and diffed, stamped with that `mtime`, the best time known
 * for a change nobody saw — and then follows the vault's own events. The index is written to disk on a
 * debounce and once more when the module is switched off, and is cleared from memory at both edges like the
 * title index, since nothing keeps it current while the module is off.
 */
export class HeadingTimesComponent extends LayoutReadyComponent {
  private readonly headingTimesIndex: HeadingTimesIndex;
  private previousVisibleLineRange: null | VisibleLineRange = null;
  private readonly requestSave: Debouncer<[], void>;

  public constructor(params: HeadingTimesComponentConstructorParams) {
    super(params.app);

    this.headingTimesIndex = params.headingTimesIndex;
    this.requestSave = debounce(() => {
      invokeAsyncSafely(() => this.headingTimesIndex.save());
    }, SAVE_DEBOUNCE_IN_MILLISECONDS);
  }

  public override onunload(): void {
    this.requestSave.cancel();

    if (this.headingTimesIndex.isDirty) {
      // `save` serializes before its first `await`, so clearing straight after it still saves this state.
      invokeAsyncSafely(() => this.headingTimesIndex.save());
    }

    this.headingTimesIndex.clear();
    super.onunload();
  }

  protected override async onLayoutReady(): Promise<void> {
    await this.headingTimesIndex.load();

    if (this.isUnloaded()) {
      return;
    }

    /*
     * Registered BEFORE the catch-up, which awaits a read per note: a `changed` arriving during it is the
     * newer answer, and the catch-up checks the `mtime` again after its read so it never overwrites one.
     */
    this.registerEvent(this.app.metadataCache.on('changed', (file, content, cache) => {
      this.recordNow({ cache, content, file, time: Date.now() });
    }));

    this.registerEvent(this.app.vault.on('create', (abstractFile) => {
      if (!(isFile(abstractFile) && isMarkdownFile(abstractFile))) {
        return;
      }

      this.headingTimesIndex.trackEmpty(abstractFile.path, abstractFile.stat.mtime);
      this.requestSave();
    }));

    this.registerEvent(this.app.vault.on('delete', (abstractFile) => {
      this.handleDelete(abstractFile);
    }));

    this.registerEvent(this.app.vault.on('rename', (abstractFile, oldPath) => {
      this.handleRename(abstractFile, oldPath);
    }));

    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      if (file) {
        invokeAsyncSafely(() => this.track(file));
      }
    }));

    this.registerInterval(window.setInterval(() => {
      this.pollSeen();
    }, SEEN_POLL_INTERVAL_IN_MILLISECONDS));

    await ensureMetadataCacheReady(this.app);
    await this.catchUp();

    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      if (leaf.view instanceof MarkdownView && leaf.view.file) {
        await this.track(leaf.view.file);
      }
    }
  }

  /**
   * Re-reads every tracked note that changed while nothing was watching, and forgets every tracked note
   * that is gone. A note renamed while nothing was watching is among the gone: the move cannot be told from
   * a deletion, so it starts again from its next open.
   */
  private async catchUp(): Promise<void> {
    for (const path of this.headingTimesIndex.getPaths()) {
      const file = this.app.vault.getFileByPath(path);

      if (!file) {
        this.headingTimesIndex.delete(path);
        this.requestSave();
        continue;
      }

      if (this.headingTimesIndex.get(path)?.mtime === file.stat.mtime) {
        continue;
      }

      const content = await this.app.vault.cachedRead(file);

      if (this.isUnloaded() || this.headingTimesIndex.get(path)?.mtime === file.stat.mtime) {
        continue;
      }

      this.recordNow({ cache: this.app.metadataCache.getFileCache(file), content, file, time: file.stat.mtime });
    }
  }

  private handleDelete(abstractFile: TAbstractFile): void {
    if (isFolder(abstractFile)) {
      this.headingTimesIndex.deleteSubtree(abstractFile.path);
    } else {
      this.headingTimesIndex.delete(abstractFile.path);
    }

    this.requestSave();
  }

  /**
   * Moves a renamed note's history with it. A folder's descendants each fire a `rename` of their own too,
   * in an order that is not a contract; the subtree move here and the per-file moves are each a no-op for
   * a path already moved, so the same state is reached in either order.
   *
   * @param abstractFile - The file or folder, at its new path.
   * @param oldPath - The path it had.
   */
  private handleRename(abstractFile: TAbstractFile, oldPath: string): void {
    if (isFolder(abstractFile)) {
      this.headingTimesIndex.renameSubtree(oldPath, abstractFile.path);
    } else {
      this.headingTimesIndex.rename(oldPath, abstractFile.path);
    }

    this.requestSave();
  }

  /**
   * Stamps the headings on screen at this poll and the previous one, in the same note.
   */
  private pollSeen(): void {
    const visibleLineRange = getVisibleLineRange(this.app);
    const previousVisibleLineRange = this.previousVisibleLineRange;
    this.previousVisibleLineRange = visibleLineRange;

    if (!visibleLineRange || previousVisibleLineRange?.path !== visibleLineRange.path) {
      return;
    }

    const fromLine = Math.max(visibleLineRange.fromLine, previousVisibleLineRange.fromLine);
    const toLine = Math.min(visibleLineRange.toLine, previousVisibleLineRange.toLine);

    if (fromLine > toLine || !this.headingTimesIndex.get(visibleLineRange.path)) {
      return;
    }

    this.headingTimesIndex.markSeen({ fromLine, path: visibleLineRange.path, time: Date.now(), toLine });
    this.requestSave();
  }

  private recordNow(params: HeadingTimesComponentRecordNowParams): void {
    const { cache, content, file, time } = params;
    this.headingTimesIndex.record({
      mtime: file.stat.mtime,
      path: file.path,
      snapshots: readHeadingSnapshots(content, cache?.headings),
      time
    });
    this.requestSave();
  }

  /**
   * Starts tracking a note opened for the first time, with its current headings as the baseline.
   *
   * @param file - The note.
   */
  private async track(file: TFile): Promise<void> {
    if (!isMarkdownFile(file) || this.headingTimesIndex.get(file.path)) {
      return;
    }

    const content = await this.app.vault.cachedRead(file);

    // A `changed` or a second open may have started tracking it during the read, with a newer answer.
    if (this.isUnloaded() || this.headingTimesIndex.get(file.path)) {
      return;
    }

    this.recordNow({ cache: this.app.metadataCache.getFileCache(file), content, file, time: Date.now() });
  }
}
