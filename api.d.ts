/**
 * @file
 *
 * This plugin's whole public surface, as a consumer sees it. Both kinds of it live here, because a
 * consumer asking "what do I compile against?" should find one file rather than two:
 *
 * - **Replaced core methods.** The `Backlinks` and `Names` modules answer by REPLACING a method
 *   Obsidian already has — `app.metadataCache.getBacklinksForFile()` and
 *   `app.metadataCache.getLinkSuggestions()` — so a consumer that only wants the faster answer calls
 *   core and never reaches for a handle. The patched methods keep Obsidian's own signature and carry
 *   nothing else: the members they also carried before `2.0.0` were removed, because nothing of this
 *   plugin's own belongs on an Obsidian function, and each has a replacement on the published API below.
 * - **A published API.** {@link AdvancedMetadataCacheApi} is published through the plugin registry
 *   under the plugin id `advanced-metadata-cache` and carries a contract version of its own. It
 *   answers what the `Titles`, `Headings`, `Properties`, `Unlinked mentions` and `Link texts` modules know, which core has no
 *   method for, and
 *   since contract `1.3.0` every extra the `Backlinks` and `Names` modules offer beyond the core call.
 *
 * Hand-written and self-contained on purpose: it imports from `obsidian` and nothing else, so a
 * plugin that has never heard of `@mnaoumov/obsidian-lib` can copy this file, or reference it, and depend
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
 * This plugin's API, published through the `@mnaoumov/obsidian-lib` plugin registry under the plugin id
 * `advanced-metadata-cache`.
 */
export interface AdvancedMetadataCacheApi {
  /**
   * Reads a note's backlinks from the `Backlinks` module's cache — the answer the patched
   * `app.metadataCache.getBacklinksForFile()` gives, reachable by path as well as by file.
   *
   * Fast, and possibly a moment behind a change Obsidian has not finished processing; use
   * {@link AdvancedMetadataCacheApi.getBacklinksForFileSafe} when the caller has just changed the vault.
   * Until the module has filled its cache, at startup, it answers with Obsidian's own implementation.
   *
   * Added in contract `1.3.0`, replacing the patched method called directly with a path.
   *
   * @param pathOrFile - The vault-relative path of a note, or the note itself.
   * @returns The backlinks, keyed by the path of each linking note; empty for a path no note answers to.
   *   `null` while the `Backlinks` module is off — call core then.
   */
  getBacklinksForFile(pathOrFile: string | TFile): CustomArrayDict<Reference> | null;

  /**
   * Calls Obsidian's own `getBacklinksForFile()`, bypassing the `Backlinks` module's cache — to compare
   * against it, or to get an answer that cannot depend on this plugin at all.
   *
   * Added in contract `1.3.0`, replacing `getBacklinksForFile.originalFn`.
   *
   * @param file - The note.
   * @returns Obsidian's answer. Never `null`: with the module off, core IS the original.
   */
  getBacklinksForFileOriginal(file: TFile): CustomArrayDict<Reference>;

  /**
   * {@link AdvancedMetadataCacheApi.getBacklinksForFile}, waiting first for every change already
   * reported to the cache to be processed.
   *
   * Added in contract `1.3.0`, replacing `getBacklinksForFile.safe`.
   *
   * @param pathOrFile - The vault-relative path of a note, or the note itself.
   * @returns The backlinks; `null` while the `Backlinks` module is off.
   */
  getBacklinksForFileSafe(pathOrFile: string | TFile): Promise<CustomArrayDict<Reference> | null>;

