# HTML source ranges

Other plugins can check HTML without parsing the whole vault again. The **HTML module** keeps the source locations of HTML blocks and tag candidates, then shares checks for unknown native tags and markup Obsidian changes or removes. It is off by default.

## Try the shared checks

The button copies a prepared text example into a Markdown note and reads it. The example contains a normal span, an unknown tag and a script tag. It also includes a literal code example that should not be checked.

```code-button
---
caption: Index HTML and show its diagnostics
---
await require('/demoSetup.ts').showHtmlDiagnostics(app);
```

Manual equivalent: copy [Example.txt](<./Materials/15 HTML/Example.txt>) into a note named `Materials/15 HTML/Indexed example.md`, enable **HTML module**, then ask the [plugin API](../docs/html.md) for `getHtmlDiagnosticsSafe('Materials/15 HTML/Indexed example.md')`. The results include the exact source positions; nothing in the note is changed.

```code-button
---
caption: Switch HTML indexing off (the default)
---
await require('/demoSetup.ts').changeSettings(app, { isHtmlModuleEnabled: false });
```

Manual equivalent: switch **HTML module** off. Its index and listeners are unloaded, and its API methods answer `null`.

## What the answers mean

An unknown HTML tag and a sanitizer change are different findings. A custom element is not unknown merely because it has a hyphen; SVG and MathML use their own namespace context. These are candidates for review, not automatic deletion instructions. Unusual Markdown syntax and HTML ancestors can affect how a fragment renders.

The first build reads notes once and reuses Obsidian's block sections. Later startups restore unchanged notes from a local checkpoint; edits scan only the changed note. Lookups from several plugins reuse the same data. The checkpoint stays on this device.
