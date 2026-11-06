import type {
  App,
  CachedMetadata,
  TFile
} from 'obsidian';

import { LayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import {
  isFolder,
  isMarkdownFile
} from '@mnaoumov/obsidian-lib/file-system';
import { ensureMetadataCacheReady } from '@mnaoumov/obsidian-lib/metadata-cache';
import { sleep } from '@mnaoumov/typescript-lib/async';

import { isPluginDataPath } from '../../persistence/storage-paths.ts';
import {
  getFrontmatterParseError,
  getUnparsedFrontmatterPosition
} from './unparsed-frontmatter.ts';

/**
 * How many notes the startup check looks at before it yields to the event loop.
 */
export const STARTUP_BATCH_SIZE = 500;

interface UnparsedFrontmatterReporterComponentConstructorParams {
  readonly app: App;
}

/**
 * Reports, in the console, every note whose frontmatter block does not parse while the `Titles` module is on.
 *
 * Such a note has no `title` and no `aliases` in the metadata cache, so the Quick switcher, the `[[` autocomplete and
 * this plugin's name index all lose it, and Obsidian says nothing. This says which note, what the YAML error is, and
 * what it costs. One warning per note and error: the same error is not repeated on every edit, and it is reported
 * again only after the note has parsed or has failed differently in between.
 *
 * Only a note whose cache has a `yaml` section and no `frontmatter` is read, so the startup pass costs a look at
 * memory Obsidian already holds plus one read per such note.
 */
export class UnparsedFrontmatterReporterComponent extends LayoutReadyComponent {
  private readonly reportedErrors = new Map<string, string>();

  public constructor(params: UnparsedFrontmatterReporterComponentConstructorParams) {
    super(params.app);
  }

  public override onunload(): void {
    this.reportedErrors.clear();
    super.onunload();
  }

  protected override async onLayoutReady(): Promise<void> {
    this.registerEvent(this.app.metadataCache.on('changed', (file, data, cache) => {
      this.check(file, cache, data);
    }));

    this.registerEvent(this.app.vault.on('delete', (abstractFile) => {
      this.forget(abstractFile.path, isFolder(abstractFile));
    }));

    this.registerEvent(this.app.vault.on('rename', (abstractFile, oldPath) => {
      this.forget(oldPath, isFolder(abstractFile));
    }));

    await ensureMetadataCacheReady(this.app);

    if (this.isUnloaded()) {
      return;
    }

    const files = this.app.vault.getMarkdownFiles();
    for (let start = 0; start < files.length; start += STARTUP_BATCH_SIZE) {
      if (start > 0) {
        await sleep({ milliseconds: 0 });
        if (this.isUnloaded()) {
          return;
        }
      }

      for (const file of files.slice(start, start + STARTUP_BATCH_SIZE)) {
        await this.checkFromDisk(file);
        if (this.isUnloaded()) {
          return;
        }
      }
    }
  }

  private check(file: TFile, cache: CachedMetadata | null, text: string): void {
    if (!isMarkdownFile(file) || isPluginDataPath(file.path)) {
      return;
    }

    const position = getUnparsedFrontmatterPosition(cache);

    if (!position) {
      this.reportedErrors.delete(file.path);
      return;
    }

    const error = getFrontmatterParseError(text, position);

    if (error === null) {
      this.reportedErrors.delete(file.path);
      return;
    }

    if (this.reportedErrors.get(file.path) === error) {
      return;
    }

    this.reportedErrors.set(file.path, error);
    console.warn(
      `Advanced Metadata Cache: the frontmatter of "${file.path}" does not parse, so Obsidian ignores all of its properties: its titles and aliases are not found by name. Fix the YAML error below.`,
      error
    );
  }

  /**
   * Checks one note at startup, reading it only when its cache makes it a candidate.
   *
   * @param file - The note.
   */
  private async checkFromDisk(file: TFile): Promise<void> {
    const cache = this.app.metadataCache.getFileCache(file);

    if (!getUnparsedFrontmatterPosition(cache)) {
      return;
    }

    const text = await this.app.vault.cachedRead(file);

    // Parsed again while it was read: that parse fires its own `changed`, with the text it parsed.
    if (this.isUnloaded() || this.app.metadataCache.getFileCache(file) !== cache) {
      return;
    }

    this.check(file, cache, text);
  }

  private forget(path: string, isFolderPath: boolean): void {
    if (!isFolderPath) {
      this.reportedErrors.delete(path);
      return;
    }

    const prefix = `${path}/`;
    for (const reportedPath of this.reportedErrors.keys()) {
      if (reportedPath.startsWith(prefix)) {
        this.reportedErrors.delete(reportedPath);
      }
    }
  }
}