  /**
   * Lists the date-shaped values of the indexed frontmatter properties that fall in a range, in order —
   * answered from the `Properties` module's ordered index, without walking the vault.
   *
   * A value counts as a date when it is shaped `YYYY-MM-DD`, optionally followed by `THH:mm`, `THH:mm:ss` or
   * `THH:mm:ss.sss`: what Obsidian's own `date` and `datetime` properties write. A value with a time may also
   * carry an ISO 8601 offset (`Z`, `-06:00`, `+0200`) and an RFC 9557 time zone annotation (`[Europe/Kyiv]`).
   * By default, values are ordered and matched by their LOCAL part, the date and time as written with the zone dropped,
   * so `2026-10-26T23:00-06:00` is on the 26th and the bounds never carry a zone. A list contributes each such
   * member.
   * Since contract `1.8.0`, `timeBasis: 'utc'` instead matches and orders by instant, with complete
   * offset-bearing bounds and a per-query {@link DatedValuesQuery.missingTimeZone} policy.
   *
   * In a date property, a value of reduced precision counts too: a year (`2019`, also as an unquoted YAML
   * number) or a year and a month (`2019-05`), as ISO 8601 writes a date known only that far. It stands for
   * its whole period, never for the period's first day: it sorts at the START of its period (`2019` before
   * `2019-01-01`), a range matches it whenever the two OVERLAP (`{ from: '2019-05-10', to: '2019-05-20' }`
   * lists `2019` and `2019-05`), and it is reported as written, so its precision is the length of its
   * `value`. A recurring query skips a year alone and matches a month by the same overlap.
   *
   * Every property whose type is `date` or `datetime`, or whose name matches the plugin's `Date properties`
   * setting (by default `date` and `*Date`), is indexed without being registered, in each casing a note
   * spells it; a property registered through {@link AdvancedMetadataCacheApi.registerPropertyName}
   * contributes its date-shaped values too. A value that is not date-shaped is left out, never guessed:
   * {@link AdvancedMetadataCacheApi.getNonDateValues} lists those of the date properties.
   *
   * With {@link DatedValuesQuery.isRecurring} on, the year is ignored, so a birthday is found in every year:
   * `{ from: '10-26', to: '11-25', isRecurring: true }` lists the next month's birthdays, and a `from`
   * after `to` wraps the end of the year.
   *
   * Answers from the index as it stands, as {@link AdvancedMetadataCacheApi.getPathsByPropertyValue} does;
   * use {@link AdvancedMetadataCacheApi.getDatedValuesSafe} when that matters.
   *
   * Added in contract `1.5.0`.
   *
   * @param query - The range, and the properties to read; an empty query lists every dated value.
   * @returns The values, ordered by the chosen time basis (by month and day first, then by year, when recurring), then by
   *   property name, then by path. `null` when `propertyNames` names a property nobody registered and no
   *   note carries as a date, and while the `Properties` module is off.
   */
  getDatedValues(query: DatedValuesQuery): DatedValue[] | null;

  /**
   * {@link AdvancedMetadataCacheApi.getDatedValues}, waiting first for the index to be rebuilt from the
   * metadata cache.
   *
   * Added in contract `1.5.0`.
   *
   * @param query - The range, and the properties to read.
   * @returns The values, in order; `null` as for {@link AdvancedMetadataCacheApi.getDatedValues}.
   */
  getDatedValuesSafe(query: DatedValuesQuery): Promise<DatedValue[] | null>;

  /**
   * Lists the values of the date properties that are NOT date-shaped, and so are left out of
   * {@link AdvancedMetadataCacheApi.getDatedValues}: a time alone (`14:30`), a free-text date, a typo. A year
   * or a month of reduced precision (`2019`, `2019-05`) is a date, so it is not listed. A date
   * property is one {@link AdvancedMetadataCacheApi.getDatedValues} indexes without a registration, by its
   * type or by its name; a registered property of another type is not one, so its other values are not
   * listed.
   *
   * Answers from the index as it stands; use {@link AdvancedMetadataCacheApi.getNonDateValuesSafe} when that
   * matters.
   *
   * Added in contract `1.6.0`.
   *
   * @returns The values, ordered by path, then by property name, then by value; `null` while the
   *   `Properties` module is off.
   */
  getNonDateValues(): DatedValue[] | null;

  /**
   * {@link AdvancedMetadataCacheApi.getNonDateValues}, waiting first for the index to be rebuilt from the
   * metadata cache.
   *
   * Added in contract `1.6.0`.
   *
   * @returns The values; `null` while the `Properties` module is off.
   */
  getNonDateValuesSafe(): Promise<DatedValue[] | null>;

