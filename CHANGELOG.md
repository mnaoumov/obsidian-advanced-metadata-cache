# CHANGELOG

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
