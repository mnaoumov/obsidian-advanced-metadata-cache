# Titles

Plenty of notes carry their real name in a frontmatter property rather than in their filename. [Meeting note](<./Topics/Meeting note.md>) is one of them:

```yaml
---
title: Q3 planning meeting
---
```

Obsidian does nothing with that value. It is not the note's name, it is not an alias, and nothing in the vault can find the note by it.

The **Titles** module makes it a name. Every property you list is read as one, alongside the note's own name and its `aliases`, and the list defaults to `title` alone.

## See it

The button switches both **Titles** and **Names** on for you - both are off by default - and asks what each name points at:

```code-button
---
caption: What does "Q3 planning meeting" name?
---
await require('/demoSetup.ts').showNamesFor(app, 'Q3 planning meeting', { isTitlesModuleEnabled: true });
```

```code-button
---
caption: And with the Titles module off?
---
await require('/demoSetup.ts').showNamesFor(app, 'Q3 planning meeting', { isTitlesModuleEnabled: false });
```

The same question, twice, with one toggle between them: with the module on, the title names [Meeting note](<./Topics/Meeting note.md>); with it off, it names nothing at all.

```code-button
---
caption: Read the titles of "Meeting note" directly
---
await require('/demoSetup.ts').showTitlesFor(app, 'Topics/Meeting note.md');
```

That last one is the other half of the module, and the half other plugins use: given a note, what is it called? It is answered per note and on demand, so there is no index to build and nothing to wait for.

## What it does NOT do

**It does not change the `[[` autocomplete.** Type `[[Q3` and nothing is offered, even with the module on, and that is deliberate: this plugin answers the built-in list *faster*, never *differently*. A title is a name for looking a note **up** - which is what the buttons above do - not a new thing to offer when you are typing a link.

## Naming more than one property

The list is plural, so a vault that uses several name-bearing properties lists them all:

```code-button
---
caption: Read "title" and "heading" as titles
---
await require('/demoSetup.ts').changeSettings(app, { titlePropertyNames: ['title', 'heading'] });
```

```code-button
---
caption: Back to "title" alone (the default)
---
await require('/demoSetup.ts').changeSettings(app, { titlePropertyNames: ['title'] });
```

Manual equivalent: edit **Title properties** in **Settings -> Community plugins -> Advanced Metadata Cache**, one property per line.

## If you also use Front Matter Title

[Front Matter Title](https://github.com/snezhig/obsidian-front-matter-title) does the opposite thing: it takes a note and *shows* you its title, in the file explorer, the tabs and the graph. This module takes a title and *finds* you the note.

The two are independent on purpose. If you run both, name the property in each. One plugin's setting silently deciding what another one answers is harder to understand than typing `title` twice - and you would have no way to tell, from this plugin's settings, why its answers had changed.

## Switching it off

```code-button
---
caption: Switch the Titles module off (the default)
---
await require('/demoSetup.ts').changeSettings(app, { isTitlesModuleEnabled: false });
```

See [04 Settings](<./04 Settings.md>) for the rest of the options.
