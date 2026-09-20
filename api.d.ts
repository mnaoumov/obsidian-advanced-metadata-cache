/**
 * @file
 *
 * This plugin's published API, as a consumer sees it.
 *
 * Hand-written and self-contained on purpose: it imports from `obsidian` and nothing else, so a plugin
 * that has never heard of `obsidian-dev-utils` can copy this file, or reference it, and depend on this
 * plugin with no build-time dependency on this repository at all.
 *
 * **This is not the whole surface.** Two of this plugin's modules answer by REPLACING a method Obsidian
 * already has — `app.metadataCache.getBacklinksForFile()` and `app.metadataCache.getLinkSuggestions()`
 * — so a consumer of those calls core and never reaches for a handle. Their widened signatures are
 * declared in `types.d.ts` beside this file. What lives here is the other kind: an answer core has no
 * method for, so there is nothing to widen and the API is published through the plugin registry
 * instead.
 */

import type { TFile } from 'obsidian';

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
