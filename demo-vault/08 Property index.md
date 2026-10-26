# Property index

Some plugins find notes by a frontmatter value: which note holds a given key, which notes carry a property at all. Obsidian has no index for that, so each such plugin reads the whole vault, and at startup it has to before it can answer anything.

The **Properties** module keeps that index for them. It indexes only the properties another plugin registers, so with none registered it costs nothing, and it is **on by default** for that reason. The index is saved in `property-values.json` in the plugin's own folder, so the next startup answers straight from disk.

## See it

Three notes in [Topics](<./Topics/Reading list.md>) carry a `status` property: [Research note](<./Topics/Research note.md>) says `reading`, [Reading list](<./Topics/Reading list.md>) lists `reading` and `shared`, and [Meeting note](<./Topics/Meeting note.md>) says `done`. The button registers `status`, the way a plugin would on load, and asks:

```code-button
---
caption: Which notes are "reading"?
---
await require('/demoSetup.ts').showPathsByPropertyValue(app, 'status', 'reading');
```

A list value counts when any of its members matches, so both notes come back, and the meeting note does not. Change a `status` in one of those notes and press the button again: the answer follows at once.

## What to know

- **Matched exactly.** Names and values are compared as typed, case included. A number or a boolean is matched by its string form, so `7` finds `status: 7`.
- **A registration lasts.** It is saved with the index, so after a restart the property is answered before the plugin that asked for it has even loaded. Changes made while Obsidian was closed are picked up from the metadata cache once it is ready.
- **Notes are never read for it.** Every answer comes from Obsidian's own metadata cache.

## Switching it off

```code-button
---
caption: Switch the Properties module off
---
await require('/demoSetup.ts').changeSettings(app, { isPropertiesModuleEnabled: false });
```

With it off, plugins that use it read the vault themselves again. See [04 Settings](<./04 Settings.md>) for the rest of the options.
