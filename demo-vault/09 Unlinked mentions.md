# Unlinked mentions

The core **Backlinks** pane has a second section under the linked ones: **Unlinked mentions**, the notes that name a note in plain text without linking to it, each with a **Link** button that turns the mention into a link. To fill it, Obsidian reads **every note in the vault** and searches each one for the note's name and its `aliases` - every time you open a note with the section expanded.

The **Unlinked mentions** module keeps an index of which notes mention which note names, updated as each note changes, so the section reads only the notes that actually mention the note. It lists exactly what the built-in section lists, the same matches in the same notes, and the **Link** buttons work as before. Other plugins can ask the same question through the API.

## See it

Many notes in this vault name [Central topic](<./Topics/Central topic.md>) in plain text: in button captions, in prose, in code. A mention inside a link, an embed or the frontmatter does not count, so the links to it are left out. A mention inside code does count, because it does in Obsidian too.

```code-button
---
caption: Which notes mention "Central topic" without linking to it?
---
await require('/demoSetup.ts').showUnlinkedMentionsOf(app, 'Topics/Central topic.md');
```

And the section itself, filled by the module:

```code-button
---
caption: Open "Central topic" with its Unlinked mentions expanded
---
await require('/demoSetup.ts').showUnlinkedMentionsPane(app, 'Topics/Central topic.md');
```

## What it costs

The module reads every note once when it starts, in the background; until then the built-in section answers, so nothing is ever missing. After that, a changed note is re-read on its own. In a generated vault of 40,000 mostly empty notes, the cheapest case for the built-in scan, the section filled in about 0.18 s instead of 0.58 s, most of it spent drawing the listed notes, and the lookup itself took about 10 ms. Notes with text in them widen the gap, because only the built-in scan reads them all.

That first read is why the module is **off by default**. On a real vault of 35,000 notes and 78 MB of text it took about 6-8 s with the notes already in the system's file cache. The index is saved as per-note records in device-local IndexedDB, outside the vault. Every later start reuses notes whose modification time and size still match. The earlier JSON implementation used about 9 MB and loaded in about 1.2 s on that vault; those are historical measurements, not measurements of the new storage. A note created later, or an alias added later, is picked up by one more full read the first time its section is shown.

Obsidian matches a name as a whole word only where it starts or ends with a letter or a digit of the scripts it knows, and it does not count Chinese or Japanese characters among them. A name made only of such characters, or only of punctuation, has no word for the index to key it by, so the section for such a note is filled the built-in way.