  /**
   * Reads when each of a note's headings was created, last modified and last seen.
   *
   * Obsidian keeps no per-heading metadata, so the `Headings` module keeps it: it compares each parse of
   * a note with the previous one to work out which heading is which, across renames, moves and level
   * changes, and stores the times in this plugin's own folder, never in the note. Synchronous, and current
   * as of the last parse Obsidian announced, so a caller that has just edited the note should await
   * `@mnaoumov/obsidian-lib`'s `getCacheSafe` (or the next `changed` event) first.
   *
   * The times are what this device saw: a change arriving from another device is stamped when it arrives
   * here. A time is `null` when the plugin did not see the event happen — a heading already
   * there when its note started being tracked has neither `created` nor `modified`. A sort should place
   * `null` as the oldest and keep document order among equals.
   *
   * Added in contract `1.2.0`.
   *
   * @param pathOrFile - The vault-relative path of a note, or the note itself.
   * @returns The note's headings in document order. Empty for a path no note answers to, for a note with
   *   no headings, and while the `Headings` module is off.
   */
  getHeadingTimes(pathOrFile: string | TFile): HeadingTimes[];

  /**
   * Reads the display texts that links pointing at a file use instead of its name: `alpha` for
   * `[alpha](bravo.md)` or `[[bravo|alpha]]`, `boarding pass` for `![[IMG_2231.jpg|boarding pass]]`. A label source
   * beside a note's `aliases` and titles, and for an attachment the only name it has besides its file name.
   *
   * A link counts when its display text was WRITTEN, in the body or in a frontmatter value, embeds included, and
   * resolves to the file. `[[bravo]]` writes none, and a written text that is only the file's own name again
   * (`[bravo](bravo.md)`, `[[Notes/bravo|Notes/bravo]]`) is left out, compared case-insensitively with runs of
   * whitespace collapsed. An embed's size (`|300`, `|300x200`) is not part of its text. Texts are distinct as
   * written, after trimming; an alias the file already declares is NOT left out, so a caller merging this with
   * `aliases` drops its own repeats.
   *
   * Answered from the `Link texts` module's index, built from the links Obsidian has already parsed and kept
   * current by its link resolution; it is empty until built at startup, so use
   * {@link AdvancedMetadataCacheApi.getLinkTextsSafe} when you may be asked early, and
   * {@link AdvancedMetadataCacheApi.onLinkTextsChanged} to learn when an answer changed.
   *
   * Added in contract `1.9.0`.
   *
   * @param pathOrFile - The vault-relative path of any file, or the file itself.
   * @returns The distinct texts, the most used first, then in code-unit order; empty for a file no link names
   *   differently. `null` while the `Link texts` module is off.
   */
  getLinkTexts(pathOrFile: string | TFile): LinkText[] | null;

  /**
   * {@link AdvancedMetadataCacheApi.getLinkTexts}, waiting for the index to be built first.
   *
   * Added in contract `1.9.0`.
   *
   * @param pathOrFile - The vault-relative path of any file, or the file itself.
   * @returns The distinct texts; `null` while the `Link texts` module is off.
   */
  getLinkTextsSafe(pathOrFile: string | TFile): Promise<LinkText[] | null>;

  /**
   * Every link target the `[[` autocomplete can offer, answered from the `Names` module's index — the
   * answer the patched `app.metadataCache.getLinkSuggestions()` gives.
   *
   * Until the index is built, at startup, it answers with Obsidian's own implementation; use
   * {@link AdvancedMetadataCacheApi.getLinkSuggestionsSafe} to wait for the index instead.
   *
   * Added in contract `1.3.0`.
   *
   * @returns The link suggestions, Obsidian's own array entry for entry unless the user has switched on
   *   offering titles, which appends entries after it. `null` while the `Names` module is off — call
   *   core then.
   */
  getLinkSuggestions(): LinkSuggestion[] | null;

  /**
   * Calls Obsidian's own `getLinkSuggestions()`, bypassing the `Names` module's index — a full vault walk.
   *
   * Added in contract `1.3.0`, replacing `getLinkSuggestions.originalFn`.
   *
   * @returns Obsidian's answer. Never `null`: with the module off, core IS the original.
   */
  getLinkSuggestionsOriginal(): LinkSuggestion[];

