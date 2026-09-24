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

## The `[[` autocomplete, if you want it

**By default it does not change the `[[` autocomplete.** Type `[[Q3` and nothing is offered, even with the module on. That is deliberate rather than an oversight: this plugin answers the built-in list *faster*, never *differently*, and a title is a name for looking a note **up** - which is what the buttons above do - rather than a new thing to offer while you type.

For a vault whose filenames are ids and whose real names live in frontmatter, though, that is precisely the wrong answer - being unable to link by the title *is* the whole problem. So it is a setting, **Offer titles in the `[[` autocomplete**, off by default and visible once both modules are on. See both sides of it:

```code-button
---
caption: Is "Q3 planning meeting" offered to the autocomplete? (setting OFF, the default)
---
await require('/demoSetup.ts').showAutocompleteOfferFor(app, 'Q3 planning meeting', false);
```

```code-button
---
caption: And with the setting ON?
---
await require('/demoSetup.ts').showAutocompleteOfferFor(app, 'Q3 planning meeting', true);
```

With it on, type `[[Q3` in any note and [Meeting note](<./Topics/Meeting note.md>) is offered under its title. Three things are worth knowing about what you get:

- **The title entries are appended, not ranked in.** Everything Obsidian itself would have offered comes first, in its own order, and the titles follow. Which of a name, an alias and a title you meant is a question about your vault that this plugin does not have an answer to, so it does not invent one - the same reason the reverse lookup above is unranked. That is also why the two counts in the notices differ by exactly the titles: the built-in list is still the whole front of the indexed one.
- **Accepting one writes a normal link.** `[[Topics/Meeting note|Q3 planning meeting]]`, not `[[Q3 planning meeting]]`. Obsidian resolves it on its own, renames update it, and it keeps working if you ever switch this plugin off. A bare title would resolve only while the plugin is enabled, which is a trap rather than a feature.
- **Nothing is offered twice.** A title that already matches the note's own name or one of its `aliases` contributes no extra entry.

```code-button
---
caption: Back to not offering titles (the default)
---
await require('/demoSetup.ts').showAutocompleteOfferFor(app, 'Q3 planning meeting', false);
```

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
await require('/demoSetup.ts').changeSettings(app, { isTitlesModuleEnabled: false, shouldOfferTitlesInLinkSuggestions: false });
```

See [04 Settings](<./04 Settings.md>) for the rest of the options.
