import type {
  App,
  TAbstractFile
} from 'obsidian';

import { LayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import { isFolder } from '@mnaoumov/obsidian-lib/file-system';
import { ensureMetadataCacheReady } from '@mnaoumov/obsidian-lib/metadata-cache';
import {
  TFile,
  Vault
} from 'obsidian';

import type { MentionRange } from './unlinked-mention-ranges.ts';

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
}

/*
 * How many notes are read at once during a full scan. One at a time leaves the scan waiting on each read in turn;
 * all at once queues every file of a large vault before the first answer.
 */
const READ_BATCH_SIZE = 20;

/**
 * The `unlinked mentions` module: keeps an {@link UnlinkedMentionIndex} of which notes' text holds which names, and
 * answers a note's unlinked mentions by reading only the notes that can hold one.
 *
 * The Backlinks pane's `Unlinked mentions` section is answered from it through a patch of
 * `BacklinkComponent.recomputeUnlinked`, installed BEFORE the build: until the build ends the patch falls through to
 * Obsidian's own full scan, so no caller is handed an answer from a half-built index.
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
  private readonly index = new UnlinkedMentionIndex();
  private isBuiltValue = false;

  public constructor(params: UnlinkedMentionsComponentConstructorParams) {
    super(params.app);
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
    super.onunload();
    this.index.clear();
  }

  protected override async onLayoutReady(): Promise<void> {
    // Installed BEFORE the build: until it ends, the patch falls through to Obsidian's own scan.
    this.addChild(new UnlinkedMentionsCorePluginComponent({ app: this.app, unlinkedMentionsComponent: this }));

    // Registered before the build too, so a change made while it reads the vault is not lost.
    this.registerEvent(this.app.metadataCache.on('changed', (file, data, cache) => {
      this.index.setNames(file.path, getMentionNames(file, cache));
      this.index.setText(file.path, data);
    }));

    this.registerEvent(this.app.vault.on('create', (abstractFile) => {
      if (abstractFile instanceof TFile) {
        this.index.setNames(abstractFile.path, getMentionNames(abstractFile, this.app.metadataCache.getFileCache(abstractFile)));
      }
    }));

    this.registerEvent(this.app.vault.on('delete', (abstractFile) => {
      if (isFolder(abstractFile)) {
        this.index.removeSubtree(abstractFile.path);
        return;
      }

      this.index.removeNames(abstractFile.path);
      this.index.removeText(abstractFile.path);
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
      this.index.setNames(file.path, getMentionNames(file, this.app.metadataCache.getFileCache(file)));
    }

    await this.runFullScan();
    this.isBuiltValue = !this.isUnloaded();
  }

  private async ensureBuilt(): Promise<void> {
    this.buildPromise ??= this.build();
    await this.buildPromise;
  }

  private async findUnlinkedMention(names: readonly string[], file: TFile, mentioningFile: TFile): Promise<null | UnlinkedMentionMatch> {
    if (mentioningFile === file || mentioningFile.extension !== 'md' || this.app.metadataCache.isUserIgnored(mentioningFile.path)) {
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

  private renameFile(file: TFile, oldPath: string): void {
    this.index.removeNames(oldPath);
    this.index.setNames(file.path, getMentionNames(file, this.app.metadataCache.getFileCache(file)));
    this.index.renameText(oldPath, file.path);
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
        await forEachBatch(this.app.vault.getMarkdownFiles(), async (file) => {
          if (this.isUnloaded()) {
            return;
          }

          const content = await this.app.vault.cachedRead(file);
          // A note deleted or renamed during the read is the event handlers' to account for.
          if (!this.isUnloaded() && this.app.vault.getFileByPath(file.path) === file) {
            this.index.setText(file.path, content);
          }
        });

        if (!this.isUnloaded()) {
          this.index.completeFullScan(marker);
        }
      } finally {
        this.fullScanPromise = null;
      }
    })();

    await this.fullScanPromise;
  }
}

async function forEachBatch<T>(items: readonly T[], callback: (item: T) => Promise<void>): Promise<void> {
  for (let start = 0; start < items.length; start += READ_BATCH_SIZE) {
    await Promise.all(items.slice(start, start + READ_BATCH_SIZE).map((item) => callback(item)));
  }
}
