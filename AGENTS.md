# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code
in this repository.

## Every index is a module, and a module is a component

`src/modules/` holds one folder per index. Each is declared to `ModulesComponent`
(`src/modules/modules-component.ts`) as a `ModuleDefinition`: how to build its component, and which
`PluginSettings` toggle decides whether it runs. `ModulesComponent` adds the component as a child when
the toggle goes on and removes it when it goes off, live, off the settings component's `saveSettings`
event — so a module's whole footprint (its index, its listeners, its patches, its commands) is tied to
one component's lifecycle and nothing survives it being switched off.

That is why a module registers its own commands rather than letting the plugin do it: see
`BacklinksModuleComponent`, which passes itself as the `lifetimeOwner`. A command registered by the
plugin would stay in the palette calling into a torn-down index.

Adding a module means adding its folder, its toggle to `PluginSettings`, its row to
`getSettingDefinitionItems`, and one entry to the array in `Plugin.onloadImpl`. Nothing else knows how
many modules there are. The `backlinks` module defaults **on**, because it is the behavior this plugin
inherited wholesale from `Backlink Cache`; a module added later defaults **off**.

## The `names` module: the patch goes in BEFORE the index is built

`NameIndexComponent.onload` installs `MetadataCacheGetLinkSuggestionsPatchComponent`, and the index is built
only later, on layout ready or by the first `Safe` call, and the order is deliberate: while the index is empty the
patch falls through to Obsidian's own `getLinkSuggestions`, so there is no window in which a caller is handed a
half-built answer. The patch reads `isBuilt` on every call to decide. It was installed on layout ready until
`2.2.0`, which let a `Safe` call that started the build settle before the patch was in, so a caller that then
asked core got Obsidian's answer; the on/off tripwire reported exactly 1.0 for it on a vault whose cache settled
quickly.

The cost is that the presence of the patch says nothing about whether the index is ready — which is what
the API's `getLinkSuggestionsSafe()` and `getPathsByNameSafe()` are for, and what `docs/api.md` tells
consumers to use when they may be asked early. A test that waits for the patch to appear and then
measures is measuring Obsidian; the tripwire suite in this module was written that way once and reported
a speedup of exactly 1.0.

What is memoized is the per-file half: a file's display path, its alias entries and its names, keyed by
path and dropped when that path changes. The flat array is rebuilt by walking `vault.getFiles()`, which
costs a map lookup per file and is what keeps the answer in the same order as Obsidian's own.

Measured against the generated performance vault: the built-in call is ~23 ms at 20k files and ~108 ms at
90k, linear in vault size, and the `[[` autocomplete pays it on **every** open because
`FileSuggestManager.close()` nulls its memo. The indexed answer is ~0.005 ms.

## The `titles` module: the one place two modules touch, and why it is not a memo

`TitleIndex` is built by `Plugin.onloadImpl` rather than by either module that uses it, because both
`names` and `titles` read it and each is switched on independently of the other. It gates itself on
`isTitlesModuleEnabled`, so both callers get the same answer whatever the other module is doing, and
`TitleIndexComponent` owns only the invalidation — plus a `clear()` at **both** of its edges, since
nothing invalidates the index while the module is off and a `title` changed in that window has no event
left to replay.

`NameIndex` does **not** read through that memo. It calls the exported `readTitles` with the frontmatter
it has already fetched for `aliases`. Both components listen to `changed`, in whichever order the two
modules happened to be switched on, so a name index reading the memo could be handed a title the memo
had not dropped yet — and that order is a user's toggle history, not something a test can pin. There is
no ordering to get right if there is nothing to invalidate. The memo exists for the published API, whose
callers ask repeatedly about the same note.

