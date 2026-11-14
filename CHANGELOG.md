# CHANGELOG

## 2.7.0

This release has 2 new features and 2 fixes. 4 maintenance commits (tests, build, CI, refactoring, dependencies, docs) are not listed.

### New

- **Block metadata** (new module, off by default): an `advanced-metadata-cache` fenced code block holds YAML properties for the section just above it, such as the heading it sits under. API contract 1.16.0 adds `getBlockMetadata`, `getBlockMetadataWithProperty` (each with a `Safe` variant) and `onBlockMetadataChanged`.
- **Block metadata**: a `[[wikilink]]` written in a block's metadata counts as a real link (backlinks, graph and rename updates) while the Code block links module is on.

### Fixed

- **Titles**: the core Quick switcher finds notes by their title.
- Load again after an update or Hot Reload instead of failing on an already published API.

## 2.6.0

This release has 1 new feature and 1 fix. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- create the plugin data folder only on a device that turns sync on, make it configurable, and add it to Excluded files (#2)

### Fixed

- **deps:** load on startup again with @mnaoumov/obsidian-lib 10.11.0

## 2.5.0

### New modules

- **Tags**: answers which notes carry a tag, with body tags and the `tags` property kept apart, and nested tags matched by prefix.
- **External links**: indexes every note's `http(s)` links by URL and host, with similar-host lookups, restored from a local checkpoint on startup.
- **Non-Markdown**: supplies core metadata (properties, headings, links) for configured extensions or for a parser another plugin registers.
- **HTML**: indexes HTML ranges in notes and reports unknown tags and markup Obsidian's sanitizer removes, shared with other plugins through the API.

### API

- API contract 1.15.0: `getHtmlRanges` / `getHtmlRangesSafe` and `getHtmlDiagnostics` / `getHtmlDiagnosticsSafe`.
- Backlinks: an unresolved-backlinks lookup, which answers which notes link to a name no file answers to.
- Titles: a note whose frontmatter does not parse is reported in the console, since Obsidian drops its titles and aliases without a word.

### Fixes

- Headings and backlinks no longer write journals or refresh the panels every few seconds while a note sits open.

Fixes #1

### Other

- Documentation: Changelog section in the README, issue forms with optional attachments, and a link to the Obsidian resources page.
- Tooling: `obsidian-integration-testing` ^17.9.1 with the Android framework readiness gate, and the newer `unicorn` lint rules.

## 2.4.0

This release has 5 new features, 1 fix and 3 documentation changes. 11 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- add a Report a bug command
- **code-block-links:** count the links inside code blocks of listed languages
- **titles:** build extra titles from name patterns over name parts
- **link-texts:** index the display texts links use for a file
- **storage:** keep caches local and synchronize heading history

### Fixed

- **titles:** use a fictional name in the name-pattern examples

### Documentation

- **readme:** point bug reports at the Report a bug command
- add issue-filing instructions for AI agents
- **agents:** measure startup with the Obsidian window visible

## 2.3.0

This release has 5 new features, 1 fix and 3 documentation changes. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- **properties:** query dates by UTC instant with per-query zone policies
- **unlinked-mentions:** persist the index across restarts, and measure the build on a real vault
- **unlinked-mentions:** fill the Backlinks pane's Unlinked mentions section from an index
- **properties:** index a year or a month alone as a date standing for its whole period
- **properties:** pick date properties by name, and order zoned dates by the time as written

### Fixed

- **properties:** preserve UTC ordering across calendar boundaries

### Documentation

- **readme:** combine related resources and plugin comparisons
- **readme:** cut the README to a landing page, detail moved to docs/api.md and the demo vault
- **readme:** add a See also section comparing similar plugins

## 2.2.0

This release has 1 new feature.

### New

- **properties:** find notes by date range and by recurring date for other plugins

## 2.1.0

This release has 1 new feature.

### New

- **properties:** merge indexing notes by frontmatter property value for other plugins

## 2.0.3

This release has 3 fixes and 4 documentation changes. 8 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Fixed

- drop the plugin name from notice text
- **backlinks:** drain pending actions until the queue stays empty
- **api-contract:** merge reporting the plugin id as the schemas' vendor

### Documentation

- shorten the debugging section
- **readme:** lead the Debugging section with `Advanced Debug Mode`
- mark plugin names as code
- **demo-vault:** merge driving the name index's autocomplete demo from a button

## 2.0.2

This release has 1 fix. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Fixed

- **canvas:** merge keeping the canvas metadata entry out of Obsidian's persisted cache

## 2.0.1

This release has maintenance changes only. 4 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

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

This release has 1 new feature and 1 other change.

### New

- **api:** publish the backlinks and names extras through the plugin API (contract 1.3.0)

### Other changes

- deprecate the members grafted onto the patched getBacklinksForFile and getLinkSuggestions (safe, originalFn, getPathsByName, getPathsByNameSafe, and getBacklinksForFile called with a path); 2.0.0 removes them, and the README names the API method that replaces each

## 1.2.0

This release has 1 new feature and 1 documentation change.

### New

- **headings:** merge tracking when each heading was created, modified and seen

### Documentation

- **readme:** merge linking the Community directory listing

## 1.1.1

This release has 1 fix and 1 documentation change. 9 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Fixed

- **screenshots:** merge the shortened screenshot captions

### Documentation

- **screenshots:** merge the re-shot store frames

## 1.1.0

This release has 1 new feature. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- **api:** accept a title property handover through migrateSettings

## 1.0.0

This release has 4 new features, 5 fixes and 3 documentation changes. 5 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- offer titles in the [[ autocomplete behind a default-off setting
- add the titles module, a name-bearing frontmatter property
- add the names module, and fix the performance project it was measured on
- scaffold the plugin with the ported backlinks module

### Fixed

- **canvas:** merge loading the canvas index after a Canvas toggle
- **backlinks:** merge patching the pane when it opens after load
- **backlinks:** merge installing the pane patch once per session
- **backlinks:** merge the refresh that no longer saves the editor
- **test:** refuse an Android capture on a contended machine, and bound its index wait by wall clock

### Documentation

- **readme:** point the library-free route at the plugin API protocol guide
- **test:** correct the Android AVD provisioning recipe
- capture the screenshot set and add the README gallery
