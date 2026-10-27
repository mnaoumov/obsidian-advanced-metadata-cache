# CHANGELOG

## 2.3.0

- refactor(properties): name date-query and zone-conversion options
- fix(properties): preserve UTC ordering across calendar boundaries
- feat(properties): query dates by UTC instant with per-query zone policies
- docs(readme): combine related resources and plugin comparisons
- docs(readme): cut the README to a landing page, detail moved to docs/api.md and the demo vault
- feat(unlinked-mentions): persist the index across restarts, and measure the build on a real vault
- docs(readme): add a See also section comparing similar plugins
- feat(unlinked-mentions): fill the Backlinks pane's Unlinked mentions section from an index
- feat(properties): index a year or a month alone as a date standing for its whole period
- feat(properties): pick date properties by name, and order zoned dates by the time as written

## 2.2.0

- feat(properties): find notes by date range and by recurring date for other plugins

## 2.1.0

- feat(properties): merge indexing notes by frontmatter property value for other plugins

## 2.0.3

- test(demo-vault): require `CodeScript Toolkit` 15.0.0, its first release on obsidian-lib 6
- build(deps): move to obsidian-lib 6 and obsidian-dev-toolkit 5
- fix: drop the plugin name from notice text
- docs: shorten the debugging section
- chore: replace leftover obsidian-dev-utils references with @mnaoumov/obsidian-lib
- docs(readme): lead the Debugging section with `Advanced Debug Mode`
- build(deps): float brace-expansion, sharp and fast-uri past their advisories
- fix(backlinks): drain pending actions until the queue stays empty
- docs: mark plugin names as code
- chore(github): link Discussions from the issue chooser
- build(deps): merge taking obsidian-lib 4.3.0 and its validation debug switch
- test(api-contract): verify the contract with verifyApiContract from typescript-lib 1.5.0
- fix(api-contract): merge reporting the plugin id as the schemas' vendor
- docs(demo-vault): merge driving the name index's autocomplete demo from a button
- refactor(api-contract): merge building the contract guards from typescript-lib and obsidian-lib

## 2.0.2

- fix(canvas): merge keeping the canvas metadata entry out of Obsidian's persisted cache
- ci: merge attesting release assets through the toolkit's reusable workflow
- build(demo-vault): require `CodeScript Toolkit` 13.8.0 for the obsidian-lib demo script

## 2.0.1

- chore(demo-vault): import demoSetup helpers from @mnaoumov/obsidian-lib
- refactor: merge the move off obsidian-dev-utils onto the @mnaoumov packages
- refactor(backlinks): merge dropping the subkey cast on obsidian-typings 6.48.0
- refactor(api): merge building the API contract on @mnaoumov/typescript-lib/api-contract

## 2.0.0

- feat(api)!: remove the members grafted onto the patched core methods. `app.metadataCache.getBacklinksForFile` and `app.metadataCache.getLinkSuggestions` keep Obsidian's own signature and carry nothing else. Each removed member has a replacement on the plugin API (contract 1.3.0), published since 1.3.0:
  - `getBacklinksForFile(path)`, called with a path: `api.getBacklinksForFile(path)`
  - `getBacklinksForFile.safe(pathOrFile)`: `api.getBacklinksForFileSafe(pathOrFile)`
  - `getBacklinksForFile.originalFn(file)`: `api.getBacklinksForFileOriginal(file)`
  - `getLinkSuggestions.safe()`: `api.getLinkSuggestionsSafe()`
  - `getLinkSuggestions.originalFn()`: `api.getLinkSuggestionsOriginal()`
  - `getLinkSuggestions.getPathsByName(name)`: `api.getPathsByName(name)`
  - `getLinkSuggestions.getPathsByNameSafe(name)`: `api.getPathsByNameSafe(name)`
- `api.d.ts` no longer declares `GetBacklinksForFileFn` or `GetLinkSuggestionsFn`
- fix(test): read the API contract version from a module Node can load

## 1.3.0

- feat(api): publish the backlinks and names extras through the plugin API (contract 1.3.0)
- deprecate the members grafted onto the patched getBacklinksForFile and getLinkSuggestions (safe, originalFn, getPathsByName, getPathsByNameSafe, and getBacklinksForFile called with a path); 2.0.0 removes them, and the README names the API method that replaces each

## 1.2.0

- feat(headings): merge tracking when each heading was created, modified and seen
- docs(readme): merge linking the Community directory listing

## 1.1.1

- test(screenshots): merge setting the desktop capture theme with applyObsidianTheme
- refactor: merge watching core-plugin toggles through CorePluginToggleComponent
- chore(test): merge dropping the perf transport raise obsidian-dev-utils now provides
- refactor(names): use obsidian-dev-utils' normalizeLinkName
- chore(lint): merge the shared-config MD025 cleanup
- test(screenshots): drop the local caret blur now that the capture hides the caret
- docs(screenshots): merge the re-shot store frames
- test(screenshots): make desktop frame 4 deterministic
- test(screenshots): reconcile the staged vault so frame 2 always reports every note
- fix(screenshots): merge the shortened screenshot captions
- chore(deps): float obsidian-integration-testing to ^17.0.1 with obsidian-dev-utils ^107.0.0

## 1.1.0

- feat(api): accept a title property handover through migrateSettings
- chore(deps): float obsidian-test-mocks to ^7.0.0

## 1.0.0

- fix(canvas): merge loading the canvas index after a Canvas toggle
- docs(readme): point the library-free route at the plugin API protocol guide
- fix(backlinks): merge patching the pane when it opens after load
- refactor(backlinks): merge the core-plugin change subscription
- fix(backlinks): merge installing the pane patch once per session
- fix(backlinks): merge the refresh that no longer saves the editor
- chore: merge the restored lockfile resolved and integrity fields
- fix(test): refuse an Android capture on a contended machine, and bound its index wait by wall clock
- feat: offer titles in the [[ autocomplete behind a default-off setting
- docs(test): correct the Android AVD provisioning recipe
- docs: capture the screenshot set and add the README gallery
- test: run every integration project green, and unblock the demo-vault one
- refactor: give the ported backlinks surface the shared API convention
- feat: add the titles module, a name-bearing frontmatter property
- feat: add the names module, and fix the performance project it was measured on
- feat: scaffold the plugin with the ported backlinks module
- chore: initial commit