**A title becomes a NAME unconditionally, and a `LinkSuggestion` entry only on request.**
`getSuggestions()` replaces `metadataCache.getLinkSuggestions()` and its contract is that it returns
the array Obsidian would; `docs/api.md`, the demo vault and `get-link-suggestions-on-off-tripwire` all
rest on that. The reverse map is this plugin's own answer to a question the built-in flat array cannot
answer at all, so widening it costs no parity — and it is never gated.

Offering titles to the `[[` autocomplete is the user-visible feature that parity claim forbids by
default, so it has a setting of its own, `shouldOfferTitlesInLinkSuggestions`, and that setting is
**off by default**. Three things make it a suffix rather than a rewrite, and each is load-bearing:

- `IndexedFile.titleEntries` is recorded **whatever the setting says**, so flipping it costs a dropped
  memo (`handleTitlesOfferedChange`) rather than a vault walk. Nothing a file contributes has changed;
  only which of two known halves is assembled.
- The entries are appended **after the unresolved-link entries**, i.e. after everything Obsidian's own
  walk would have produced. So Obsidian's array stays a strict PREFIX, and the parity claim survives
  intact as *"with this off"* rather than being abandoned. `titles.cross-platform.integration.test.ts`
  asserts the position, not just the presence.
- An entry is `{ alias: title, path: displayPath }`, so accepting one writes
  `[[Notes/foo|The Real Name]]` — a link Obsidian resolves on its own and updates on a rename. A bare
  `[[The Real Name]]` would resolve only while this plugin is enabled, which is a trap rather than a
  feature.

A title the file already answers to under its own name or an `alias` contributes no entry: that would
be the same note offered twice under the same text.

## The `headings` module: identity is worked out, and nothing is written into the note

Obsidian has no identity for a heading, and the task this module exists for (`Advanced Note Composer`'s
time sorts) forbids writing one into the note. So `matchHeadings` in `heading-snapshot.ts` pairs each
parse with the previous one in four passes: same text, then same non-empty own body (a rename, even
after a move), then same gap between paired neighbors (a rename plus an edit), and only the rest is new.
**Level is never part of identity**, and `modified` is a change in the SUBTREE hash (level, text and
everything under it), so reordering sibling sections, which is what a sort does, stamps nothing. Its two
known blind spots (delete-and-retype reads as a move; same-text headings that swap keep each other's
history) are stated in the file header and the demo vault's `07 Heading times` rather than patched with heuristics.

**A time the plugin did not see is `null`, never guessed.** A note is tracked from its first open,
create or `changed` while the module is on; at that first sight every heading is a baseline with no
`created`/`modified`. A `create` resets the path to EMPTY instead, so every heading a new note gains
is stamped. There is deliberately no vault walk: a vault walk would only produce baselines.

`HeadingTimesIndex` is owned by the plugin (the published API reads it for the plugin's whole life, the
same reason as `TitleIndex`) and persisted through per-device shared observation journals under
`Plugin data/advanced-metadata-cache/`, with device-local IndexedDB replicas. `HeadingTimesComponent` loads it on layout
ready, then catches up on tracked notes whose `mtime` moved while nothing watched, stamping them with
that `mtime`; it re-checks the `mtime` after each read so a `changed` that landed meanwhile wins. It
saves on a non-resetting 5 s debounce and once more on unload, and clears memory at both edges.

`seen` is a 2 s poll of the active editor (`visible-lines.ts`): a heading is seen when its own section
is inside the scrolled area at two consecutive polls. Polling rather than a CodeMirror extension keeps the
module's whole footprint inside its component, which is the module contract above. The integration
suite does not drive `seen`, because the window cannot be given focus reliably over the transport.

## The `properties` module: registered names only, durable, answered from disk first

`PropertyValueIndex` indexes only the frontmatter properties a consumer names through the API's
`registerPropertyName`, which is why the module is the one added after `backlinks` that defaults **on**:
with nothing registered it holds nothing, and off would make every consumer send its user here first. Like
`HeadingTimesIndex` it is owned by the plugin, because a registration must outlive the module being
switched off, and it gates itself on `isPropertiesModuleEnabled`.

