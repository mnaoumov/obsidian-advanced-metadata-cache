import type { BacklinkComponent } from '@obsidian-typings/obsidian-public-latest/implementations';

import { MonkeyAroundComponent } from '@mnaoumov/obsidian-lib/components/monkey-around-component';
import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import { getPrototypeOf } from '@mnaoumov/typescript-lib/object-utils';
import {
  parseFrontMatterAliases,
  TFile
} from 'obsidian';

import type {
  UnlinkedMentionMatch,
  UnlinkedMentionsComponent
} from './unlinked-mentions-component.ts';

import { getFileComparer } from '../backlinks/file-comparer.ts';

interface BacklinkComponentRecomputeUnlinkedPatchComponentConstructorParams {
  readonly backlinkComponent: BacklinkComponent;
  readonly unlinkedMentionsComponent: UnlinkedMentionsComponent;
}

/**
 * Answers the Backlinks pane's `Unlinked mentions` section from the `unlinked mentions` module.
 *
 * Obsidian 1.14.4's `recomputeUnlinked` reads every note in the vault for each note shown; this one asks the module,
 * which reads only the notes whose text holds one of the note's names, then fills the section exactly as the original
 * does, `Link` buttons included. A note changed while the section is shown is re-checked by `onFileChanged`, which the
 * original serves from a queue this replacement never creates.
 *
 * Until the module's first full scan has finished, both methods fall through to Obsidian's own.
 */
export class BacklinkComponentRecomputeUnlinkedPatchComponent extends MonkeyAroundComponent {
  private readonly backlinkComponent: BacklinkComponent;

  /**
   * The backlinks components whose section this patch filled last, rather than Obsidian's own scan.
   */
  private readonly patchedBacklinkComponents = new WeakSet<BacklinkComponent>();

  /**
   * Bumped by every recompute of a component, so an answer that arrives after a newer recompute began is dropped.
   */
  private readonly recomputeNumbers = new WeakMap<BacklinkComponent, number>();

  private readonly unlinkedMentionsComponent: UnlinkedMentionsComponent;

  public constructor(params: BacklinkComponentRecomputeUnlinkedPatchComponentConstructorParams) {
    super();
    this.backlinkComponent = params.backlinkComponent;
    this.unlinkedMentionsComponent = params.unlinkedMentionsComponent;
  }

  public override onload(): void {
    const prototype = getPrototypeOf(this.backlinkComponent);

    this.registerMethodPatch({
      $object: prototype,
      methodName: 'recomputeUnlinked',
      patchHandler: ({ fallback, originalArguments: [file], originalThis }) => {
        const recomputeNumber = this.bumpRecomputeNumber(originalThis);
        // Obsidian's own `recomputeUnlinked` returns nothing, so neither branch has a value to pass on.
        if (this.unlinkedMentionsComponent.isBuilt) {
          invokeAsyncSafely(async () => {
            await this.recomputeUnlinked(originalThis, file instanceof TFile ? file : null, recomputeNumber);
          });
        } else {
          this.patchedBacklinkComponents.delete(originalThis);
          fallback();
        }
      }
    });

    this.registerMethodPatch({
      $object: prototype,
      methodName: 'onFileChanged',
      patchHandler: ({ fallback, originalArguments: [file], originalThis }) => {
        const result = fallback();
        if (this.patchedBacklinkComponents.has(originalThis) && file instanceof TFile) {
          invokeAsyncSafely(async () => {
            await this.recheckFile(originalThis, file);
          });
        }

        return result;
      }
    });
  }

  private addResult(backlinkComponent: BacklinkComponent, file: TFile, unlinkedMention: UnlinkedMentionMatch): void {
    const resultDomItem = backlinkComponent.unlinkedDom.addResult(unlinkedMention.file, { content: unlinkedMention.ranges }, unlinkedMention.content);
    backlinkComponent.addLinkFunction(resultDomItem, file, unlinkedMention.file);
    resultDomItem.separateMatches = true;
  }

  private bumpRecomputeNumber(backlinkComponent: BacklinkComponent): number {
    const recomputeNumber = (this.recomputeNumbers.get(backlinkComponent) ?? 0) + 1;
    this.recomputeNumbers.set(backlinkComponent, recomputeNumber);
    return recomputeNumber;
  }

  private async recheckFile(backlinkComponent: BacklinkComponent, changedFile: TFile): Promise<void> {
    const file = backlinkComponent.unlinkedFile;
    if (!file || changedFile === file) {
      return;
    }

    const recomputeNumber = this.recomputeNumbers.get(backlinkComponent);
    const unlinkedMention = await this.unlinkedMentionsComponent.getUnlinkedMentionIn(file, changedFile);
    if (this.recomputeNumbers.get(backlinkComponent) !== recomputeNumber || backlinkComponent.unlinkedFile !== file) {
      return;
    }

    if (unlinkedMention && backlinkComponent.passSearchFilter(changedFile, unlinkedMention.content)) {
      this.addResult(backlinkComponent, file, unlinkedMention);
    } else {
      backlinkComponent.unlinkedDom.removeResult(changedFile);
    }

    showCount(backlinkComponent);
  }

  private async recomputeUnlinked(backlinkComponent: BacklinkComponent, file: null | TFile, recomputeNumber: number): Promise<void> {
    backlinkComponent.stopUnlinkedSearch();
    if (backlinkComponent.unlinkedCollapsed) {
      this.patchedBacklinkComponents.delete(backlinkComponent);
      backlinkComponent.unlinkedCountEl.hide();
      return;
    }

    this.patchedBacklinkComponents.add(backlinkComponent);
    backlinkComponent.unlinkedFile = file;
    backlinkComponent.unlinkedAliases = '';
    backlinkComponent.unlinkedCountEl.show();
    backlinkComponent.unlinkedCountEl.setText('0');
    backlinkComponent.unlinkedDom.emptyResults();
    if (!file) {
      return;
    }

    // Compared by the original `onMetadataChanged`, which recomputes the section when the note's aliases change.
    const aliases = parseFrontMatterAliases(backlinkComponent.app.metadataCache.getFileCache(file)?.frontmatter);
    if (aliases) {
      backlinkComponent.unlinkedAliases = JSON.stringify(aliases);
    }

    backlinkComponent.unlinkedDom.startLoader();
    try {
      const unlinkedMentions = await this.unlinkedMentionsComponent.getUnlinkedMentions(file);
      if (this.recomputeNumbers.get(backlinkComponent) !== recomputeNumber) {
        return;
      }

      const fileComparer = getFileComparer(backlinkComponent.unlinkedDom.sortOrder);
      unlinkedMentions.sort((a, b) => fileComparer(a.file, b.file));
      for (const unlinkedMention of unlinkedMentions) {
        if (backlinkComponent.passSearchFilter(unlinkedMention.file, unlinkedMention.content)) {
          this.addResult(backlinkComponent, file, unlinkedMention);
        }
      }
    } finally {
      backlinkComponent.unlinkedDom.stopLoader();
    }

    showCount(backlinkComponent);
  }
}

function showCount(backlinkComponent: BacklinkComponent): void {
  backlinkComponent.unlinkedCountEl.setText(backlinkComponent.unlinkedDom.getMatchCount().toString());
  backlinkComponent.unlinkedDom.changed();
}
