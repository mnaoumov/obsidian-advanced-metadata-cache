# Settings

Open **Settings -> Community plugins -> Advanced Metadata Cache** to configure the plugin. Each option below lists the setting key stored in the plugin's `data.json`.

- `isBacklinksModuleEnabled`
  - when on, the **Backlinks** module maintains the backlink index and answers `app.metadataCache.getBacklinksForFile()` from it. When off, the module is unloaded outright - its index, its listeners and its **Refresh backlink panels** command all go with it, and Obsidian's own implementation answers again. Every index this plugin maintains is a module of its own, so switching one off leaves the others running.
- `isNamesModuleEnabled`
  - when on, the **Names** module indexes what every note is called - its name and its `aliases` - and answers `app.metadataCache.getLinkSuggestions()` from that index, which is what the `[[` autocomplete asks on every open. Off by default, like every module added after the one this plugin was created for. [05 Name index](<./05 Name index.md>) demonstrates it.
- `isTitlesModuleEnabled`
  - when on, the **Titles** module reads the frontmatter properties listed below as names for the note carrying them, alongside its own name and its `aliases`. Nothing is indexed up front - the properties are read per note, on demand - so a plugin that asks about one note pays for one note. Off by default, like every module added after the one this plugin was created for. [06 Titles](<./06 Titles.md>) demonstrates it.
- `titlePropertyNames`
  - the properties the **Titles** module reads, one per line. Defaults to `title` alone. Other plugins can read this same list through the plugin API, so a vault that uses a different property names it here once rather than once per plugin.
- `shouldAutomaticallyRefreshBacklinkPanels`
  - when on, open **Backlinks** panes refresh automatically as the cache updates, so they always reflect the latest links. When off, refresh them yourself with the **Advanced Metadata Cache: Refresh backlink panels** command.
- `shouldShowProgressBarOnLoad`
  - when on, a progress bar is shown while the cache is built as the vault loads. This is reassuring in large vaults where the initial build takes a moment; turn it off for a quieter startup.

There is also a command, **Advanced Metadata Cache: Refresh backlink panels**, that rebuilds the visible Backlinks panes on demand.

## See the difference

Automatic refreshing is **off** by default, so the manual command is the behavior most readers actually have. Put a Backlinks pane on screen first, then edit a link in one of the [Topics](<./Topics/Central topic.md>) notes and watch what the pane does:

```code-button
---
caption: Open "Central topic" and show its Backlinks pane
---
await require('/demoSetup.ts').showCentralTopicBacklinks(app);
```

```code-button
---
caption: Refresh backlink panels now
---
require('/demoSetup.ts').refreshBacklinkPanels(app);
```

Manual equivalent: **Advanced Metadata Cache: Refresh backlink panels** in the Command Palette.

Then turn automatic refreshing on and make the same edit - the pane keeps itself current and the command becomes unnecessary:

```code-button
---
caption: Refresh backlink panels automatically
---
await require('/demoSetup.ts').changeSettings(app, { shouldAutomaticallyRefreshBacklinkPanels: true });
```

```code-button
---
caption: Back to manual refreshing (the default)
---
await require('/demoSetup.ts').changeSettings(app, { shouldAutomaticallyRefreshBacklinkPanels: false });
```

Manual equivalent: toggle **Should automatically refresh backlink panels** above.

Switching the **Backlinks** module off unloads it while the plugin stays loaded. Ask for backlinks in [01 Backlink cache](<./01 Backlink cache.md>) after each of these and you will see the built-in implementation answering instead, with **Refresh backlink panels** gone from the Command Palette:

```code-button
---
caption: Switch the Backlinks module off
---
await require('/demoSetup.ts').changeSettings(app, { isBacklinksModuleEnabled: false });
```

```code-button
---
caption: Switch it back on (the default)
---
await require('/demoSetup.ts').changeSettings(app, { isBacklinksModuleEnabled: true });
```

Manual equivalent: toggle **Backlinks module** above.

The progress bar only appears while the cache is built at vault load, so it needs a restart to see either way:

```code-button
---
caption: Hide the progress bar on load
---
await require('/demoSetup.ts').changeSettings(app, { shouldShowProgressBarOnLoad: false });
```

```code-button
---
caption: Show it again (the default)
---
await require('/demoSetup.ts').changeSettings(app, { shouldShowProgressBarOnLoad: true });
```

The **Titles** module has its own pair, and [06 Titles](<./06 Titles.md>) shows what changes between them:

```code-button
---
caption: Switch the Titles module on
---
await require('/demoSetup.ts').changeSettings(app, { isTitlesModuleEnabled: true });
```

```code-button
---
caption: Switch it off again (the default)
---
await require('/demoSetup.ts').changeSettings(app, { isTitlesModuleEnabled: false });
```

Manual equivalent: toggle **Titles module** above.