  /**
   * {@link AdvancedMetadataCacheApi.getLinkSuggestions}, waiting for the index to be built first.
   *
   * Added in contract `1.3.0`, replacing `getLinkSuggestions.safe`.
   *
   * @returns The link suggestions; `null` while the `Names` module is off.
   */
  getLinkSuggestionsSafe(): Promise<LinkSuggestion[] | null>;

  /**
   * Finds every note that answers to a name — its basename, one of its `aliases`, or one of its titles.
   *
   * The answer is a LIST, because several notes may declare the same alias, and it is unranked and
   * complete: which of them the user meant is a question about the caller's context. Matched
   * case-insensitively and with runs of whitespace collapsed, as Obsidian resolves a wikilink.
   *
   * Answers from the index as it stands, which is empty until it is built at startup; use
   * {@link AdvancedMetadataCacheApi.getPathsByNameSafe} when you may be asked early.
   *
   * Added in contract `1.3.0`, replacing `getLinkSuggestions.getPathsByName`.
   *
   * @param name - A basename, alias or title, in any casing and spacing.
   * @returns The vault-relative paths of the notes carrying that name; `null` while the `Names` module is
   *   off.
   */
  getPathsByName(name: string): null | string[];

  /**
   * {@link AdvancedMetadataCacheApi.getPathsByName}, waiting for the index to be built first.
   *
   * Added in contract `1.3.0`, replacing `getLinkSuggestions.getPathsByNameSafe`.
   *
   * @param name - A basename, alias or title, in any casing and spacing.
   * @returns The vault-relative paths; `null` while the `Names` module is off.
   */
  getPathsByNameSafe(name: string): Promise<null | string[]>;

  /**
   * Finds every note whose frontmatter property holds a value: the property itself, when it is a scalar,
   * or one of its members, when it is a list.
   *
   * Only a property registered through {@link AdvancedMetadataCacheApi.registerPropertyName} is indexed.
   * Matched exactly, name and value alike; a number or a boolean is matched by its string form, so `7`
   * finds `key: 7`. `null` and objects are never matched.
   *
   * Answers from the index as it stands. At startup that is the index saved by the previous session, which
   * answers at once but does not yet know what changed while Obsidian was closed; use
   * {@link AdvancedMetadataCacheApi.getPathsByPropertyValueSafe} when that matters.
   *
   * Added in contract `1.4.0`.
   *
   * @param propertyName - The property name.
   * @param value - The value to look for.
   * @returns The vault-relative paths of the notes holding it, unordered; `null` for a property nobody
   *   registered and while the `Properties` module is off — walk the vault then.
   */
  getPathsByPropertyValue(propertyName: string, value: string): null | string[];

  /**
   * {@link AdvancedMetadataCacheApi.getPathsByPropertyValue}, waiting first for the index to be rebuilt
   * from the metadata cache.
   *
   * Added in contract `1.4.0`.
   *
   * @param propertyName - The property name.
   * @param value - The value to look for.
   * @returns The vault-relative paths; `null` for a property nobody registered and while the `Properties`
   *   module is off.
   */
  getPathsByPropertyValueSafe(propertyName: string, value: string): Promise<null | string[]>;

  /**
   * Finds every note carrying a frontmatter property at all, whatever its value — `null` and an empty list
   * included.
   *
   * Answers from the index as it stands, as {@link AdvancedMetadataCacheApi.getPathsByPropertyValue} does.
   *
   * Added in contract `1.4.0`.
   *
   * @param propertyName - The property name, registered through
   *   {@link AdvancedMetadataCacheApi.registerPropertyName}.
   * @returns The vault-relative paths, unordered; `null` for a property nobody registered and while the
   *   `Properties` module is off.
   */
  getPathsWithProperty(propertyName: string): null | string[];

