import type {
  App,
  Debouncer,
  TAbstractFile
} from 'obsidian';

import { LayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import { isFolder } from '@mnaoumov/obsidian-lib/file-system';
import { ensureMetadataCacheReady } from '@mnaoumov/obsidian-lib/metadata-cache';
import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import {
  debounce,
  TFile,
  Vault
} from 'obsidian';

import type { IndexStorage } from '../../persistence/index-storage.ts';
import type {
  SavedNoteMentions,
  SavedUnlinkedMentions
} from './persisted-unlinked-mentions.ts';
import type { MentionRange } from './unlinked-mention-ranges.ts';

import { FileIndexStorage } from '../../persistence/file-index-storage.ts';
import { isPluginDataPath } from '../../persistence/storage-paths.ts';
import {
  parsePersistedUnlinkedMentions,
  stringifyPersistedUnlinkedMentions
} from './persisted-unlinked-mentions.ts';
import {
  getNameKey,
  UnlinkedMentionIndex
} from './unlinked-mention-index.ts';
import {
  findMentionRanges,
  getMentionNames
} from './unlinked-mention-ranges.ts';
import { UnlinkedMentionsCorePluginComponent } from './unlinked-mentions-core-plugin-component.ts';

/**
 * One note that mentions another without linking to it.
 */
export interface UnlinkedMentionMatch {
  /**
   * The mentioning note's text, as it was read.
   */
  readonly content: string;

  /**
   * The mentioning note.
   */
  readonly file: TFile;

  /**
   * The spans of its text that mention the note, in the order Obsidian finds them.
   */
  readonly ranges: MentionRange[];
}

interface ScannedStat {
  readonly mtime: number;
  readonly size: number;
}

interface UnlinkedMentionsComponentConstructorParams {
  readonly app: App;

  readonly getDataFilePath: (this: void) => string;
  /**
   * Where the index is saved: `unlinked-mentions.json` in the plugin's folder.
   */
  readonly storage?: IndexStorage;
}

/*
 * How many notes are read at once during a full scan. One at a time leaves the scan waiting on each read in turn;
 * all at once queues every file of a large vault before the first answer.
 */
const READ_BATCH_SIZE = 20;

/**
 * How long changes are gathered before the index is written to disk. Not reset by each change, so a vault edited
 * without pause is still saved this often.
 */
export const SAVE_DEBOUNCE_IN_MILLISECONDS = 5000;

/**
 * The `unlinked mentions` module: keeps an {@link UnlinkedMentionIndex} of which notes' text holds which names, and
 * answers a note's unlinked mentions by reading only the notes that can hold one.
 *
 * The Backlinks pane's `Unlinked mentions` section is answered from it through a patch of
 * `BacklinkComponent.recomputeUnlinked`, installed BEFORE the build: until the build ends the patch falls through to
 * Obsidian's own full scan, so no caller is handed an answer from a half-built index.
 *
 * The index is saved to device-local IndexedDB, with the `mtime` and `size` each note had when it was scanned, on a
 * debounce and once more when the module is switched off. The next build reuses every note whose `mtime` and `size`
 * still match and reads only the rest; a name the saved index had not looked for is dirty, as after any full scan.
 */
export class UnlinkedMentionsComponent extends LayoutReadyComponent {
  /**
   * Whether the first full scan has finished, so the index can answer.
   *
   * @returns Whether it has.
   */
  public get isBuilt(): boolean {
    return this.isBuiltValue;
  }

  private buildPromise: null | Promise<void> = null;
  private fullScanPromise: null | Promise<void> = null;
  private readonly getDataFilePath: () => string;
  private readonly index = new UnlinkedMentionIndex();
  private isBuiltValue = false;
  private isDirty = false;
  private readonly requestSave: Debouncer<[], void>;
  /*
   * The `mtime` and `size` each note had when its text was last scanned: what a saved entry is checked against, so a
   * note edited while nothing watched is read again.
   */
  private readonly scannedStats = new Map<string, ScannedStat>();

  private readonly storage: IndexStorage;

  public constructor(params: UnlinkedMentionsComponentConstructorParams) {
    super(params.app);
    this.getDataFilePath = params.getDataFilePath;
    this.storage = params.storage ?? new FileIndexStorage({ adapter: this.app.vault.adapter, getPath: this.getDataFilePath });
    this.requestSave = debounce(() => {
      invokeAsyncSafely(() => this.save());
    }, SAVE_DEBOUNCE_IN_MILLISECONDS);
  }

  /**
   * Finds one note's unlinked mentions in one other note, reading that note.
   *
   * @param file - The mentioned note.
   * @param mentioningFile - The note to look in.
   * @returns The mention, or `null` when that note mentions it nowhere outside a link, is the note itself, or is
   *   excluded from the vault's search.
   */
  public async getUnlinkedMentionIn(file: TFile, mentioningFile: TFile): Promise<null | UnlinkedMentionMatch> {
    return await this.findUnlinkedMention(getMentionNames(file, this.app.metadataCache.getFileCache(file)), file, mentioningFile);
  }

  /**
   * Finds every note that mentions a note by its basename or one of its `aliases` without linking to it, as the
   * Backlinks pane's `Unlinked mentions` section lists them.
   *
   * Waits for the index to be built first. Only the notes whose text holds one of the names are read; a name with no
   * word character in it, or one the index has not seen yet, makes every note be read, as Obsidian does.
   *
   * @param file - The mentioned note.
   * @returns The mentions, one per mentioning note, in no particular order.
   */
  public async getUnlinkedMentions(file: TFile): Promise<UnlinkedMentionMatch[]> {
    await this.ensureBuilt();

    const names = getMentionNames(file, this.app.metadataCache.getFileCache(file));
    const isIndexable = names.every((name) => getNameKey(name) !== null);
    let candidatePaths = this.index.getCandidatePaths(names);
    // A dirty name is cleaned by a full scan; a name the index cannot hold is not, so it goes straight to reading all.
    if (candidatePaths === null && isIndexable) {
      await this.runFullScan();
      candidatePaths = this.index.getCandidatePaths(names);
    }

    const candidateFiles = candidatePaths === null
      ? this.app.vault.getMarkdownFiles()
      : [...candidatePaths].map((path) => this.app.vault.getFileByPath(path)).filter((candidateFile) => candidateFile !== null);

    const unlinkedMentions: UnlinkedMentionMatch[] = [];
    await forEachBatch(candidateFiles, async (candidateFile) => {
      const unlinkedMention = await this.findUnlinkedMention(names, file, candidateFile);
      if (unlinkedMention) {
        unlinkedMentions.push(unlinkedMention);
      }
    });
    return unlinkedMentions;
  }

  public override onunload(): void {
    this.requestSave.cancel();

    // Only once built: before that the index holds less than the file it would overwrite.
    if (this.isBuiltValue && this.isDirty) {
      // `save` serializes before its first `await`, so clearing straight after it still saves this state.
      invokeAsyncSafely(() => this.save());
    }
    invokeAsyncSafely(async () => this.storage.close?.());

    super.onunload();
    this.index.clear();
    this.scannedStats.clear();
  }

  protected override async onLayoutReady(): Promise<void> {
    // Installed BEFORE the build: until it ends, the patch falls through to Obsidian's own scan.
    this.addChild(new UnlinkedMentionsCorePluginComponent({ app: this.app, unlinkedMentionsComponent: this }));

    // Registered before the build too, so a change made while it reads the vault is not lost.
    this.registerEvent(this.app.metadataCache.on('changed', (file, data, cache) => {
      if (isPluginDataPath(file.path)) {
        return;
      }
      this.index.setNames(file.path, getMentionNames(file, cache));
      this.setText(file, data);
    }));

    this.registerEvent(this.app.vault.on('create', (abstractFile) => {
      if (abstractFile instanceof TFile && !isPluginDataPath(abstractFile.path)) {
        this.index.setNames(abstractFile.path, getMentionNames(abstractFile, this.app.metadataCache.getFileCache(abstractFile)));
      }
    }));

    this.registerEvent(this.app.vault.on('delete', (abstractFile) => {
      if (isFolder(abstractFile)) {
        this.index.removeSubtree(abstractFile.path);
        const prefix = `${abstractFile.path}/`;
        for (const path of this.scannedStats.keys()) {
          if (path.startsWith(prefix)) {
            this.scannedStats.delete(path);
          }
        }

        this.markDirty();
        return;
      }

      this.index.removeNames(abstractFile.path);
      this.index.removeText(abstractFile.path);
      this.scannedStats.delete(abstractFile.path);
      this.markDirty();
    }));

    this.registerEvent(this.app.vault.on('rename', (abstractFile, oldPath) => {
      this.handleRename(abstractFile, oldPath);
    }));

    await this.ensureBuilt();
  }

  private async build(): Promise<void> {
    // An alias read before the cache can answer would be indexed as absent, with no later event to say otherwise.
    await ensureMetadataCacheReady(this.app);

    for (const file of this.app.vault.getFiles()) {
      if (isPluginDataPath(file.path)) {
        continue;
      }
      this.index.setNames(file.path, getMentionNames(file, this.app.metadataCache.getFileCache(file)));
    }

    const saved = await this.readSaved();
    if (saved) {
      await this.restore(saved);
    } else {
      await this.runFullScan();
    }

    this.isBuiltValue = !this.isUnloaded();
    if (this.isBuiltValue) {
      this.markDirty();
    }
  }

  private async ensureBuilt(): Promise<void> {
    this.buildPromise ??= this.build();
    await this.buildPromise;
  }

  private async findUnlinkedMention(names: readonly string[], file: TFile, mentioningFile: TFile): Promise<null | UnlinkedMentionMatch> {
    if (mentioningFile === file || mentioningFile.extension !== 'md' || isPluginDataPath(mentioningFile.path) || this.app.metadataCache.isUserIgnored(mentioningFile.path)) {
      return null;
    }

    const content = await this.app.vault.cachedRead(mentioningFile);
    const ranges = findMentionRanges({ cache: this.app.metadataCache.getFileCache(mentioningFile), content, names });
    return ranges.length === 0 ? null : { content, file: mentioningFile, ranges };
  }

  private handleRename(abstractFile: TAbstractFile, oldPath: string): void {
    if (abstractFile instanceof TFile) {
      this.renameFile(abstractFile, oldPath);
      return;
    }

    if (!isFolder(abstractFile)) {
      return;
    }

    /*
     * Obsidian 1.14 fires a `rename` for each descendant of a renamed folder as well, but in no order that is a
     * contract; a file rename is idempotent here, so handling the descendants from the folder's event too reaches the
     * same state whichever comes first.
     */
    Vault.recurseChildren(abstractFile, (descendant) => {
      if (descendant instanceof TFile) {
        this.renameFile(descendant, oldPath + descendant.path.slice(abstractFile.path.length));
      }
    });
  }

  private markDirty(): void {
    this.isDirty = true;
    if (this.isBuiltValue) {
      this.requestSave();
    }
  }

  /**
   * Reads the saved index.
   *
   * @returns It, or `null` when there is none this version can use, and every note must be read.
   */
  private async readSaved(): Promise<null | SavedUnlinkedMentions> {
    const json = await this.storage.read();
    return json === null ? null : parsePersistedUnlinkedMentions(json);
  }

  private renameFile(file: TFile, oldPath: string): void {
    this.index.removeNames(oldPath);
    if (isPluginDataPath(file.path)) {
      this.index.removeText(oldPath);
      this.scannedStats.delete(oldPath);
      this.markDirty();
      return;
    }
    this.index.setNames(file.path, getMentionNames(file, this.app.metadataCache.getFileCache(file)));
    this.index.renameText(oldPath, file.path);

    const stat = this.scannedStats.get(oldPath);
    this.scannedStats.delete(oldPath);
    if (stat) {
      this.scannedStats.set(file.path, stat);
    }

    this.markDirty();
  }

  /**
   * Builds the index from a saved one: every note whose `mtime` and `size` match its saved entry keeps what it was
   * found to mention, every other note is read, and the names the saved index had looked for are clean.
   *
   * @param saved - The saved index.
   */
  private async restore(saved: SavedUnlinkedMentions): Promise<void> {
    const changedFiles: TFile[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (isPluginDataPath(file.path)) {
        continue;
      }
      const note: SavedNoteMentions | undefined = saved.notes.get(file.path);
      // A note `changed` already scanned during the load is newer than anything saved.
      if (this.scannedStats.has(file.path)) {
        continue;
      }

      if (note?.mtime === file.stat.mtime && note.size === file.stat.size) {
        this.index.restoreText(file.path, note.mentionKeys);
        this.scannedStats.set(file.path, { mtime: note.mtime, size: note.size });
      } else {
        changedFiles.push(file);
      }
    }

    await this.scanFiles(changedFiles);
    if (!this.isUnloaded()) {
      this.index.markClean(saved.cleanKeys);
    }
  }

  /**
   * Reads every note's text into the index. Callers arriving while a scan runs share it; a name that became known
   * while it ran stays dirty, and asking about it starts the next one.
   *
   * @returns A {@link Promise} that resolves when the scan has read every note.
   */
  private async runFullScan(): Promise<void> {
    this.fullScanPromise ??= (async (): Promise<void> => {
      try {
        const marker = this.index.beginFullScan();
        await this.scanFiles(this.app.vault.getMarkdownFiles());

        if (!this.isUnloaded()) {
          this.index.completeFullScan(marker);
          this.markDirty();
        }
      } finally {
        this.fullScanPromise = null;
      }
    })();

    await this.fullScanPromise;
  }

  /**
   * Writes the index to disk.
   *
   * The JSON is built synchronously, before the first `await`, so a caller may clear the index straight after calling
   * this and still have the state it held saved.
   */
  private async save(): Promise<void> {
    const notes = new Map<string, SavedNoteMentions>();
    for (const [path, stat] of this.scannedStats) {
      notes.set(path, { mentionKeys: this.index.getMentionKeys(path), mtime: stat.mtime, size: stat.size });
    }

    const json = stringifyPersistedUnlinkedMentions({ cleanKeys: this.index.getCleanKeys(), notes });
    this.isDirty = false;
    try {
      await this.storage.write(json);
    } catch (error) {
      this.isDirty = true;
      throw error;
    }
  }

  /**
   * Reads notes' text into the index.
   *
   * @param files - The notes.
   */
  private async scanFiles(files: readonly TFile[]): Promise<void> {
    await forEachBatch(files, async (file) => {
      if (this.isUnloaded()) {
        return;
      }

      const content = await this.app.vault.cachedRead(file);
      // A note deleted or renamed during the read is the event handlers' to account for.
      if (!this.isUnloaded() && this.app.vault.getFileByPath(file.path) === file) {
        this.setText(file, content);
      }
    });
  }

  private setText(file: TFile, content: string): void {
    if (isPluginDataPath(file.path)) {
      return;
    }
    this.index.setText(file.path, content);
    this.scannedStats.set(file.path, { mtime: file.stat.mtime, size: file.stat.size });
    this.markDirty();
  }
}

async function forEachBatch<T>(items: readonly T[], callback: (item: T) => Promise<void>): Promise<void> {
  for (let start = 0; start < items.length; start += READ_BATCH_SIZE) {
    await Promise.all(items.slice(start, start + READ_BATCH_SIZE).map((item) => callback(item)));
  }
}