A registration is **durable and shared**: names use grow-only shared registers, while values stay in per-record local IndexedDB. The next
startup indexes and answers them before the consumer has loaded. `PropertyValueIndexComponent` loads that
store on layout ready, then rebuilds from `metadataCache.getFileCache` (never a file read) once
`ensureMetadataCacheReady` resolves, and only then resolves the promise the `Safe` members wait on. Two
guards keep the local checkpoint from being overwritten with a names-only state: a registration before the build
requests no save, and the unload save is skipped until the load has finished.

Matching is exact, name and value. A scalar string, number or boolean is one value in its string form, a
list contributes each such member, and `null` or an object contributes nothing — while the note still
counts as CARRYING the property, which is what `getPathsWithProperty` answers.

**Dates are a second, ordered view of the same values, never a second index to keep in step.**
`DatedValueIndex` (`dated-value-index.ts`) is fed only by `PropertyValues.set` and `delete`, so a value is in
it exactly while the property-value index holds it; every rename, delete, `retain`, `clear` and `load` goes
through those two and needs nothing of its own. Its wall-clock views are two sorted arrays (by value, and by month-day for
`isRecurring`), updated by binary search and `splice`. A value enters it when it is shaped
`YYYY-MM-DD[THH:mm[:ss[.sss]]]`, and a value with a time may add an ISO 8601 offset (`Z`, `±HH:MM`, `±HHMM`)
and an RFC 9557 zone annotation (`[Europe/Kyiv]`). **The wall-clock arrays key on the LOCAL part** (`getLocalDateValue`:
the date and time as written, zone dropped), worked out once per entry; that is what keeps plain string order
the date order, and it is a decision, not a shortcut: a query by calendar day must match the
day the note names, and a value without a zone has no instant to sort by. Ties on the local part break on the full
value. Do not key those arrays on the instant: `2026-10-26T23:00-06:00` would move to the 27th and every prefix bound would
stop meaning what it says. A time alone (`14:30`) is not a date, and neither is a space-separated
datetime or a bare zone name; `getNonDateValues` lists such values of the date properties, computed on
demand by `PropertyValueIndex`, never kept in step.

**A reduced-precision value (`2019`, `2019-05`) is a PERIOD, keyed as written and never padded.** Plain
string order already puts it at the start of its period, and the prefix upper bound already matches it by
overlap; the lower bound gets it through `SortedDatedEntries.getRange`'s extra exact-key slices for the
prefixes of `from` at the reduced key lengths. A year alone stays out of `byMonthDay` (its key would be
empty and match every recurring range). It enters the arrays from ANY property but counts only in a date
property, and `DatedValueIndex.getDatedValues` asks that per query through its `isDateProperty` callback: a
bare `1500` in a registered `pages` is not a year, and a check at query time needs no re-index when a type
or the setting changes. Obsidian's `date` widget shows such a value padded (`2019-01-01`), which the
integration suite pins and `docs/api.md` warns about.

A **date property** is one whose ASSIGNED type (`metadataTypeManager.getAssignedWidget`, i.e. `types.json`) is
`date` or `datetime`, OR whose name matches the `datePropertyNames` setting (exact names or `*` patterns,
whole name, case-sensitive; default `date` and `*Date`): `isDatePropertyName` in `date-properties.ts` is the
one predicate, read by the component to register and by the index to list non-date values. Every date property
is registered by `PropertyValueIndexComponent` itself, in each casing a note spells it: in a
pre-pass of every rebuild, on a note `changed` that carries a new one (which then triggers a full refresh,
since other notes carry it too), on a `saveSettings` that changed `datePropertyNames`, and on
`metadataTypeManager`'s own `changed`, which the typings do not
declare but Obsidian fires from `setType`, `unsetType` and a `types.json` reload — the integration suite
pins that. So "with nothing registered it holds nothing" now reads "nothing registered and no date
property". Such a registration is as durable as any other: retyping the property away from a date leaves
it indexed, the same cost the missing unregister already accepts.