  /**
   * {@link AdvancedMetadataCacheApi.getPathsWithProperty}, waiting first for the index to be rebuilt from
   * the metadata cache.
   *
   * Added in contract `1.4.0`.
   *
   * @param propertyName - The property name.
   * @returns The vault-relative paths; `null` for a property nobody registered and while the `Properties`
   *   module is off.
   */
  getPathsWithPropertySafe(propertyName: string): Promise<null | string[]>;

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
   * AdvancedMetadataCacheApi.getTitlePropertyNames} names, then the names the user's name patterns build
   * from the note's name parts (such as `lastName` and `firstName`), once per language those parts list.
   *
   * Lazily memoized per file and kept current by the vault's own events, so asking repeatedly costs a
   * map lookup. Synchronous, and safe to call from a suggester's per-keystroke path, which is what it
   * is for.
   *
   * @param pathOrFile - The vault-relative path of a note, or the note itself.
   * @returns Its titles, exactly as they were typed, in the order the configured properties were
   *   typed, then the built names in the order the patterns were typed, with repeats dropped
   *   case-insensitively. Empty for a note carrying none, for a path no
   *   file answers to, and while the `Titles` module is off.
   */
  getTitles(pathOrFile: string | TFile): string[];

  /**
   * Finds every note that mentions a note without linking to it: what the Backlinks pane's `Unlinked mentions`
   * section lists, note for note and match for match.
   *
   * A note is mentioned by its basename or one of its `aliases`, matched case-insensitively (no diacritic folding),
   * as a whole word where the name starts or ends with a letter or a digit. A match is not counted when it lies inside
   * a link, an embed or the frontmatter; one inside code is counted, as Obsidian counts it. The note itself and the
   * notes excluded from the vault's search are never listed.
   *
   * Answered from the `Unlinked mentions` module's index, which reads only the notes whose text holds one of the
   * names. Waits for the index to be built first, at startup. Always asynchronous, because the candidate notes are
   * read to confirm each match.
   *
   * Added in contract `1.7.0`.
   *
   * @param pathOrFile - The vault-relative path of a note, or the note itself.
   * @returns The mentioning notes, ordered by path; empty for a path no file answers to. `null` while the
   *   `Unlinked mentions` module is off.
   */
  getUnlinkedMentions(pathOrFile: string | TFile): Promise<null | UnlinkedMention[]>;

  /**
   * Offers the user title properties another plugin used to own, and adds the ones they approve to
   * {@link AdvancedMetadataCacheApi.getTitlePropertyNames}.
   *
   * For a plugin that stops owning a title property of its own: it proposes the value it held, and this
   * plugin — which owns the list, and so owns the dialog — shows the user the proposed names next to the
   * current list and lets them approve, edit or decline. The proposed names are ADDED to the list rather
   * than replacing it, so a user who already has `title` keeps it. While the `Titles` module is off, the
   * dialog also offers to switch it on, since the names answer nothing until it is.
   *
   * Resolves only once the dialog is closed, and without one at all when there is nothing to change.
   * Proposals arriving together are shown one after another, never stacked.
   *
   * Added in contract `1.1.0`.
   *
   * @param params - The proposal.
   * @returns Whether the user applied it. On `false` nothing was written, and the offer should come back.
   */
  migrateSettings(params: MigrateSettingsParams): Promise<MigrateSettingsResult>;

  /**
   * Subscribes to changes of {@link AdvancedMetadataCacheApi.getLinkTexts}'s answers.
   *
   * The callback is called synchronously after each change, with the paths of the files whose link texts changed,
   * or with `null` when any of them may have: when the index has just been built, and when it is cleared because the
   * `Link texts` module was switched off or on. The subscription lasts until the returned function is called,
   * whatever happens to the module meanwhile, so a caller subscribes once on load and unsubscribes on unload.
   *
   * Added in contract `1.9.0`.
   *
   * @param callback - Called with the changed paths, or `null` for any of them.
   * @returns A function that ends the subscription.
   */
  onLinkTextsChanged(callback: LinkTextsChangedCallback): () => void;

  /**
   * Asks the `Properties` module to index a frontmatter property, so
   * {@link AdvancedMetadataCacheApi.getPathsByPropertyValue} and
   * {@link AdvancedMetadataCacheApi.getPathsWithProperty} can answer about it.
   *
   * Call it once on load; a name already registered is left as it is. The registration is DURABLE: it is
   * saved with the index, so at the next startup the property is answered from disk before the
   * registering plugin has even loaded. There is no unregister — a property nobody asks about any more
   * costs a map entry per note that carries it.
   *
   * Registering while the `Properties` module is off is kept, and indexed once the module is switched on.
   *
   * A property whose type is `date` or `datetime` needs no registration: it is registered automatically,
   * for {@link AdvancedMetadataCacheApi.getDatedValues}, and so answers the other lookups as well.
   *
   * Added in contract `1.4.0`.
   *
   * @param propertyName - The property name, matched exactly.
   */
  registerPropertyName(propertyName: string): void;
}

