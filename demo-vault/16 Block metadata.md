# Block metadata

Frontmatter describes a whole note. Sometimes one heading or one paragraph needs properties of its own: a task's status, its owner, a due date. The **Block metadata** module reads a code block of the language `advanced-metadata-cache` placed right under that heading or block. Its YAML is written like frontmatter:

````md
## Cut the release

```advanced-metadata-cache
status: open
due: 2026-12-01
```
````

The block describes the heading or block right above it. Two such blocks in a row describe the same one. A block right under the frontmatter describes nothing, because the frontmatter is the note's own place. When you sort, move, merge or split headings, the block travels with its heading, because it sits among the heading's own lines.

## See it

[Release plan](<./Materials/16 Block metadata/Release plan.md>) gives each of its headings a status, and one paragraph a status of its own. [Launch checklist](<./Materials/16 Block metadata/Launch checklist.md>) has one more open heading.

```code-button
---
caption: Which blocks are open?
---
await require('/demoSetup.ts').showBlockMetadata(app, { path: 'Materials/16 Block metadata/Release plan.md', propertyName: 'status', value: 'open' });
```

The button switches the module on if it is off. Change `open` to `done` in one of those blocks and ask again: the answer follows the edit.

## What it is for

Other plugins read the blocks through the API: one note's blocks, every block naming a property and value across the vault, and a notice whenever they change. A value is matched the way a frontmatter value is: `status: open` matches `open`, and `channel: [forum, discord]` matches `forum`. A block whose YAML does not parse is still listed, with the parser's message. A link written as a value, quoted as in frontmatter (`related: "[[Release plan]]"`), is a real link: it shows in backlinks and the graph, and a rename updates it, as long as the **Code block links** module is on, which it is by default.

For now the block shows as a code block in every view. A compact properties panel in Reading view and Live Preview is planned.

## What it costs

The module reads only notes that contain code blocks, once when it starts, in the background. After that it reads the text Obsidian hands over with each edit. Nothing is kept on disk. It is **off by default**, like most modules.
