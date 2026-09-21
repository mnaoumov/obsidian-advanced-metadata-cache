/**
 * @file
 *
 * This plugin's whole public surface, as a consumer sees it. Both kinds of it live here, because a
 * consumer asking "what do I compile against?" should find one file rather than two:
 *
 * - **Widened core methods.** The `Backlinks` and `Names` modules answer by REPLACING a method
 *   Obsidian already has — `app.metadataCache.getBacklinksForFile()` and
 *   `app.metadataCache.getLinkSuggestions()` — so a consumer calls core and never reaches for a
 *   handle. {@link GetBacklinksForFileFn} and {@link GetLinkSuggestionsFn} declare what those calls
 *   can do while the module is on. There is nothing to fetch and nothing to version-negotiate: the
 *   patch is installed or it is not, so a member is pinned against the plugin version it arrived in,
 *   which the README records.
 * - **A published API.** The `Titles` module answers a question core has no method for, so there is
 *   nothing to widen; {@link AdvancedMetadataCacheApi} is published through the plugin registry under
 *   the plugin id `advanced-metadata-cache` and carries a contract version of its own.
 *
 * Hand-written and self-contained on purpose: it imports from `obsidian` and nothing else, so a
 * plugin that has never heard of `obsidian-dev-utils` can copy this file, or reference it, and depend
 * on this plugin with no build-time dependency on this repository at all.
 *
 * {@link CustomArrayDict} and {@link LinkSuggestion} are therefore INLINED rather than imported from
 * `@obsidian-typings/obsidian-public-latest`, where they are declared — structurally copied from
 * `@obsidian-typings/obsidian-public-1.13.7`. That trade was made deliberately: the drift cost is
 * bounded, since a structural copy stays assignable in both directions while upstream only adds
 * optional members, and a required addition is a change a consumer would have to handle anyway;
 * the import cost is not, since a stranger who wanted one interface would install a typings package
 * to get it. If a future member of this file cannot be inlined that cheaply, the file stops being
 * copyable, which is the property to protect first.
 */

import type {
  Reference,
  TFile
} from 'obsidian';

/**
 * This plugin's API, published through the `obsidian-dev-utils` plugin registry under the plugin id
 * `advanced-metadata-cache`.
 */
export interface AdvancedMetadataCacheApi {
  /**
   * The frontmatter properties whose values currently count as a note's title.
   *
   * There to be READ rather than re-typed: the point of the setting living in this plugin is that a
   * consumer which also cares about titles does not ask its own user to name the property a second
   * time. Show this list, do not offer a setting of your own.
   *
   * A fresh array on each call, so writing to it changes nothing here.
   *
   * @returns The configured property names, in the order they were typed. **Empty while the `Titles`
   *   module is off**, which is the same answer as "none are configured" and is meant to be: either
   *   way there is nothing to read.
   */
  getTitlePropertyNames(): string[];

  /**
   * Reads one note's titles — the values of the properties {@link
   * AdvancedMetadataCacheApi.getTitlePropertyNames} names.
   *
   * Lazily memoized per file and kept current by the vault's own events, so asking repeatedly costs a
   * map lookup. Synchronous, and safe to call from a suggester's per-keystroke path, which is what it
   * is for.
   *
   * @param pathOrFile - The vault-relative path of a note, or the note itself.
   * @returns Its titles, exactly as they were typed, in the order the configured properties were
   *   typed, with repeats dropped case-insensitively. Empty for a note carrying none, for a path no
   *   file answers to, and while the `Titles` module is off.
   */
  getTitles(pathOrFile: string | TFile): string[];
}

/**
 * A dictionary mapping string keys to arrays of values — Obsidian's own return type for backlinks.
 *
 * Inlined from `@obsidian-typings/obsidian-public-1.13.7` so this file imports from `obsidian` alone;
 * it is structurally identical, so a consumer that does have the typings package can use either.
 *
 * @typeParam T - The type of the values.
 */
export interface CustomArrayDict<T> {
  /**
   * Internal map storing key-to-array mappings.
   */
  data: Map<string, T[]>;

  /**
   * Add a value to the array associated with the given key.
   *
   * @param key - The key.
   * @param value - The value to add.
   */
  add(key: string, value: T): void;

  /**
   * Remove all values for the given key.
   *
   * @param key - The key to clear.
   */
  clear(key: string): void;

  /**
   * Remove all keys and their values.
   */
  clearAll(): void;

  /**
   * Check whether the array for the given key contains the specified value.
   *
   * @param key - The key.
   * @param value - The value to check.
   * @returns Whether the value exists.
   */
  contains(key: string, value: T): boolean;

  /**
   * Get the total number of values across all keys.
   *
   * @returns Total value count.
   */
  count(): number;

  /**
   * Get the array of values for the given key, or `null` if not found.
   *
   * @param key - The key.
   * @returns Array of values, or `null`.
   */
  get(key: string): null | T[];

  /**
   * Get all keys in the dictionary.
   *
   * @returns Array of keys.
   */
  keys(): string[];

  /**
   * Remove a specific value from the array associated with the given key.
   *
   * @param key - The key.
   * @param value - The value to remove.
   */
  remove(key: string, value: T): void;
}

/**
 * Extended implementation of the `app.metadataCache.getBacklinksForFile` method from Obsidian,
 * present while the `Backlinks` module is on.
 *
 * Usages:
 * - `(app.metadataCache.getBacklinksForFile as GetBacklinksForFileFn)(pathOrFile)`
 * - `(app.metadataCache.getBacklinksForFile as GetBacklinksForFileFn).originalFn(file)`
 * - `(app.metadataCache.getBacklinksForFile as GetBacklinksForFileFn).safe(pathOrFile)`
 */
export interface GetBacklinksForFileFn {
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
export interface GetLinkSuggestionsFn {
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

/**
 * A link target the `[[` autocomplete can offer — Obsidian's own entry type.
 *
 * Inlined from `@obsidian-typings/obsidian-public-1.13.7` (where it is `LinkSuggestion extends
 * FileSuggestion`, flattened here so this file declares one interface rather than two) so this file
 * imports from `obsidian` alone; it is structurally identical, so a consumer that does have the
 * typings package can use either.
 */
export interface LinkSuggestion {
  /**
   * Resolved link note alias.
   */
  alias?: string;

  /**
   * The file.
   */
  file: null | TFile;

  /**
   * The path.
   */
  path: string;
}
