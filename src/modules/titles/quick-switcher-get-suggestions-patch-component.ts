/**
 * @file
 *
 * Offers a note's titles in the core Quick switcher, which reads frontmatter aliases on its own and never asks
 * `metadataCache.getLinkSuggestions()`.
 */

import type {
  FileSuggestModal,
  FileSuggestModalAliasSuggestion,
  FileSuggestModalSuggestion
} from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  SearchResultContainer,
  TFile
} from 'obsidian';

import { MonkeyAroundComponent } from '@mnaoumov/obsidian-lib/components/monkey-around-component';
import { InternalPluginName } from '@obsidian-typings/obsidian-public-latest/implementations';
import {
  parseFrontMatterAliases,
  prepareFuzzySearch,
  sortSearchResults
} from 'obsidian';

import type { TitleIndex } from './title-index.ts';

/**
 * The image extensions Obsidian 1.15.1's `FileSuggestModal` offers under `shouldShowImages`.
 */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);

/**
 * The score Obsidian takes off a match in a file the user excluded (`Excluded files` under `Files and links`).
 */
const DOWNRANK_SCORE = 10;

interface QuickSwitcherGetSuggestionsPatchComponentConstructorParams {
  readonly app: App;
  readonly titleIndex: TitleIndex;
}

/**
 * Adds a match for each title of a note to the Quick switcher's suggestions.
 *
 * A title is offered in the shape Obsidian gives an alias (`type: 'alias'`), so it renders with the alias flair and the
 * note's path under it, and choosing it opens the note. It obeys the same switches Obsidian's own alias matching does:
 * nothing for an empty query (the recent files stay Obsidian's), nothing while the modal's `shouldShowAlias` is off, the
 * modal's file-type filters, and the downranking of an excluded file. A title that repeats the note's basename or one
 * of its aliases adds nothing, since Obsidian already offers it. The merged list is sorted again, as Obsidian sorts its
 * own.
 *
 * The patch sits on the `QuickSwitcherModal` prototype, not on `FileSuggestModal`, so the other file choosers keep
 * Obsidian's answer. That class is a module constant of Obsidian's, created once and shared by every enable of the core
 * plugin, so toggling the core plugin needs nothing here.
 */
export class QuickSwitcherGetSuggestionsPatchComponent extends MonkeyAroundComponent {
  private readonly app: App;
  private readonly titleIndex: TitleIndex;

  public constructor(params: QuickSwitcherGetSuggestionsPatchComponentConstructorParams) {
    super();
    this.app = params.app;
    this.titleIndex = params.titleIndex;
  }

  public override onload(): void {
    const quickSwitcherModalConstructor = this.app.internalPlugins.getPluginById(InternalPluginName.Switcher)?.instance.QuickSwitcherModal;
    if (!quickSwitcherModalConstructor) {
      return;
    }

    this.registerMethodPatch({
      $object: quickSwitcherModalConstructor.prototype,
      methodName: 'getSuggestions',
      patchHandler: ({ fallback, originalArguments: [query], originalThis }) => {
        const suggestions = fallback();
        return this.addTitleSuggestions(originalThis, query, suggestions);
      }
    });
  }

  private addTitleSuggestions(modal: FileSuggestModal, query: string, suggestions: FileSuggestModalSuggestion[]): FileSuggestModalSuggestion[] {
    const trimmedQuery = query.trim();
    if (!trimmedQuery || !modal.shouldShowAlias) {
      return suggestions;
    }

    const fuzzySearch = prepareFuzzySearch(trimmedQuery);
    const titleSuggestions: FileSuggestModalAliasSuggestion[] = [];

    for (const file of this.app.vault.getFiles()) {
      if (!this.isOffered(modal, file)) {
        continue;
      }

      const titles = this.titleIndex.getTitles(file);
      if (titles.length === 0) {
        continue;
      }

      const knownNames = new Set([file.basename.toLowerCase()]);
      for (const alias of parseFrontMatterAliases(this.app.metadataCache.getFileCache(file)?.frontmatter) ?? []) {
        knownNames.add(alias.toLowerCase());
      }

      const isDownranked = this.app.metadataCache.isUserIgnored(file.path);

      for (const title of titles) {
        if (knownNames.has(title.toLowerCase())) {
          continue;
        }
        knownNames.add(title.toLowerCase());

        const match = fuzzySearch(title);
        if (!match) {
          continue;
        }

        if (isDownranked) {
          match.score -= DOWNRANK_SCORE;
        }

        titleSuggestions.push({
          alias: title,
          downranked: isDownranked,
          file,
          match,
          type: 'alias'
        });
      }
    }

    if (titleSuggestions.length === 0) {
      return suggestions;
    }

    const merged = [...suggestions, ...titleSuggestions];
    // Only the recent files of an empty query carry a `null` match, and an empty query returned above.
    sortSearchResults(merged as SearchResultContainer[]);
    return merged;
  }

  /**
   * Whether the modal offers a file at all: Obsidian 1.15.1's own filter in `FileSuggestModal.getSuggestions`.
   *
   * @param modal - The modal asking.
   * @param file - The file.
   * @returns Whether the modal offers it.
   */
  private isOffered(modal: FileSuggestModal, file: TFile): boolean {
    if (file.extension === 'md') {
      return modal.shouldShowMarkdown;
    }

    if (file.extension === 'canvas' || file.extension === 'base') {
      return modal.shouldShowNonAttachments;
    }

    if (IMAGE_EXTENSIONS.has(file.extension)) {
      return modal.shouldShowImages;
    }

    if (modal.shouldShowAllTypes) {
      return true;
    }

    if (!modal.shouldShowNonImageAttachments) {
      return false;
    }

    const registry = modal.context === 'view' ? this.app.viewRegistry : this.app.embedRegistry;
    return registry.isExtensionRegistered(file.extension);
  }
}
