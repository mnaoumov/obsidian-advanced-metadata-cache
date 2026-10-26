# Property index

Some plugins find notes by a frontmatter value: which note holds a given key, which notes carry a property at all. Obsidian has no index for that, so each such plugin reads the whole vault, and at startup it has to before it can answer anything.

The **Properties** module keeps that index for them. It indexes only the properties another plugin registers, plus every property whose type is a date, so with neither it costs nothing, and it is **on by default** for that reason. The index is saved in `property-values.json` in the plugin's own folder, so the next startup answers straight from disk.

## See it

Three notes in [Topics](<./Topics/Reading list.md>) carry a `status` property: [Research note](<./Topics/Research note.md>) says `reading`, [Reading list](<./Topics/Reading list.md>) lists `reading` and `shared`, and [Meeting note](<./Topics/Meeting note.md>) says `done`. The button registers `status`, the way a plugin would on load, and asks:

```code-button
---
caption: Which notes are "reading"?
---
await require('/demoSetup.ts').showPathsByPropertyValue(app, 'status', 'reading');
```

A list value counts when any of its members matches, so both notes come back, and the meeting note does not. Change a `status` in one of those notes and press the button again: the answer follows at once.

## Dates

The same three notes carry a `due` property, and `due` has the **Date** type (set in `.obsidian/types.json`, the file Obsidian writes when you pick a type for a property). A property with a date type is indexed with nobody registering it, and its dates are also kept **in order**, so a plugin can ask for a range:

```code-button
---
caption: What is due in October and November 2026?
---
await require('/demoSetup.ts').showDatedValues(app, { from: '2026-10', to: '2026-11' });
```

The meeting note's date is in 2025, so it is left out. A range can also ignore the year, which is how a plugin lists upcoming birthdays or anniversaries:

```code-button
---
caption: What falls between September and October, in any year?
---
await require('/demoSetup.ts').showDatedValues(app, { from: '09', isRecurring: true, to: '10' });
```

Change a `due` date, or give another property the Date type in the **Properties** view, and press a button again.

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
