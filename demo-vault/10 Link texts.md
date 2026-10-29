# Link texts

A link can show a text of its own instead of the name of the note it points at: `[alpha](bravo.md)`, `[[bravo|alpha]]`. Over time those texts become the names you actually think of a note by, even though nobody ever added them to its `aliases`. An attachment collects them too, `![[IMG_2231.jpg|boarding pass]]`, and an attachment has no `aliases` at all.

The **Link texts** module keeps, for every note and attachment, the texts the links pointing at it use, with how many links use each and from which notes. Other plugins read them through the API as one more name for the file: a quick switcher can find [Quarterly report](<./Materials/10 Link texts/Quarterly report.md>) when you type `Q3 numbers`, or [scan-0042.pdf](<./Materials/10 Link texts/scan-0042.pdf>) when you type `March invoice`.

## See it

[Linking note](<./Materials/10 Link texts/Linking note.md>) links to both files with texts of its own.

```code-button
---
caption: Which texts do links use for "Quarterly report"?
---
await require('/demoSetup.ts').showLinkTextsOf(app, 'Materials/10 Link texts/Quarterly report.md');
```

```code-button
---
caption: Which texts do links use for "scan-0042.pdf"?
---
await require('/demoSetup.ts').showLinkTextsOf(app, 'Materials/10 Link texts/scan-0042.pdf');
```

Edit the links in [Linking note](<./Materials/10 Link texts/Linking note.md>) and ask again: the answer follows the edit.

## What counts

A link counts only when its text was written, in the body, in a frontmatter value or in an embed. `[[Quarterly report]]` writes none, and a text that only repeats the file's own name adds nothing. An embed's size, as in `![[IMG_2231.jpg|boarding pass|300]]`, is not part of its text.

## What it costs

The module reads the links Obsidian has already parsed, once when it starts, in the background, and reads no note. On a real vault of 35,000 notes this took about 3.5 s on a Windows desktop, and the index held about 8,000 texts in a few megabytes of memory. After that it follows Obsidian's own link resolution, one note at a time. It is **on by default**, because it is something other plugins read, and they could not use it if every user had to come here and switch it on first.
