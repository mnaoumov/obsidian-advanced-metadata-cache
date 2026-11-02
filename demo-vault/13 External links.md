# External links

Obsidian keeps no record of links to websites. A link like `[the docs](https://obsidian.md/help)` or a bare `https://obsidian.md` is shown as a link, but it is not in Obsidian's metadata cache, so a plugin that wants every note linking to a site has to read every note in the vault.

The **External links** module reads each note once and keeps, for every page and every site the vault links to, the notes linking to it, with the position of each link. Other plugins read it through the API to show a site's "backlinks", to suggest URLs already used while you type a link, and to flag a host that looks like a typo of a common one.

## See it

[Plugin research](<./Materials/13 External links/Plugin research.md>) links to `github.com` in its text and in a `source` property, [Release checklist](<./Materials/13 External links/Release checklist.md>) links to the same page written differently and to a subdomain, and [Typo](<./Materials/13 External links/Typo.md>) links to `githb.com`.

```code-button
---
caption: Which notes link to github.com?
---
await require('/demoSetup.ts').showExternalLinksTo(app, 'github.com');
```

The button switches the module on if it is off. It lists the notes linking to the site, with and without its subdomains, the notes linking to one page, and the hosts that look like a typo of it. Edit a link in one of those notes and ask again: the answer follows the edit.

## What counts

Every `http` or `https` URL in a note counts: bare, in a markdown link, in `<...>`, and in a property, outside code blocks and inline code. The punctuation that ends a sentence after a URL is not part of it, while parentheses that belong to it, as in a Wikipedia address, are.

Two links count as the same page when they differ only in `http` against `https`, a `www.`, the case of the host, a `#fragment` or a trailing `/`. A query string such as `?v=...` makes a different page.

## What it costs

Since Obsidian keeps no external link anywhere, the module reads every note once when it is switched on and each time Obsidian starts, in the background. After that it reads nothing: Obsidian hands over a note's text each time it parses the note again. Nothing is kept on disk yet. It is **off by default**, like most modules.
