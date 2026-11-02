---
related: "[[Ideas backlog]]"
---

# Fast, safe, and original backlinks

`Advanced Metadata Cache` answers `app.metadataCache.getBacklinksForFile(file)` from its cache, so every plugin that asks for backlinks gets the faster answer without doing anything. A plugin that wants more asks this plugin's API, which offers three ways to read them. The fast and safe versions accept a `TFile` **or** a vault path string; the original accepts a `TFile`.

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

## Links to a note that does not exist yet

This note's `related` property links to `[[Ideas backlog]]`, a note this vault does not have. Obsidian records such a link as unresolved and has no call that answers *which notes link here?* until the note is created. `await api.getUnresolvedBacklinksSafe('Ideas backlog')` answers it from the same cache, keyed by the source note like the backlinks above, and `api.getUnresolvedBacklinks(linkPath)` is its fast version. The link path is the link as written without its `#` subpath, matched case-insensitively and with a trailing `.md` ignored. Create `Ideas backlog` and the answer is empty; delete it again and this note is back.

```code-button
---
caption: List the notes linking to Ideas backlog
---
await require('/demoSetup.ts').listUnresolvedBacklinks(app);
```

See [04 Settings](<./04 Settings.md>) for the options that control refresh behavior.