/**
 * The settings another plugin may propose through {@link AdvancedMetadataCacheApi.migrateSettings}.
 *
 * Structurally the payload of `@mnaoumov/obsidian-lib`'s `SettingsMigrationApi<TMigratableSettings>`, whose
 * envelope {@link MigrateSettingsParams} and {@link MigrateSettingsResult} restate here so this file keeps
 * importing from `obsidian` alone; the plugin's build checks the two stay assignable.
 */
export interface AdvancedMetadataCacheMigratableSettings {
  /**
   * Frontmatter properties to add to the title properties, e.g. `['subtitle']`.
   */
  readonly titlePropertyNames?: readonly string[];
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
 * One value of one indexed frontmatter property, as {@link AdvancedMetadataCacheApi.getDatedValues} reports
 * its date-shaped values and {@link AdvancedMetadataCacheApi.getNonDateValues} the rest. A note whose
 * property lists several values gives one of these per value.
 */
export interface DatedValue {
  /**
   * The vault-relative path of the note.
   */
  readonly path: string;

  /**
   * The property name, as the note spells it for a date-typed property, and as it was registered otherwise.
   */
  readonly propertyName: string;

  /**
   * The value, exactly as the frontmatter holds it, e.g. `2026-10-26`, `2026-10-26T09:30` or
   * `2026-10-26T09:30:00+02:00[Europe/Kyiv]`, zone included; a reduced-precision date stays `2019` or
   * `2019-05`, never padded to a day. A number or a boolean is in its string form.
   */
  readonly value: string;
}

/**
 * An explicit time zone for a UTC query's zone-free calendar values.
 */
export interface SpecificTimeZone {
  /** An IANA time zone, for example `Europe/Kyiv`. */
  readonly zone: string;
}

/**
 * A range for {@link AdvancedMetadataCacheApi.getDatedValues}. Wall-clock bounds are inclusive prefixes
 * of the local date and time. UTC bounds are inclusive complete date and time values with an offset.
 */
export interface DatedValuesQuery {
  /**
   * The ordering and bounds to use. UTC bounds are complete ISO date and time values with an offset, inclusive,
   * and cannot be combined with `isRecurring`. Wall-clock queries retain prefix bounds.
   * @defaultValue `'wallClock'`
   */
  readonly timeBasis?: 'utc' | 'wallClock';

  /**
   * How UTC queries interpret values without a zone. `default` uses the Default time zone setting
   * (the device zone when empty); `utc` uses UTC; `{ zone: 'Europe/Kyiv' }` uses that zone; `skip`
   * omits them; `fail` throws for a zoneless value overlapping the range in the default zone.
   * Date-only, month and year values cover their whole period. DST gaps move forward and overlaps
   * choose the earlier instant, as Temporal's compatible disambiguation does. Explicit offsets
   * take precedence over zone annotations. Invalid zones and UTC bounds throw a `RangeError`.
   * @defaultValue `'default'`
   */
  readonly missingTimeZone?: 'default' | 'fail' | 'skip' | 'utc' | SpecificTimeZone;

  /**
   * The earliest value to include; no lower bound when left out. A date, a datetime or a prefix of one
   * (`2026`, `2026-10`, `2026-10-26T09`); with {@link DatedValuesQuery.isRecurring} on, a month and day
   * (`10-26`) or a month (`10`).
   */
  readonly from?: string;

