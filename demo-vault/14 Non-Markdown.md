# Metadata from other file types

A file can contain notes without ending in `.md`. The **Non-Markdown** module lets selected extensions contribute Markdown properties, headings, tags and links to Obsidian's metadata cache. Backlinks and graph link resolution see those links, and Bases reads the properties from the same cache.

## Try a screenplay

[Scene.fountain](<./Materials/14 Non-Markdown/Scene.fountain>) ships with a `stage` property, an opening heading and a link to [Central topic](<./Topics/Central topic.md>). Click to index it and see what Obsidian reads:

```code-button
---
caption: Read metadata from Scene.fountain
---
await require('/demoSetup.ts').showNonMarkdownMetadata(app);
```

Manual equivalent: turn **Non-Markdown module** on in the plugin settings, add `fountain` under **Markdown file extensions**, then inspect the backlinks of **Central topic** or read `app.metadataCache.getCache('Materials/14 Non-Markdown/Scene.fountain')` in the console. A Base that includes this file can read its `stage` property. In Graph view, enable **Attachments** to include non-Markdown files.

The button reports the heading, the property and the outgoing link. Edit the file in an editor that supports its type; its metadata follows saved changes. The module does not register an editor or change which application opens the file.

```code-button
---
caption: Stop indexing extra extensions (the default)
---
await require('/demoSetup.ts').changeSettings(app, { markdownFileExtensions: [] });
```

Manual equivalent: clear **Markdown file extensions**. Switching the whole module off also removes its metadata and listeners.

## What is parsed

The extension list is empty by default. Entries are exact and case-insensitive; `mdx` and `.MDX` select the same extension. No wildcards are accepted. Selected files are parsed by Obsidian's Markdown worker: Markdown links and YAML frontmatter work, but this is not an MDX or Fountain language parser. Fenced code blocks follow the worker's normal rules.

Another plugin can register a parser for its own file type, or register an extension as Markdown, through [the plugin API](<../docs/api.md#non-markdown-metadata>). Its registration stays until that plugin unregisters it. `md`, `canvas` and `base` are reserved for their existing owners; non-empty metadata supplied by another plugin also takes priority.

Canvas text-card links already reach core backlinks and the graph. [03 Canvas backlinks](<./03 Canvas backlinks.md>) demonstrates the existing canvas path. Cards are not separate vault files, so they do not become independent Bases rows or notes in Outline.

## Cost and lifetime

The module is on by default but reads no file until an extension is selected or a parser is registered. It reads matching files one at a time after core's startup index is ready, then follows creates, edits, renames and deletes. Metadata is kept in memory only and rebuilt on each startup. Disabling it leaves the files untouched and removes its contribution from core.

Consumers that explicitly scan only `getMarkdownFiles()` still choose only `.md` files; this module does not change that API. In particular, the separate property, tag, heading-history and other Markdown-only indexes are not widened by selecting an extension here. Bases property editing still follows the editing capabilities of the file's own plugin.
