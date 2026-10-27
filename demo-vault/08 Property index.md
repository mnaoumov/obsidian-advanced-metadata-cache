# Property index

Some plugins find notes by a frontmatter value: which note holds a given key, which notes carry a property at all. Obsidian has no index for that, so each such plugin reads the whole vault, and at startup it has to before it can answer anything.

The **Properties** module keeps that index for them. It indexes only the properties another plugin registers, plus every date property, so with neither it costs nothing, and it is **on by default** for that reason. The values are saved in device-local IndexedDB, so the next startup answers straight from disk. Registered property names sync through bounded Markdown journals under `Plugin data/advanced-metadata-cache/`; their values are rebuilt on each device.

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
await require('/demoSetup.ts').showDatedValues(app, { from: '2026-10', propertyNames: ['due'], to: '2026-11' });
```

The meeting note's date is in 2025, so it is left out. A range can also ignore the year, which is how a plugin lists upcoming birthdays or anniversaries:

```code-button
---
caption: What falls between September and October, in any year?
---
await require('/demoSetup.ts').showDatedValues(app, { from: '09', isRecurring: true, propertyNames: ['due'], to: '10' });
```

Change a `due` date, or give another property the Date type in the **Properties** view, and press a button again.

## Dates by name

A property can be a date property by its **name** too, with no type set. The **Date properties** setting lists the names, and its default, `date` and `*Date`, covers `birthDate`, `startDate` and the `reviewDate` the three notes carry, which has no type in `types.json`. Their values show what else counts as a date: [Research note](<./Topics/Research note.md>) has `2026-10-26T23:00-06:00`, with an offset, and [Reading list](<./Topics/Reading list.md>) has `2026-10-27T08:00+02:00[Europe/Kyiv]`, with a time zone.

```code-button
---
caption: What is up for review on October 26, 2026?
---
await require('/demoSetup.ts').showDatedValues(app, { from: '2026-10-26', propertyNames: ['reviewDate'], to: '2026-10-26' });
```

The research note comes back: a zoned value is placed on the day **as written**, although 23:00 at -06:00 is already the 27th in UTC. [Meeting note](<./Topics/Meeting note.md>) says `after the release`, which is not a date, so it is in no range. It is not lost either:

```code-button
---
caption: Which date values are not dates?
---
await require('/demoSetup.ts').showNonDateValues(app);
```

A time alone, such as `14:30`, is not a date either.

## Dates by UTC instant

The same dates can be queried by UTC instant. The research note's `2026-10-26T23:00-06:00` then falls on October 27:

```code-button
---
caption: What is up for review on October 27 in UTC?
---
await require('/demoSetup.ts').showDatedValues(app, { from: '2026-10-27T00:00Z', to: '2026-10-27T23:59:59.999Z', propertyNames: ['reviewDate'], timeBasis: 'utc', missingTimeZone: 'skip' });
```

| Missing time zone option | Meaning |
| --- | --- |
| `default` (or omitted) | Use **Default time zone** in settings; empty follows this device. Pin it for consistent answers across devices. |
| `utc` | Treat values without a zone as UTC. |
| `{ zone: 'Europe/Kyiv' }` | Use this IANA zone for this query. |
| `skip` | Omit values without a zone. |
| `fail` | Throw if a value without a zone overlaps the range in the default zone. |

A date without a time spans its whole day, and a reduced-precision month or year spans its whole period. A time in a DST gap moves forward; a repeated time chooses its earlier occurrence. UTC queries take complete bounds with an offset and cannot recur. A value's explicit offset takes precedence over its zone annotation. [The API reference](https://github.com/mnaoumov/obsidian-advanced-metadata-cache/blob/HEAD/docs/api.md#utc-queries) explains the query contract.

## What to know

- **Matched exactly.** Names and values are compared as typed, case included, and so are the **Date properties** patterns. A number or a boolean is matched by its string form, so `7` finds `status: 7`.
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
