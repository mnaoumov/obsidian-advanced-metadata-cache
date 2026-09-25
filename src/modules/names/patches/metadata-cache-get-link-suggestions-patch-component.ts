import type { LinkSuggestion } from '@obsidian-typings/obsidian-public-latest';
import type { MetadataCache } from 'obsidian';

import { MonkeyAroundComponent } from 'obsidian-dev-utils/obsidian/components/monkey-around-component';

import type { NameIndexComponent } from '../name-index-component.ts';

/**
 * The members this patch grafts onto `metadataCache.getLinkSuggestions`.
 *
 * `originalFn` and `safe` follow the convention the `getBacklinksForFile` patch established, and
 * `getPathsByName` / `getPathsByNameSafe` are the reverse lookup — a question Obsidian's flat,
 * unkeyed array can only answer by being scanned, and the reason this index exists at all beyond
 * making the autocomplete cheap.
 */
export interface GetLinkSuggestionsWrapper {
  /**
   * Finds every note that answers to a name — its basename, or one of its `aliases`.
   *
   * @param name - A basename or alias, in any casing and spacing.
   * @returns The vault-relative paths of the notes carrying that name, unranked and complete.
   */
  getPathsByName: (name: string) => string[];

  /**
   * {@link GetLinkSuggestionsWrapper.getPathsByName}, waiting for the index to be built first.
   *
   * @param name - A basename or alias, in any casing and spacing.
   * @returns The vault-relative paths of the notes carrying that name.
   */
  getPathsByNameSafe: (name: string) => Promise<string[]>;

  /**
   * Obsidian's own implementation, which rebuilds the whole array from a full vault walk.
   */
  // eslint-disable-next-line unicorn/name-replacements -- `originalFn` is this plugin's documented public API - the README tells users to call it.
  originalFn: () => LinkSuggestion[];

  /**
   * The indexed answer, waiting for the index to be built first.
   *
   * @returns The link suggestions.
   */
  safe: () => Promise<LinkSuggestion[]>;
}

type GetLinkSuggestionsFunction = MetadataCache['getLinkSuggestions'];

interface MetadataCacheGetLinkSuggestionsPatchComponentConstructorParams {
  readonly metadataCache: MetadataCache;
  readonly nameIndexComponent: NameIndexComponent;
}

/**
 * Answers `metadataCache.getLinkSuggestions()` from the name index instead of from a full vault walk.
 *
 * Every `[[` in the editor calls it — Obsidian's suggester memoizes the array only for as long as the
 * popover is open — so on a large vault this is the difference between a visible stall per open and
 * none.
 */
export class MetadataCacheGetLinkSuggestionsPatchComponent extends MonkeyAroundComponent {
  private readonly metadataCache: MetadataCache;
  private readonly nameIndexComponent: NameIndexComponent;

  public constructor(params: MetadataCacheGetLinkSuggestionsPatchComponentConstructorParams) {
    super();
    this.metadataCache = params.metadataCache;
    this.nameIndexComponent = params.nameIndexComponent;
  }

  public override onload(): void {
    this.registerMethodPatch({
      $object: this.metadataCache,
      methodName: 'getLinkSuggestions',
      patchHandler: ({ fallback }) => {
        // Until the eager build has run the index holds nothing, and nothing would ever fire an
        // event to complete it — so the original answer is the only correct one.
        return this.nameIndexComponent.isBuilt ? this.nameIndexComponent.nameIndex.getSuggestions() : fallback();
      },
      postPatchHandler: ({
        originalMethod,
        patchedMethod
      }): GetLinkSuggestionsFunction & GetLinkSuggestionsWrapper => {
        return Object.assign(patchedMethod, {
          getPathsByName: (name: string): string[] => this.nameIndexComponent.nameIndex.getPathsByName(name),
          getPathsByNameSafe: (name: string): Promise<string[]> => this.nameIndexComponent.getPathsByNameSafe(name),
          // eslint-disable-next-line unicorn/name-replacements -- `originalFn` is this plugin's documented public API - the README tells users to call it.
          originalFn: originalMethod.bind(this.metadataCache),
          safe: (): Promise<LinkSuggestion[]> => this.nameIndexComponent.getSuggestionsSafe()
        });
      }
    });
  }
}
