import type { LinkSuggestion } from '@obsidian-typings/obsidian-public-latest';
import type { MetadataCache } from 'obsidian';

import { MonkeyAroundComponent } from '@mnaoumov/obsidian-lib/components/monkey-around-component';

import type { NameIndexComponent } from '../name-index-component.ts';

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
  private originalMethod: GetLinkSuggestionsFunction | null = null;

  public constructor(params: MetadataCacheGetLinkSuggestionsPatchComponentConstructorParams) {
    super();
    this.metadataCache = params.metadataCache;
    this.nameIndexComponent = params.nameIndexComponent;
  }

  /**
   * Calls the method this patch replaced: Obsidian's own, or whatever another plugin had installed first.
   *
   * Kept in a field of this component rather than read off the patched method, so the published API can
   * offer it without anything being grafted onto an Obsidian function. Before the patch is installed the
   * method on the metadata cache is still the original, so that is what answers.
   *
   * @returns Every link target the `[[` autocomplete can offer, from a full vault walk.
   */
  public getLinkSuggestionsOriginal(): LinkSuggestion[] {
    return (this.originalMethod ?? this.metadataCache.getLinkSuggestions).call(this.metadataCache);
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
      postPatchHandler: ({ originalMethod }) => {
        this.originalMethod = originalMethod;
      }
    });
  }
}
