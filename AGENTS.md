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
inherited wholesale from Backlink Cache; a module added later defaults **off**.

## The `names` module: the patch goes in BEFORE the index is built

`NameIndexComponent.onLayoutReady` installs `MetadataCacheGetLinkSuggestionsPatchComponent` and only then
builds the index, and the order is deliberate: while the index is empty the patch falls through to
Obsidian's own `getLinkSuggestions`, so there is no window in which a caller is handed a half-built
answer. The patch reads `isBuilt` on every call to decide.

The cost is that the presence of the patch says nothing about whether the index is ready — which is what
`safe()` and `getPathsByNameSafe()` are for, and what the README tells consumers to use when they may be
asked early. A test that waits for `originalFn` to appear and then measures is measuring Obsidian; the
tripwire suite in this module was written that way once and reported a speedup of exactly 1.0.

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
the array Obsidian would; the README, the demo vault and `get-link-suggestions-on-off-tripwire` all
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

## Two kinds of public surface, and which one a new module takes

`backlinks` and `names` answer by **replacing a core method**, so a consumer calls
`app.metadataCache.…` and never learns the plugin is installed. Their widened signatures are
`GetBacklinksForFileFn` and `GetLinkSuggestionsFn`, and there is nothing to version-negotiate — a member
is pinned against the plugin version it arrived in, which is what the README records.

`titles` has no core method to replace, so it publishes through the `obsidian-dev-utils` plugin
registry: the API object is `PluginApiImpl`, and its contract and version are in `src/plugin-api.ts`. The
declaration goes through `getPluginApis()` rather than a hand `publishPluginApi` call, because the
`plugin-loaded` broadcast derives its `apiVersions` from that method alone.

The same API also RECEIVES: `migrateSettings` (contract `1.1.0`) is `obsidian-dev-utils`'s
`SettingsMigrationApi` envelope, through which a plugin that used to own a title property hands it over.
`api.d.ts` restates that envelope instead of importing it, and `PluginApiImpl` `implements` the library's
interface too, so the restatement can only drift into a compile error. The merge is additive and
case-insensitive, because a proposal that replaced the list would take `title` away from a user who had it.

**Both kinds are declared in the single root `api.d.ts`**, which is the file a consumer reads, and
`src/plugin-api.ts` re-exports `AdvancedMetadataCacheApi` from it rather than re-declaring it, so there
is one declaration of each and nothing to drift. The file **imports from `obsidian` and nothing else**
— that is what makes it copyable by a plugin which has never heard of `obsidian-dev-utils`, and it is
the property to protect when adding a member. `CustomArrayDict` and `LinkSuggestion` are inlined there
rather than imported from `@obsidian-typings/obsidian-public-latest` for exactly that reason; the file
records which typings version they were copied from, and the trade behind the copy.

Ask which kind a new module is before writing either file: the two are not interchangeable, and a
core-widening surface published through the registry would ask consumers to negotiate a version for a
method they are going to call on `app` regardless.

## Invariant: a self-link is never indexed as a re-resolution source

`BacklinkCacheComponent.refreshBacklinks` records a self-link as a **backlink** (so the panel shows it)
but deliberately skips adding it to `resolvedBasenameMap`.

`resolvedBasenameMap` answers "when a file with this basename changes, which notes must be re-resolved?".
Including the changed note itself is vacuous — whatever produced the change already resolved it — and it
is actively harmful here, because this plugin **replaces** `metadataCache.updateRelatedLinks` rather than
calling through. A self-entry makes that replacement queue the note for re-resolution in response to its
own change, which fires `changed`, which refreshes its backlinks, which queues it again. That feedback
cycle is Backlink Cache issue #17: a note with 72 self-links stalled the editor for 20-30 seconds. Each
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
