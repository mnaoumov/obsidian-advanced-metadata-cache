import type {
  CustomArrayDict,
  LinkSuggestion
} from '@obsidian-typings/obsidian-public-latest';
import type {
  Reference,
  TFile
} from 'obsidian';

/**
 * Extended implementation of the `app.metadataCache.getBacklinksForFile` method from Obsidian.
 *
 * Usages:
 * - `(app.metadataCache.getBacklinksForFile as GetBacklinksForFileFn)(pathOrFile)`
 * - `(app.metadataCache.getBacklinksForFile as GetBacklinksForFileFn).originalFn(file)`
 * - `(app.metadataCache.getBacklinksForFile as GetBacklinksForFileFn).safe(pathOrFile)`
 */
interface GetBacklinksForFileFn {
  /**
   * Fast implementation that might be inconsistent if the file changes are not processed yet.
   *
   * @param pathOrFile - The path or file to get the backlinks for.
   * @returns The backlinks for the file.
   */
  (pathOrFile: string | TFile): CustomArrayDict<Reference>;

  /**
   * Original implementation from Obsidian.
   *
   * @param file - The file to get the backlinks for.
   * @returns The backlinks for the file.
   */
  originalFn(file: TFile): CustomArrayDict<Reference>;

  /**
   * Safe asynchronous implementation that waits for the file changes to be processed.
   *
   * @param pathOrFile - The path or file to get the backlinks for.
   * @returns The backlinks for the file.
   */
  safe(pathOrFile: string | TFile): Promise<CustomArrayDict<Reference>>;
}

/**
 * Extended implementation of the `app.metadataCache.getLinkSuggestions` method from Obsidian,
 * present while the `Names` module is on.
 *
 * Usages:
 * - `(app.metadataCache.getLinkSuggestions as GetLinkSuggestionsFn)()`
 * - `(app.metadataCache.getLinkSuggestions as GetLinkSuggestionsFn).originalFn()`
 * - `(app.metadataCache.getLinkSuggestions as GetLinkSuggestionsFn).safe()`
 * - `(app.metadataCache.getLinkSuggestions as GetLinkSuggestionsFn).getPathsByName(name)`
 * - `(app.metadataCache.getLinkSuggestions as GetLinkSuggestionsFn).getPathsByNameSafe(name)`
 */
interface GetLinkSuggestionsFn {
  /**
   * Fast implementation, answered from the index rather than from a full vault walk. Until the
   * index has finished building it falls through to Obsidian's own implementation.
   *
   * @returns Every link target the `[[` autocomplete can offer.
   */
  (): LinkSuggestion[];

  /**
   * Finds every note that answers to a name — its basename, or one of its `aliases`.
   *
   * The answer is a LIST, because several notes may declare the same alias, and it is unranked and
   * complete: which of them the user meant is a question about the caller's context.
   *
   * @param name - A basename or alias, in any casing and spacing.
   * @returns The vault-relative paths of the notes carrying that name.
   */
  getPathsByName(name: string): string[];

  /**
   * Safe asynchronous implementation of {@link GetLinkSuggestionsFn.getPathsByName} that waits for
   * the index to be built.
   *
   * @param name - A basename or alias, in any casing and spacing.
   * @returns The vault-relative paths of the notes carrying that name.
   */
  getPathsByNameSafe(name: string): Promise<string[]>;

  /**
   * Original implementation from Obsidian.
   *
   * @returns Every link target the `[[` autocomplete can offer.
   */
  originalFn(): LinkSuggestion[];

  /**
   * Safe asynchronous implementation that waits for the index to be built.
   *
   * @returns Every link target the `[[` autocomplete can offer.
   */
  safe(): Promise<LinkSuggestion[]>;
}
