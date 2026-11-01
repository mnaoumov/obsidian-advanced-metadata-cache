# Tags

Obsidian counts how many notes carry each tag, but it does not keep a list of which notes those are. A plugin that wants the notes tagged `#project` has to read the cache of every note in the vault to find them.

The **Tags** module keeps that list for every tag. It records where each note wrote the tag: in the text (`#project`) or in the `tags` property (`tags: [project]`). Obsidian keeps those two apart too, but `getAllTags` merges them, so a plugin cannot tell them apart afterwards. Other plugins read the list through the API.

## See it

[Kickoff notes](<./Materials/12 Tags/Kickoff notes.md>) writes `#Project` in its text, [Reading list](<./Materials/12 Tags/Reading list.md>) has `project` in its `tags` property, and [Alpha milestone](<./Materials/12 Tags/Alpha milestone.md>) carries only the nested tag `#project/alpha`.

```code-button
---
caption: Which notes carry #project?
---
await require('/demoSetup.ts').showNotesWithTag(app, '#project');
```

The button switches the module on if it is off. Add or remove a tag in one of those notes and ask again: the answer follows the edit, and a renamed note keeps its tags under its new name.

## What counts

A tag matches in any casing, with or without its `#`, as it does everywhere in Obsidian. `#project` also finds the notes that carry only a nested tag such as `#project/alpha`, as Obsidian's own `tag:#project` search does. A plugin can ask for the exact tag only. The `tags` property is read the way Obsidian reads it, so a value with a space in it is not a tag here either.

## What it costs

The module reads the tags Obsidian has already parsed, once when it starts, in the background, and it reads no note. After that it follows each note Obsidian parses again. Nothing is kept on disk. It is **off by default**, like most modules.
