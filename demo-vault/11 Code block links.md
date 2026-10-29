# Code block links

Obsidian skips everything inside a code block, which is right for code. But some plugins render a code block as a note of its own: the `Admonition` plugin's `ad-note` and `ad-warning` blocks, tabs and columns blocks, a `markdown` block used as an include. A link written there is real to you, and Obsidian still ignores it: it is missing from the **Backlinks** pane, from outgoing links and from the graph, and a rename does not update it.

The **Code block links** module counts the links and embeds inside code blocks of the languages you list, so they reach all of those like any other link. The list is **empty by default**, so nothing changes until you name a language. An entry is an exact language or a pattern in which `*` stands for anything: `ad-*` counts every admonition. Other plugins can add their own languages too.

## See it

[Admonition note](<./Materials/11 Code block links/Admonition note.md>) links to [Project brief](<./Materials/11 Code block links/Project brief.md>) only from inside an `ad-note` block, and mentions it once more inside a `js` block.

```code-button
---
caption: Count nothing, then ask who links to "Project brief"
---
await require('/demoSetup.ts').showCodeBlockLinks(app, { languages: [], sourcePath: 'Materials/11 Code block links/Admonition note.md', targetPath: 'Materials/11 Code block links/Project brief.md' });
```

```code-button
---
caption: Count ad-* blocks, then ask again
---
await require('/demoSetup.ts').showCodeBlockLinks(app, { languages: ['ad-*'], sourcePath: 'Materials/11 Code block links/Admonition note.md', targetPath: 'Materials/11 Code block links/Project brief.md' });
```

With `ad-*` counted, rename [Project brief](<./Materials/11 Code block links/Project brief.md>): the link inside the admonition is updated with the others. The one inside the `js` block is not, because `js` is not listed.

## What counts

Only a fenced code block that stands on its own counts, not one inside a list item or a quote: Obsidian does not list those as blocks of their own. The language is the first word after the opening fence, matched case-sensitively. A listed block inside a listed block counts too.

## What it costs

At startup the module reads only the notes that have a code block, and parses only the blocks of a listed language, with Obsidian's own parser. After that it parses a note again when Obsidian does. Nothing is written into Obsidian's saved cache: the links are added in memory and taken out again when you switch the module off or change the list.
