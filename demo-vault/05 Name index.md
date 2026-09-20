# Name index

Every time you type `[[`, Obsidian builds the list of things you could link to by walking **every file in the vault** — reading each one's metadata and parsing its `aliases` — and then throws that list away when the popover closes. The next `[[` does the whole walk again.

The **Names** module keeps that list as an index instead, and answers `app.metadataCache.getLinkSuggestions()` from it.

**Measured on a generated vault** (Obsidian 1.14.2, notes with no frontmatter at all, so a floor rather than a typical cost):

| notes  | built-in, per `[[` open | from the index |
|--------|-------------------------|----------------|
| 20 000 | ~23 ms                  | ~0.005 ms      |
| 90 000 | ~108 ms                 | ~0.005 ms      |

**Honest note:** in a tiny vault like this one you will not feel any of that — the built-in walk is over before you see the popover. What this note shows is *what* the module does, and the one thing it can do that the built-in list cannot do at all: ask the question backwards.

## The reverse lookup

The built-in list is flat and unkeyed, so "which notes are called *Literature review*?" can only be answered by scanning it. The index is keyed by name, so it answers directly — counting a note's own name **and** its `aliases`, case-insensitively, with runs of whitespace collapsed, exactly as Obsidian resolves a wikilink.

[Research note](<./Topics/Research note.md>) answers to two aliases, so all three of these name the same note:

```code-button
---
caption: What does "Literature review" name?
---
await require('/demoSetup.ts').showNamesFor(app, 'Literature review');
```

```code-button
---
caption: What does "background  research" name? (wrong case, doubled space)
---
await require('/demoSetup.ts').showNamesFor(app, 'background  research');
```

```code-button
---
caption: What does "Research note" name?
---
await require('/demoSetup.ts').showNamesFor(app, 'Research note');
```

Each button switches the **Names** module on for you — it is off by default — and reports the notes carrying that name, plus how many link targets the index and the built-in implementation each offer. Those two counts agree: the index is a faster answer to the same question, not a different one.

The answer is a **list**, and deliberately an unranked one. Several notes may declare the same alias, and which of them you meant is a question about your context — the note you are editing, what it already links to — which the index does not have and does not guess at.

## Try it in the editor

With the module on, open any note and type `[[Lit` — [Research note](<./Topics/Research note.md>) is offered under its alias, exactly as it was before. That is the point: nothing about the autocomplete changes except where the list came from.

## Switching it off

```code-button
---
caption: Switch the Names module off (the default)
---
await require('/demoSetup.ts').changeSettings(app, { isNamesModuleEnabled: false });
```

Switching the module off unloads it completely — the index, its listeners and the patched `getLinkSuggestions` all go with it, and Obsidian's own walk answers again. See [04 Settings](<./04 Settings.md>) for the rest of the options.
