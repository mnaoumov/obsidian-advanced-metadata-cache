import type { IndexedFileRecord } from '@mnaoumov/obsidian-lib/components/incremental-file-index-component';
import type {
  App,
  Debouncer,
  TAbstractFile
} from 'obsidian';

import { IncrementalFileIndexComponent } from '@mnaoumov/obsidian-lib/components/incremental-file-index-component';
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

interface UnlinkedMentionsComponentConstructorParams {
  readonly app: App;

  readonly getDataFilePath: (this: void) => string;
  /**
   * Where the index is saved: `unlinked-mentions.json` in the plugin's folder.
   */
  readonly storage?: IndexStorage;
}

/*
 * How many candidate notes a query reads at once. One at a time leaves the query waiting on each read in turn;
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
  /*
   * The keys each note's text was found to hold, with the `mtime` and `size` it had when it was read: what a saved
   * entry is checked against, so a note edited while nothing watched is read again. A note with no record yet has not
   * been read, and every query reads it.
   */
  private readonly files: IncrementalFileIndexComponent<readonly string[]>;
  private fullScanPromise: null | Promise<void> = null;
  private readonly getDataFilePath: () => string;
  private readonly index = new UnlinkedMentionIndex();
  private isBuiltValue = false;
  private isDirty = false;
  private readonly requestSave: Debouncer<[], void>;
  /*
   * The keys the saved index had looked for in every note, or `null` when nothing was saved and the build is a full
   * scan.
   */
  private savedCleanKeys: null | readonly string[] = null;
  private readonly storage: IndexStorage;

  public constructor(params: UnlinkedMentionsComponentConstructorParams) {
    super(params.app);
    this.getDataFilePath = params.getDataFilePath;
    this.storage = params.storage ?? new FileIndexStorage({ adapter: this.app.vault.adapter, getPath: this.getDataFilePath });
    this.files = new IncrementalFileIndexComponent({
      accepts: (file): boolean => file.extension === 'md' && !isPluginDataPath(file.path),
      app: this.app,
      indexFile: ({ content, file }): readonly string[] => {
        this.index.setText(file.path, content);
        return this.index.getMentionKeys(file.path);
      },
      load: async (): Promise<ReadonlyMap<string, IndexedFileRecord<readonly string[]>>> => {
        const saved = await this.readSaved();
        if (this.isUnloaded()) {
          return new Map();
        }
        this.savedCleanKeys = saved?.cleanKeys ?? null;
        return new Map([...saved?.notes ?? []].map(([path, note]) => [path, { mtime: note.mtime, record: note.mentionKeys, size: note.size }]));
      },
      onRemove: (path): void => {
        this.index.removeText(path);
      },
      onSet: (path, keys): void => {
        this.index.restoreText(path, keys);
        this.markDirty();
      },
      save: async (): Promise<void> => this.save(),
      shouldAwaitMetadataChange: (file): boolean => file.extension === 'md',
      shouldMoveRecordsOnRename: true
    });
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

    // A note whose read is still pending holds no keys yet, so the index cannot rule it out.
    if (candidatePaths !== null) {
      const records = this.files.getRecords();
      const unreadPaths = this.app.vault.getMarkdownFiles().map((candidate) => candidate.path).filter((path) => !records.has(path));
      candidatePaths = new Set([...candidatePaths, ...unreadPaths]);
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
  }

  protected override async onLayoutReady(): Promise<void> {
    // Installed BEFORE the build: until it ends, the patch falls through to Obsidian's own scan.
    this.addChild(new UnlinkedMentionsCorePluginComponent({ app: this.app, unlinkedMentionsComponent: this }));

    // Registered before the build too, so a change made while it reads the vault is not lost. The text is `files`'.
    this.registerEvent(this.app.metadataCache.on('changed', (file, _data, cache) => {
      if (isPluginDataPath(file.path)) {
        return;
      }
      this.index.setNames(file.path, getMentionNames(file, cache));
    }));

    this.registerEvent(this.app.vault.on('create', (abstractFile) => {
      if (abstractFile instanceof TFile && !isPluginDataPath(abstractFile.path)) {
        this.index.setNames(abstractFile.path, getMentionNames(abstractFile, this.app.metadataCache.getFileCache(abstractFile)));
      }
    }));

    this.registerEvent(this.app.vault.on('delete', (abstractFile) => {
      if (isFolder(abstractFile)) {
        this.index.removeSubtree(abstractFile.path);
        this.markDirty();
        return;
      }

      this.index.removeNames(abstractFile.path);
      this.index.removeText(abstractFile.path);
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
    if (this.isUnloaded()) {
      return;
    }

    for (const file of this.app.vault.getFiles()) {
      if (isPluginDataPath(file.path)) {
        continue;
      }
      this.index.setNames(file.path, getMentionNames(file, this.app.metadataCache.getFileCache(file)));
    }

    const marker = this.index.beginFullScan();
    this.addChild(this.files);
    // The child starts loading inside addChild; loading it again after an unload there would restart it.
    if (this.isUnloaded()) {
      return;
    }
    await this.files.loadWithPromises();
    if (!this.isUnloaded()) {
      if (this.savedCleanKeys === null) {
        this.index.completeFullScan(marker);
      } else {
        this.index.markClean(this.savedCleanKeys);
      }
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
      this.markDirty();
      return;
    }
    this.index.setNames(file.path, getMentionNames(file, this.app.metadataCache.getFileCache(file)));
    this.index.renameText(oldPath, file.path);
    this.markDirty();
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
        await this.files.rescan();

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
    for (const [path, stat] of this.files.getRecords()) {
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
}

async function forEachBatch<T>(items: readonly T[], callback: (item: T) => Promise<void>): Promise<void> {
  for (let start = 0; start < items.length; start += READ_BATCH_SIZE) {
    await Promise.all(items.slice(start, start + READ_BATCH_SIZE).map((item) => callback(item)));
  }
}
