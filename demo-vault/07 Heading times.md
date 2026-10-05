# Heading times

Obsidian records when a **note** was created and modified, but nothing about the headings inside it. A long note that collects entries over time - a changelog, a log, a set of merged daily notes - cannot be sorted by when each section was written, because nothing knows.

The **Headings** module keeps that record. For every heading of a note it tracks:

- **created** - when the heading first appeared;
- **modified** - when its section last changed: its text, its level, or anything under it, subheadings included. Moving a whole section elsewhere in the note does not count;
- **seen** - when its own section was last on screen in the editor, for a couple of seconds, while the window had focus.

Nothing is written into your notes. The times live in `heading-times.json` in the plugin's own folder. It is a record for other plugins to read: [Advanced Note Composer](https://github.com/mnaoumov/obsidian-advanced-note-composer) uses it to sort headings by these times.

## See it

[Changelog](<./Topics/Changelog.md>) is a note with a few `##` entries. The first button switches the module on - it is off by default - and opens the note, which is when tracking starts:

```code-button
---
caption: Show the heading times of "Changelog"
---
await require('/demoSetup.ts').showHeadingTimesFor(app, 'Topics/Changelog.md');
```

The headings that were already there say **before tracking**: the plugin did not see them being written, and it does not guess. Give it something to see:

```code-button
---
caption: Add a new entry to "Changelog"
---
await require('/demoSetup.ts').addHeadingTo(app, 'Topics/Changelog.md');
```

```code-button
---
caption: Edit the "1.1.0" entry
---
await require('/demoSetup.ts').editUnderHeading(app, 'Topics/Changelog.md', '1.1.0');
```

The new entry is **created** just now, and the edited one is **modified** just now, while the others keep what they had. Then scroll the note, wait a couple of seconds, and show the times again: the sections you had on screen are **seen**.

## How a heading is recognized

Obsidian keeps no identity for a heading, so the module works it out by comparing each version of a note with the previous one:

1. A heading with the **same text** is the same heading, wherever it moved and whatever its level.
2. A heading whose **own text below it** is unchanged is the same heading, renamed.
3. A heading **in the same place** between the same neighbors is the same heading, renamed and edited.
4. Anything else is new.

So renaming a heading, moving a section, or renaming the note keeps the times. What it cannot tell apart: a heading deleted and the same text typed elsewhere (read as a move), and two headings with the same text that swap places.

## What to know

- **Only notes you work on are tracked.** A note is tracked from the first time it is opened, created or changed while the module is on. A vault nobody is working in costs nothing.
- **Times are per device.** Obsidian Sync does not carry the plugin's extra files, so each device keeps its own record, and a change that arrives by Sync is stamped when it arrives.
- **Changes made while Obsidian was closed** are caught on the next start and stamped with the note's modification time, the best time known for them.
- **Reading view is not measured** for **seen**: only the editor has the line positions to measure.

## Switching it off

```code-button
---
caption: Switch the Headings module off (the default)
---
await require('/demoSetup.ts').changeSettings(app, { isHeadingsModuleEnabled: false });
```

The record stays on disk, so switching it back on later loses nothing that was recorded. See [04 Settings](<./04 Settings.md>) for the rest of the options.