  /**
   * Whether to match and order by month and day alone, ignoring the year, as for a birthday or an
   * anniversary. A `from` after `to` then wraps the end of the year: `{ from: '12-15', to: '01-15' }`.
   */
  readonly isRecurring?: boolean;

  /**
   * The properties to read, matched exactly; every indexed property when left out.
   */
  readonly propertyNames?: readonly string[];

  /**
   * The latest value to include; no upper bound when left out. Compared over its own length, so `2026-10-31`
   * includes `2026-10-31T23:59` and `2026-10` includes the whole of October. The same forms as
   * {@link DatedValuesQuery.from}.
   */
  readonly to?: string;
}

/**
 * One heading's times, as {@link AdvancedMetadataCacheApi.getHeadingTimes} reports them. Every time is a
 * Unix epoch in milliseconds.
 */
export interface HeadingTimes {
  /**
   * When the heading first appeared, or `null` when it was already there when its note started being
   * tracked.
   */
  readonly created: null | number;

  /**
   * The heading text, as the metadata cache reports it.
   */
  readonly heading: string;

  /**
   * The heading level, 1 to 6.
   */
  readonly level: number;

  /**
   * The zero-based line the heading was on at the last parse.
   */
  readonly line: number;

  /**
   * When the heading's section — its own line and everything under it, subheadings included — last
   * changed, or `null` when it has not changed since its note started being tracked. Moving the whole
   * section elsewhere in the note does not count as a change to it.
   */
  readonly modified: null | number;

  /**
   * When the heading's own section — up to the next heading of any level — was last on screen in the
   * active editor for at least one ~2 s dwell while the window had focus, or `null` when it has not
   * been. Reading view is not measured.
   */
  readonly seen: null | number;
}

/**
 * One distinct display text of a file, as {@link AdvancedMetadataCacheApi.getLinkTexts} reports it.
 */
export interface LinkText {
  /**
   * How many links use it, across every note.
   */
  readonly count: number;

  /**
   * The vault-relative paths of the notes whose links use it, in code-unit order.
   */
  readonly sourcePaths: readonly string[];

  /**
   * The display text, as written and trimmed.
   */
  readonly text: string;
}

/**
 * The callback of {@link AdvancedMetadataCacheApi.onLinkTextsChanged}.
 *
 * @param targetPaths - The paths of the files whose link texts changed, or `null` when any of them may have.
 */
export type LinkTextsChangedCallback = (targetPaths: null | readonly string[]) => void;

/**
 * Parameters for {@link AdvancedMetadataCacheApi.migrateSettings}.
 */
export interface MigrateSettingsParams {
  /**
   * The values the proposing plugin offers.
   */
  readonly proposedSettings: AdvancedMetadataCacheMigratableSettings;

  /**
   * The `manifest.id` of the plugin making the proposal, so the dialog can say whose settings these are.
   */
  readonly sourcePluginId: string;
}

/**
 * The outcome of {@link AdvancedMetadataCacheApi.migrateSettings}.
 */
export interface MigrateSettingsResult {
  /**
   * Whether the user approved the migration. `false` means they cancelled and nothing was written, so the
   * proposing plugin must NOT record the migration as done.
   */
  readonly isApplied: boolean;
}

/**
 * One note that mentions another without linking to it, as
 * {@link AdvancedMetadataCacheApi.getUnlinkedMentions} reports it.
 */
export interface UnlinkedMention {
  /**
   * The vault-relative path of the mentioning note.
   */
  readonly path: string;

  /**
   * Where its text mentions the note, ordered by position. Two names of the note may match overlapping text, and
   * then both spans are listed.
   */
  readonly ranges: readonly UnlinkedMentionRange[];
}

/**
 * A span of a note's text, in UTF-16 offsets from the start of the file, frontmatter included.
 */
export interface UnlinkedMentionRange {
  /**
   * The offset just past the span's last character.
   */
  readonly end: number;

  /**
   * The offset of the span's first character.
   */
  readonly start: number;
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
