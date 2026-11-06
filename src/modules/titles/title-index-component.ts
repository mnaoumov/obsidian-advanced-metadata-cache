import type {
  App,
  TAbstractFile
} from 'obsidian';

import { ComponentEx } from '@mnaoumov/obsidian-lib/components/component-ex';
import { isFolder } from '@mnaoumov/obsidian-lib/file-system';

import type { TitleIndex } from './title-index.ts';

import { UnparsedFrontmatterReporterComponent } from './unparsed-frontmatter-reporter-component.ts';

interface TitleIndexComponentConstructorParams {
  readonly app: App;
  readonly titleIndex: TitleIndex;
}

/**
 * Keeps the {@link TitleIndex}'s memoized answers honest for as long as the `Titles` module is on.
 *
 * There is no build step here, which is the whole difference from the name index's component: the index
 * is lazy, so a path nobody has asked about has no answer to be wrong. All this owns is the
 * invalidation, plus the two edges.
 *
 * **It clears at BOTH edges on purpose.** Nothing invalidates the index while the module is off, so a
 * note whose `title` changed in the meantime has no event left to replay — an answer memoized before
 * the module was switched off must not survive it being switched back on.
 *
 * It also owns the {@link UnparsedFrontmatterReporterComponent}: a note whose frontmatter does not parse has no
 * titles, and while this module is on that is reported rather than left silent.
 */
export class TitleIndexComponent extends ComponentEx {
  private readonly app: App;
  private readonly titleIndex: TitleIndex;

  public constructor(params: TitleIndexComponentConstructorParams) {
    super();

    this.app = params.app;
    this.titleIndex = params.titleIndex;
  }

  public override onload(): void {
    this.titleIndex.clear();
    this.register(() => {
      this.titleIndex.clear();
    });

    this.addChild(new UnparsedFrontmatterReporterComponent({ app: this.app }));

    this.registerEvent(this.app.metadataCache.on('changed', (file) => {
      this.titleIndex.invalidate(file.path);
    }));

    this.registerEvent(this.app.vault.on('create', (abstractFile) => {
      this.invalidateAbstractFile(abstractFile);
    }));

    this.registerEvent(this.app.vault.on('delete', (abstractFile) => {
      this.invalidateAbstractFile(abstractFile);
    }));

    this.registerEvent(this.app.vault.on('rename', (abstractFile, oldPath) => {
      this.invalidatePath(oldPath, isFolder(abstractFile));
      this.invalidateAbstractFile(abstractFile);
    }));
  }

  private invalidateAbstractFile(abstractFile: TAbstractFile): void {
    this.invalidatePath(abstractFile.path, isFolder(abstractFile));
  }

  private invalidatePath(path: string, isFolderPath: boolean): void {
    if (isFolderPath) {
      this.titleIndex.invalidateSubtree(path);
      return;
    }

    this.titleIndex.invalidate(path);
  }
}
