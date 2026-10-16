# Fast, safe, and original backlinks

Advanced Metadata Cache answers `app.metadataCache.getBacklinksForFile(file)` from its cache, so every plugin that asks for backlinks gets the faster answer without doing anything. A plugin that wants more asks this plugin's API, which offers three ways to read them. The fast and safe versions accept a `TFile` **or** a vault path string; the original accepts a `TFile`.

- **Fast**
  - `api.getBacklinksForFile(pathOrFile)` reads straight from the cache. It is the fastest, and may be momentarily stale if a note changed a split second ago.
- **Safe**
  - `await api.getBacklinksForFileSafe(pathOrFile)` waits for any pending changes to be processed first, so the result is guaranteed current.
- **Original**
  - `api.getBacklinksForFileOriginal(file)` calls Obsidian's built-in implementation, bypassing the cache (handy for comparison).

The fast and safe versions answer `null` while the **Backlinks** module is off, so a caller knows to fall back to the core method.

## Try it

The button runs all three against [Central topic](<./Topics/Central topic.md>) and reports how many backlinks each one found. In this small, settled vault they agree - the difference is about *speed* and *freshness guarantees*, not the result.

```code-button
---
caption: Compare fast, safe, and original backlinks
---
await require('/demoSetup.ts').compareBacklinks(app);
```

See [04 Settings](<./04 Settings.md>) for the options that control refresh behavior.