**UTC is an additional query view, never a replacement for wall-clock ordering.** Contract `1.8.0` adds
`timeBasis: 'utc'` with complete offset-bearing bounds and no recurring mode. A third sorted array holds
only zoned values, keyed by a fixed-width shifted epoch (so offsets crossing year 0 or 10000 still sort
chronologically); mutations feed it alongside the other two. A written
offset wins over a zone annotation. `instant-date.ts` uses the host's `Intl` database for named zones,
with compatible DST disambiguation (earlier for overlaps, forward for gaps). Zone-free candidates come
from a two-day-widened slice of the existing wall-clock view, including overlapping reduced periods;
they are converted exactly in the query's zone and filtered before merging into instant order.
`missingTimeZone` chooses the setting `defaultTimeZone` (empty follows the device), UTC, a specific zone,
skip, or fail. Fail uses the default zone to decide range overlap, then throws with the offending value,
property and path. Date-only values span a whole calendar day; months and years span their whole period.
No zone change requires rebuilding or another persisted representation.

## The `unlinked-mentions` module: a candidate index, confirmed by Obsidian's own expression

Obsidian 1.14.4's `BacklinkComponent.recomputeUnlinked` reads every markdown note and runs one `RegExp(VA(name),
'gi')` per name (basename, then each `parseFrontMatterAliases` alias), dropping a match wholly inside a `links` or
`embeds` entry or the frontmatter. `VA` adds a word boundary only on a side where the name's own character is in a
fixed letters-and-digits table, provided by `@mnaoumov/obsidian-lib/obsidian-word-characters`: CJK ideographs, kana and Hangul syllables
are NOT in it, there is no `u` flag (so case folds per UTF-16 code unit, by ECMAScript's `Canonicalize`) and code is
NOT excluded. `unlinked-mention-ranges.ts` is that algorithm, and nothing else may decide what a match is.

**The index only narrows; it never decides.** `UnlinkedMentionIndex` keys every basename and alias in the vault by its
canonical word tokens, scans a changed note's text once against all of them through a token trie, and records which
keys it holds. Every exact match covers consecutive whole tokens of the text, so the notes holding a key are a SUPERSET
of the notes Obsidian lists; each candidate is then read and matched with Obsidian's expression. That superset claim is
what `word-characters.test.ts`'s randomized case pins, and it holds only because a name containing a character whose
case folding crosses word-ness (`ͅ` folds to the word character `Ι`) is refused by `getObsidianNameTokens`, like a name
with no word character at all: both are answered by reading every note.

**A name that appears after a full scan is DIRTY**, because the notes scanned before it were not looked at for it.
Asking about one returns `null` from the index, and the component runs one more full scan, which cleans every name that
was dirty when that scan began (`beginFullScan` / `completeFullScan`, by scan number, so a name added DURING a scan
stays dirty). That is lazy on purpose: a vault gains a note every day, and a full scan per creation would cost more than
the queries it serves.

The pane is answered by patching `recomputeUnlinked` and `onFileChanged` on the `BacklinkComponent` prototype, through
`UnlinkedMentionsCorePluginComponent`, a subclass of the `backlinks` module's `BacklinksCorePluginComponent` that
inherits its moments of installation and overrides only which patch it installs. The replacement never creates the
original's `unlinkedQueue`, so `onFileChanged` re-checks a changed note itself; it sets `unlinkedAliases` the way the
original does, because the original `onMetadataChanged` compares it to decide on a recompute. Until the first full scan
ends, both methods fall through to Obsidian's.

**The index is persisted, and a saved entry is trusted only as far as its `mtime` and `size`.** `UnlinkedMentionsComponent`
saves per-note records to device-local IndexedDB on a non-resetting 5 s debounce and on unload,
and only once built, so a half-built index never overwrites a whole one. Per note it holds the `mtime`/`size` the text had
WHEN IT WAS SCANNED (`scannedStats`, not the file's current stat, which may already be ahead of a pending `changed`) and
the keys found; at top level, the CLEAN keys (`getCleanKeys`), because a key dirty at save time was never looked for in
the notes scanned before it. The next build sets every name from the metadata cache (all dirty), restores each note whose
stat matches, reads the rest, then `markClean`s the saved clean keys: every other name stays dirty and the first query
about it runs the full scan as before. A note `changed` already scanned during the load is skipped, since it is newer
than anything saved. Bump the `mentions-cache-v1` store id and the legacy `PERSISTED_VERSION` whenever what a key means changes (`obsidian-word-characters` above all).

Measured on a copy of a real vault (35,493 notes, 78 MB): the build read every note in ~6-8 s with the notes already in
the OS file cache; from the previous JSON saved file (9.2 MB) it took 1.2 s. Those storage measurements predate the IndexedDB migration. `npm run test:integration:real-vault` with
`AMC_REAL_VAULT_PATH` set re-measures it (`unlinked-mentions-build.desktop-real-vault.integration.test.ts`); that
project is opt-in and in no gate, because the vault it copies is private. Its first read of every note right after the
copy took 231 s, most likely cold disk reads, so a start after a reboot is where the saved file saves the most.

The word-character class, mention expression and canonical word tokenization come from
`@mnaoumov/obsidian-lib/obsidian-word-characters`; AMC retains its candidate trie, names and clean scan markers.
The component still owns its file-change pipeline and checkpoint schema.

The pane falls through until the build ends. `unlinked-mentions-parity.desktop.integration.test.ts` compares the section filled both ways in a real
Obsidian, and `unlinked-mentions-on-off.desktop-performance.integration.test.ts` times them. Read its numbers with the
vault in mind: these historical measurements used EMPTY filler notes, the cheapest case for Obsidian's scan,
so most of the indexed section's time was rendering, which both sides pay (40k notes: 0.58 s against 0.18 s for the section, ~10 ms for the
lookup). A first measurement taken while Obsidian's own startup parse was still running read 11 s against 0.1 s, which
is why `waitForPerformanceVaultScan` now also waits for `inProgressTaskCount` to reach 0; do not quote such numbers.

The performance setup and readiness poll now use `@mnaoumov/obsidian-dev-toolkit/test-runners/performance-vault*`.
AMC supplies scenario counts in `scripts/helpers/generate-performance-vault.ts`: `BC_PERF_VAULT_SIZE` still
counts filler notes; the shared generator receives the total including both targets, 50 linkers, 1,000 mention
notes and both deletion folders. The corpus now contains 1,200 bytes per total note on average, with synthetic
English prose in the filler (no Cyrillic). This changes the old empty-filler workload, so those historical timings
are not a baseline for the shared corpus. Readiness requires the exact current visible on-disk file count and consecutive polls
with a known metadata entry and no active parse. The wrapper reads the disk manifest before polling because
the bulk-delete scenario removes fixtures and AMC creates shared journals during the same project run.
Hidden configuration and trash directories are excluded, matching the vault file universe.

## Public surface: the core call answers, the API offers everything else

`backlinks` and `names` **replace a core method** — `getBacklinksForFile`, `getLinkSuggestions` — keeping
Obsidian's own signature, so every consumer of core gets the faster answer and never learns the plugin is
installed. Everything a consumer asks for BEYOND that answer (the `Safe` and `Original` variants, a path
instead of a `TFile`, the reverse name lookup) goes through the `@mnaoumov/obsidian-lib` plugin registry, as
does everything `titles` and `headings` know: the API object is `PluginApiImpl`, and its contract and
version are in `src/plugin-api.ts`. The declaration goes through `getPluginApis()` rather than a hand
`publishPluginApi` call, because the `plugin-loaded` broadcast derives its `apiVersions` from that method
alone.

**Nothing of this plugin's own is ever hung on an Obsidian function or object.** Each patch's
`postPatchHandler` only records the method it replaced; it returns nothing, so the patched method is
Obsidian's signature and nothing more. (Before `2.0.0` the backlinks and names extras were grafted onto
it as well; the "Removed in 2.0.0" table in `docs/api.md` maps each to its API member.) The `Original` members
are answered from that recorded field (`getBacklinksForFileOriginal`, `getLinkSuggestionsOriginal`). `PluginApiImpl` finds the module components through `ModulesComponent.getModuleComponent`
per call, because a module switched off and on again is a fresh component; a module that is off answers
`null` from every member backed by it, while the `Original` members fall back to core, which is then the
original.
The same API also RECEIVES: `migrateSettings` (contract `1.1.0`) is `@mnaoumov/obsidian-lib`'s
`SettingsMigrationApi` envelope, through which a plugin that used to own a title property hands it over.
`api.d.ts` restates that envelope instead of importing it, and `PluginApiImpl` `implements` the library's
interface too, so the restatement can only drift into a compile error. The merge is additive and
case-insensitive, because a proposal that replaced the list would take `title` away from a user who had it.

**The API is declared in the single root `api.d.ts`**, which is the file a consumer reads, and
`src/plugin-api.ts` re-exports `AdvancedMetadataCacheApi` from it rather than re-declaring it, so there
is one declaration of each and nothing to drift. The file **imports from `obsidian` and nothing else**
— that is what makes it copyable by a plugin which has never heard of `@mnaoumov/obsidian-lib`, and it is
the property to protect when adding a member. `CustomArrayDict` and `LinkSuggestion` are inlined there
rather than imported from `@obsidian-typings/obsidian-public-latest` for exactly that reason; the file
records which typings version they were copied from, and the trade behind the copy.

**The contract lives in the root `api-contract.ts`**, beside `api.d.ts`, and is copyable on slightly
weaker terms: it imports from `obsidian`, `./api.d.ts`, `@mnaoumov/typescript-lib` (the schema
builders, `TypedApiContract` and the guard builders, in its `api-contract` and `type-guards` entry
points) and `@mnaoumov/obsidian-lib` (the file guards, in its `file-system` entry point), so a consumer
copying it needs those two packages. The file is the constant plus the guards only this API has; nothing
generic is restated in it. `src/plugin-api.ts` publishes that same constant, and assigning it to
`ApiContract` there is what checks it is a schema the registry accepts. Every method has both an
`input` and an `output` schema; `defineApiContract<AdvancedMetadataCacheApi>` refuses a missing,
extra or one-sided entry. It is not `api.ts` because TypeScript would resolve `./api.d.ts` to that
file's own declarations.

A new module that makes a core method faster replaces it with Obsidian's signature intact; anything it
offers beyond that answer is a new API member, added under a minor contract bump.

## Invariant: a self-link is never indexed as a re-resolution source

`BacklinkCacheComponent.refreshBacklinks` records a self-link as a **backlink** (so the panel shows it)
but deliberately skips adding it to `resolvedBasenameMap`.

`resolvedBasenameMap` answers "when a file with this basename changes, which notes must be re-resolved?".
Including the changed note itself is vacuous — whatever produced the change already resolved it — and it
is actively harmful here, because this plugin **replaces** `metadataCache.updateRelatedLinks` rather than
calling through. A self-entry makes that replacement queue the note for re-resolution in response to its
own change, which fires `changed`, which refreshes its backlinks, which queues it again. That feedback
cycle is `Backlink Cache` issue #17: a note with 72 self-links stalled the editor for 20-30 seconds. Each
pass is linear in the self-link count, so the cost is the number of passes, not a quadratic per pass.

This is the **one deliberate departure** from the original Obsidian algorithm. The differential-parity
oracle in `src/modules/backlinks/backlink-cache-component.test.ts` models the original faithfully, and
the original *would* queue the note; a dedicated test in that suite pins the divergence so the parity
claim stays honest. Queuing strictly less is safe.

Before changing anything in this area, read that parity suite — its cases encode which behaviors are
guaranteed to match Obsidian exactly.

## Invariant: a backlink refresh never saves the editor

`BacklinkCacheComponent.refreshBacklinks` reads `metadataCache.getFileCache`, the cache Obsidian already
holds, and is synchronous. It must not go back to `getCacheSafe`: that saves any dirty open view of the
note first, and every refresh runs on an automatic trigger (`modify`, `changed`, a backlinks-pane
recompute), so it forced a save of whatever the user or another plugin had just put into the editor.
It also dropped the note's entries and then awaited, so a reader in that window saw backlinks missing.

A `modify` refresh may read the pre-edit cache; the `changed` Obsidian fires after re-parsing queues the
note again and fixes it. That is why the listeners are registered before the initial walk, which also
waits for `ensureMetadataCacheReady`. `refresh-does-not-save-editor.desktop.integration.test.ts` pins
both halves in a real Obsidian and fails on the old code.

## Invariant: the canvas entry lives in memory only

`CanvasComponent` answers `getCache()` for a canvas from its own map, through
`MetadataCacheGetCachePatchComponent`, and must never `saveFileCache` / `saveMetaCache` it. Obsidian keeps
a canvas's persisted hash empty. A real hash there makes core `iterateAllRefs` count each canvas reference
twice, once from the cache and once from the canvas link updater. It also hands `Advanced Canvas`, which keys
its full entry on that same content hash, a links-only entry with no `frontmatter`. It reuses that entry until
the vault cache is rebuilt (`Backlink Cache` issue #15). Versions up to `2.0.1` did persist it, so
`removeLegacyPersistedEntry` drops that exact `{ frontmatterLinks }` shape when it finds it and recomputes the
file. The patch returns a non-empty answer from below it unchanged, so the result is the same whichever of the
two patches was installed first.

`canvas-cache.desktop.integration.test.ts` asserts the persisted hash stays empty, and it fails on the old code.

## Persistence boundaries

`src/persistence/` separates derived caches from authoritative state. `LocalIndexStorage` stores property/path and unlinked-mention/note records in vault-scoped IndexedDB, committing only changed records and removals. `PluginIndexStorage` serializes lazy opening, migration, writes and closing. Async completions check the owning lifetime, so unloading cannot reopen a store or repopulate a cleared index. Legacy JSON files are removed only after durable replacement and a local migration marker; malformed sources stay intact. File-backed interchange storage remains an injectable test boundary; the plugin always supplies `PluginIndexStorage`.

Heading snapshots use one shared register per writer/path. `mergeHeadingNotes` uses the existing matcher, minimum created and maximum modified/seen; `SharedHeadingStorage` uses explicit create/delete incarnation boundaries. Never infer a deletion from omission in a stale snapshot, or from a missing file at startup: sync can deliver journals before notes. Missing notes retain dormant history, resumed on a later create. Legacy observations occupy separate epoch-zero records, so they cannot overwrite live observations or resurrect a deleted incarnation. Rename explicitly retires the source and carries its history to the destination. Lifecycle ordering inherits wall-clock skew, and edits made while tracking is off retain the matcher's original uncertainty.

Property names use minimum registers as a grow-only set. Shared state synchronizes after relevant metadata transport changes (debounced, ignoring `have.md`), every 30 seconds, and on focus; listeners and connections belong to the module lifetime. Compaction runs after every 120 writes. The plugin's own Markdown transport is excluded from its heading tracking and unlinked-mention answers, preventing feedback writes and matches in generated data. See `docs/storage.md` for the user-facing sync and recovery contract.
