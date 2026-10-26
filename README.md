# Advanced Metadata Cache

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/mnaoumov) [![GitHub release](https://img.shields.io/github/v/release/mnaoumov/obsidian-advanced-metadata-cache)](https://github.com/mnaoumov/obsidian-advanced-metadata-cache/releases) [![GitHub downloads](https://img.shields.io/github/downloads/mnaoumov/obsidian-advanced-metadata-cache/total)](https://github.com/mnaoumov/obsidian-advanced-metadata-cache/releases) [![Coverage: 100%](https://img.shields.io/badge/coverage-100%25-brightgreen)](https://github.com/mnaoumov/obsidian-advanced-metadata-cache)

Some of the questions [Obsidian](https://obsidian.md/) answers about a vault have no index behind them. Asking which notes link to this one means scanning every note, on every call — the Backlinks pane pays that cost, and so does every plugin that asks the same question. Asking what every note is called means the same walk, and the `[[` autocomplete pays it every single time you open it. On a large vault it is slow enough to be felt.

This plugin maintains the indexes those questions deserve and answers from them instead. It does so by replacing the method that already asks the question, so nothing has to know the plugin is installed: the Backlinks pane gets faster, and so does anything else that asks.

Each index is a **module** that is switched on or off on its own, so a vault only pays for the ones it uses. On a small vault you will not notice any of them; that is the point at which you do not need this.

<!-- markdownlint-disable MD033 -->

<a href="https://github.com/mnaoumov/obsidian-advanced-metadata-cache/blob/HEAD/images/screenshots/screenshot-desktop-1.png"><img src="images/screenshots/screenshot-desktop-1.png" alt="The Backlinks module: all 120 backlinks in a big vault" width="600"></a>

<details>
<summary>More screenshots</summary>

<div>
<a href="https://github.com/mnaoumov/obsidian-advanced-metadata-cache/blob/HEAD/images/screenshots/screenshot-desktop-2.png"><img src="images/screenshots/screenshot-desktop-2.png" alt="Answered from an index, not a scan of every note" width="600"></a>
<a href="https://github.com/mnaoumov/obsidian-advanced-metadata-cache/blob/HEAD/images/screenshots/screenshot-desktop-3.png"><img src="images/screenshots/screenshot-desktop-3.png" alt="The same answer as Obsidian, arrived at faster" width="600"></a>
<a href="https://github.com/mnaoumov/obsidian-advanced-metadata-cache/blob/HEAD/images/screenshots/screenshot-desktop-4.png"><img src="images/screenshots/screenshot-desktop-4.png" alt="Every index is a module, switched on by itself" width="600"></a>
<a href="https://github.com/mnaoumov/obsidian-advanced-metadata-cache/blob/HEAD/images/screenshots/screenshot-mobile-1.png"><img src="images/screenshots/screenshot-mobile-1.png" alt="The Backlinks module: every backlink, in one list" width="270"></a>
<a href="https://github.com/mnaoumov/obsidian-advanced-metadata-cache/blob/HEAD/images/screenshots/screenshot-mobile-2.png"><img src="images/screenshots/screenshot-mobile-2.png" alt="Answered from an index, not a scan of every note" width="270"></a>
<a href="https://github.com/mnaoumov/obsidian-advanced-metadata-cache/blob/HEAD/images/screenshots/screenshot-mobile-3.png"><img src="images/screenshots/screenshot-mobile-3.png" alt="The same answer as Obsidian, arrived at faster" width="270"></a>
<a href="https://github.com/mnaoumov/obsidian-advanced-metadata-cache/blob/HEAD/images/screenshots/screenshot-mobile-4.png"><img src="images/screenshots/screenshot-mobile-4.png" alt="The same modules, on the phone" width="270"></a>
</div>

</details>

<!-- markdownlint-enable MD033 -->

## Demo vault

**The documentation is an interactive demo vault.** Every feature has a note that explains what it does and why you would want it, with buttons that measure the difference for real.

**[Start reading here](<./demo-vault/00 Start.md>)** — it is plain markdown, so it works on GitHub with nothing installed.

A copy of the vault ships with every release. You can access it via any of the following:

1. Running the **`Advanced Metadata Cache`: Open demo vault** command.
2. Downloading `advanced-metadata-cache-demo-vault.zip` from the [Releases](https://github.com/mnaoumov/obsidian-advanced-metadata-cache/releases). It unzips into a single `advanced-metadata-cache-demo-vault-<version>` folder.
3. Browsing its source in [`demo-vault/`](./demo-vault/README.md) in this repository.

## What it does

- **A backlink index that keeps itself current**, so the Backlinks pane and every plugin that asks for backlinks stop rescanning the vault. [01 Backlink cache](<./demo-vault/01 Backlink cache.md>)
- **Three ways to ask** — fast from the cache, safe after pending changes settle, or the original built-in implementation for comparison. [02 Fast, safe, and original backlinks](<./demo-vault/02 Fast, safe, and original backlinks.md>)
- **Canvas files are indexed too**, and their links are exposed through `getCache()`, which is otherwise left empty for canvas files. That answer is kept in memory and never written into Obsidian's persisted cache, and a full canvas entry another plugin answers, such as the one `Advanced Canvas` builds with the canvas's `frontmatter`, is returned as it is. [03 Canvas backlinks](<./demo-vault/03 Canvas backlinks.md>)
- **Frontmatter markdown links count as backlinks** when the [`Frontmatter Markdown Links`](https://community.obsidian.md/plugins/frontmatter-markdown-links) plugin is installed. [03 Canvas backlinks](<./demo-vault/03 Canvas backlinks.md>)
- **A name index behind the `[[` autocomplete**, so opening it stops rescanning every note in the vault for its name and aliases. [05 Name index](<./demo-vault/05 Name index.md>)
- **A frontmatter property can name a note too**, so a note titled in its `title` property is found under that title — and, if you ask for it, offered under that title by the `[[` autocomplete. [06 Titles](<./demo-vault/06 Titles.md>)
- **When each heading was created, modified and seen**, recorded per heading without touching the note, so other plugins can sort a note's headings by time. [07 Heading times](<./demo-vault/07 Heading times.md>)
- **Notes by frontmatter property value**, for other plugins to ask which notes carry a property, or a given value of it, without scanning the vault, answered straight from disk at startup. [08 Property index](<./demo-vault/08 Property index.md>)
- **Every index is a module of its own**, switched on or off without touching the others, and refresh behavior is configurable. [04 Settings](<./demo-vault/04 Settings.md>)

## Modules

| Module     | What it indexes                                                                               | Default |
|------------|-----------------------------------------------------------------------------------------------|---------|
| Backlinks  | Which notes link to a note, answering `getBacklinksForFile()`.                                | On      |
| Names      | What each note is called - its name and its `aliases` - answering `getLinkSuggestions()`.     | Off     |
| Titles     | What a note's own frontmatter says it is called, read per note and on demand.                 | Off     |
| Headings   | When each heading of a note was created, last modified and last seen.                         | Off     |
| Properties | Which notes carry the frontmatter properties other plugins registered, and with which values. | On      |

Switching a module off unloads it completely — its index, its listeners and the commands it registers all go with it, and the built-in implementation answers again. Switching one back on rebuilds its index from scratch.

### Titles

A note can carry its real name in a frontmatter property rather than in its filename — `title` is the usual one, and several plugins write it. Obsidian itself does not treat that value as a name, so nothing can find the note by it.

Switch the **Titles** module on and every property you list there is read as a name. The list defaults to `title` alone, and it joins the note's own name and its `aliases`:

```yaml
---
title: The Real Name
---
```

Two things then know about it. `getPathsByName('The Real Name')` finds the note, while the **Names** module is on — and any other plugin can read the same properties and the same per-note answer, so you name the property here once instead of once per plugin.

**It does not change the `[[` autocomplete unless you ask it to.** Out of the box the list Obsidian offers there is answered faster by this plugin, not differently, so nothing about typing a link moves. Switch **Offer titles in the `[[` autocomplete** on — it appears under **Settings** once both the **Names** and **Titles** modules are on — and every title is offered there too, appended after everything Obsidian itself would have offered rather than ranked against it. Accepting one writes a link like:

```markdown
[[Notes/some-note|The Real Name]]
```

which resolves through Obsidian's own machinery, survives a rename, and keeps working if you ever switch this plugin off. A title that already matches the note's own name or one of its `aliases` is not offered a second time.

This is the reverse direction from [Front Matter Title](https://github.com/snezhig/obsidian-front-matter-title), and the two are independent by design: that plugin takes a note and shows you its title, in the explorer, the tabs and the graph. This one takes a title and finds you the note. If you run both, name the property in each — one setting silently changing what another plugin answers would be worse than typing it twice.

### Headings

Obsidian records when a note was created and modified, but nothing about the headings inside it. Switch the **Headings** module on and, for every heading of the notes you work on, it records:

- **created**: when the heading first appeared;
- **modified**: when its section last changed (its text, its level, or anything under it, subheadings included). Moving a whole section elsewhere in the note does not count;
- **seen**: when its own section was last on screen in the editor for a couple of seconds, while the window had focus. Reading view is not measured.

Obsidian keeps no identity for a heading, so the module works one out by comparing each version of a note with the previous one: same text first, then the same text under the heading (a rename), then the same place between the same neighbors (a rename plus an edit). Renaming a heading, moving a section, changing its level or renaming the note keeps the history. A heading deleted and the same text typed elsewhere reads as a move, and two headings with the same text that swap places keep each other's history.

Nothing is written into the note. The times live in `heading-times.json` in the plugin folder, for notes opened, created or changed while the module is on, so a vault nobody is working in costs nothing. They are what this device saw: a change made on another device is stamped when it arrives here. A heading that was already there when its note started being tracked has no `created` or `modified` time, rather than a guessed one.

The module has no user interface of its own: it is there for other plugins to read, through the API below. [Advanced Note Composer](https://github.com/mnaoumov/obsidian-advanced-note-composer) sorts headings by these times.

### Properties

Some plugins need to find notes by a frontmatter value: which note holds the key `abc123`, which notes carry a `keys` property at all. Obsidian has no index for that, so every such plugin scans the vault, and at startup it scans it before it can answer anything.

The **Properties** module keeps that index for them. It indexes only the properties another plugin registers, plus every property whose type is `Date` or `Date & time`, so a vault with none of either costs nothing, and it is **on by default** for that reason. Dates are also kept in order, so a plugin can ask for every note dated within a range, or for every birthday in the coming month, without reading the vault. The index lives in `property-values.json` in the plugin folder, so at the next startup it answers straight from disk, and it is brought up to date from Obsidian's own metadata cache once that is ready, never by reading the notes themselves.

The module has no user interface of its own: it is there for other plugins to read, through the API below.

## For plugin developers

Everything this plugin offers another plugin is declared in one hand-written file — [api.d.ts](./api.d.ts) at the repository root. It imports from `obsidian` and nothing else, so you can copy it into your own code or reference it where it sits, with no build-time dependency on this repository.

Beside it, [api-contract.ts](./api-contract.ts) holds the published API's contract, `ADVANCED_METADATA_CACHE_API_CONTRACT`: for every method, a schema over its arguments and a schema over what it returns. It is the constant this plugin publishes with the API, so copy it next to `api.d.ts` and pass it as the `contract`, and both sides check the same definition. Its [Standard Schema](https://standardschema.dev) builders, contract types and guard builders come from [`@mnaoumov/typescript-lib`](https://github.com/mnaoumov/typescript-lib#api-contracts), and its file guards from [`@mnaoumov/obsidian-lib`](https://www.npmjs.com/package/@mnaoumov/obsidian-lib), so copying it means adding both packages to your dependencies (`npm install @mnaoumov/typescript-lib @mnaoumov/obsidian-lib`, typescript-lib `1.3.0` or later); `api.d.ts` alone needs nothing but `obsidian`. (It is not named `api.ts`: TypeScript would read `api.d.ts` as that file's own declarations.)

### The faster core calls

While the **Backlinks** module is on, `app.metadataCache.getBacklinksForFile(file)` is answered from this plugin's cache, and while the **Names** module is on, `app.metadataCache.getLinkSuggestions()` is answered from the name index instead of from a full vault walk. Both keep Obsidian's own signature and answer what Obsidian would, so every plugin that calls them gets the faster answer without knowing this plugin exists. There is nothing to do to use them.

### The published API

Everything beyond that — the titles and heading times core has no method for, and the safe, original and reverse-lookup variants of the two core calls — is published as an API, `AdvancedMetadataCacheApi` in [api.d.ts](./api.d.ts):

```ts
import { watchPluginApi } from '@mnaoumov/obsidian-lib/plugin/plugin-api';

import type { AdvancedMetadataCacheApi } from './api.d.ts';

import { ADVANCED_METADATA_CACHE_API_CONTRACT } from './api-contract.ts';

const apiRef = watchPluginApi<AdvancedMetadataCacheApi>({
  apiVersionRange: '^1.3',
  app: this.app,
  component: this,
  contract: ADVANCED_METADATA_CACHE_API_CONTRACT,
  pluginId: 'advanced-metadata-cache'
});

// `value` is always current and never stale: `null` while this plugin is not loaded, and non-`null`
// on its own once it is.
const api = apiRef.value;
if (api) {
  console.log(api.getTitlePropertyNames()); // ['title']
  console.log(api.getTitles('Notes/Some note.md')); // ['The Real Name']
}
```

The handle comes from the `@mnaoumov/obsidian-lib` plugin registry; [Cross-plugin APIs](https://mnaoumov.dev/obsidian-lib/guides/cross-plugin-apis/) covers `watchPluginApi` and the registry from the library's side. The contract version moves independently of the plugin's own, so ask for a range, and ask for the lowest version that has every member you call — each one below says which it arrived in.

#### Backlinks

Added in contract `1.3.0`:

```ts
const fast = api.getBacklinksForFile(pathOrFile);
const safe = await api.getBacklinksForFileSafe(pathOrFile);
const original = api.getBacklinksForFileOriginal(file);
```

`getBacklinksForFile` reads straight from the cache and accepts a vault path as well as a `TFile`; it may be a moment behind a change Obsidian has not finished processing. `getBacklinksForFileSafe` waits for those changes first. Both answer **`null` while the Backlinks module is off** — call the core method then. `getBacklinksForFileOriginal` is Obsidian's own implementation, bypassing the cache, and always answers. [02 Fast, safe, and original backlinks](<./demo-vault/02 Fast, safe, and original backlinks.md>) runs all three side by side.

#### Names

Added in contract `1.3.0`:

```ts
const fast = api.getLinkSuggestions();
const safe = await api.getLinkSuggestionsSafe();
const original = api.getLinkSuggestionsOriginal();

const paths = api.getPathsByName('Some Alias');
const safePaths = await api.getPathsByNameSafe('Some Alias');
```

`getPathsByName` answers "which notes are called this?" — matching a note's own name, any of its `aliases` or any of its [titles](#titles), case-insensitively and with runs of whitespace collapsed, exactly as Obsidian resolves a wikilink. The answer is a **list** and is deliberately unranked: several notes may declare the same alias, and which one the user meant is a question about your context, not about the vault.

**The array `getLinkSuggestions()` answers with is Obsidian's own, entry for entry** — `getLinkSuggestionsOriginal()` is there so you can check. The single exception is the **Offer titles in the `[[` autocomplete** setting described under [Titles](#titles): with it on, the title entries are *appended*, so Obsidian's array stays a strict prefix of what you get and the difference is exactly a suffix. It is off by default, so a consumer that has not been told otherwise can treat the two as identical.

**Use the `Safe` variants when you may be asked early.** The index is built once the metadata cache can answer; until then `getLinkSuggestions()` falls through to Obsidian's implementation and `getPathsByName` answers with nothing. `getLinkSuggestionsSafe()` / `getPathsByNameSafe()` wait for the build. All four answer **`null` while the Names module is off**; `getLinkSuggestionsOriginal` always answers. [05 Name index](<./demo-vault/05 Name index.md>) runs them.

#### Removed in 2.0.0: the members on the core methods

Before `1.3.0` these calls were reached through members this plugin added to the patched core methods. `1.3.0` deprecated them and **2.0.0 removed them**, because nothing of this plugin's own belongs on an Obsidian function: the patched methods now keep Obsidian's own signature and carry nothing else. Each has a replacement on the API:

| Removed                                                     | Use instead                                  |
|-------------------------------------------------------------|----------------------------------------------|
| `app.metadataCache.getBacklinksForFile(path)`, with a path  | `api.getBacklinksForFile(path)`              |
| `app.metadataCache.getBacklinksForFile.safe(pathOrFile)`    | `api.getBacklinksForFileSafe(pathOrFile)`    |
| `app.metadataCache.getBacklinksForFile.originalFn(file)`    | `api.getBacklinksForFileOriginal(file)`      |
| `app.metadataCache.getLinkSuggestions.safe()`               | `api.getLinkSuggestionsSafe()`               |
| `app.metadataCache.getLinkSuggestions.originalFn()`         | `api.getLinkSuggestionsOriginal()`           |
| `app.metadataCache.getLinkSuggestions.getPathsByName(n)`    | `api.getPathsByName(n)`                      |
| `app.metadataCache.getLinkSuggestions.getPathsByNameSafe(n)`| `api.getPathsByNameSafe(n)`                  |

#### Titles

`getTitlePropertyNames` and `getTitles` arrived in contract `1.0.0`. Both answer **empty while the Titles module is off**, which is the same answer as "no property is configured" and is meant to be.

`getTitles` is synchronous and lazily memoized per note, so it is safe on a per-keystroke path. Read `getTitlePropertyNames()` and show that list rather than offering a property setting of your own — one place to type `title` is the point of the setting living here.

#### Handing over a title property of your own

A plugin that used to own a title property setting hands its value over with `migrateSettings`, added in contract `1.1.0`. It is the envelope of `@mnaoumov/obsidian-lib`'s `SettingsMigrationApi`, so `SettingsMigrationComponent` drives it for you. Watch this plugin's API with the contract `{ migrateSettings: {} }` and the range `^1`, then propose `{ titlePropertyNames: ['subtitle'] }`. Against a `1.0.0` provider, the offer waits instead of failing.

This plugin owns the list, so it owns the dialog. The dialog names your plugin, shows the proposed names beside the current list, and suggests the proposed names ADDED to that list (a name already on it in any casing is not added twice), which the user can approve, edit or decline. While the Titles module is off, it also offers to switch it on. The call resolves `{ isApplied: false }` on a cancel, so retire your pending value only on `true`. When there is nothing to change, it resolves `true` without showing anything.

#### Heading times

`getHeadingTimes(pathOrFile)`, added in contract `1.2.0`, answers a note's headings in document order, each with its text, level, line and three times, Unix epoch milliseconds:

```ts
for (const { created, heading, level, modified, seen } of api.getHeadingTimes('Notes/Changelog.md')) {
  console.log(level, heading, created, modified, seen);
}
```

A time is `null` when the plugin did not see the event happen, so sort `null` as the oldest and keep document order among equals. It is synchronous and current as of the last parse Obsidian announced: if you have just edited the note, await `getCacheSafe` from `@mnaoumov/obsidian-lib` first. It answers empty while the **Headings** module is off, and a note that is not tracked yet answers its current headings with every time `null`. Ask for the range `^1.2`.

#### Notes by property value

Added in contract `1.4.0`. Register the property once on load, then ask:

```ts
api.registerPropertyName('keys');

const paths = api.getPathsByPropertyValue('keys', 'abc123');
const withKeys = api.getPathsWithProperty('keys');

const safePaths = await api.getPathsByPropertyValueSafe('keys', 'abc123');
const safeWithKeys = await api.getPathsWithPropertySafe('keys');
```

`getPathsByPropertyValue` finds the notes whose property holds the value — the property itself when it is a scalar, or one of its members when it is a list. Names and values are matched exactly. A number or a boolean is matched by its string form, so `'7'` finds `keys: 7`, and `null` or an object is never matched. `getPathsWithProperty` finds every note carrying the property at all, `null` and an empty list included. Both answer unordered paths.

**A registration is durable**: it is saved with the index, so at the next startup the property is answered from disk before your plugin has even loaded. There is no unregister; registering again is harmless.

**Use the `Safe` variants when the answer must be current.** At startup the index answers with what the previous session saved, at once, but it does not know yet what changed while Obsidian was closed — a note synced or edited outside Obsidian. Once the metadata cache is ready the index is rebuilt from it, and the `Safe` variants wait for that. All four answer **`null` for a property nobody registered and while the Properties module is off** — scan the vault yourself then. Ask for the range `^1.4`.

#### Notes by date

Added in contract `1.5.0`. Every property whose type is `Date` or `Date & time` is indexed with no registration, in each casing a note spells it, and its values are kept in order:

```ts
// Every dated value in the vault, oldest first.
const all = api.getDatedValues({});

// Every note dated in the first half of 2026, by one property.
const due = api.getDatedValues({ from: '2026', propertyNames: ['due'], to: '2026-06' });

// Every birthday from today to a month from now, whatever the year; `from` after `to` wraps the year end.
const upcoming = api.getDatedValues({ from: '10-26', isRecurring: true, propertyNames: ['birthday'], to: '11-25' });

const safeAll = await api.getDatedValuesSafe({});
```

Each entry is `{ path, propertyName, value }`, and a list property gives one entry per date it lists. A value counts as a date when it is shaped `YYYY-MM-DD`, optionally followed by `THH:mm`, `THH:mm:ss` or `THH:mm:ss.sss`, with no time zone: what Obsidian's own date pickers write. A registered property of any type contributes the values of that shape too.

Both bounds are **inclusive and compared as prefixes**, so `to: '2026-06'` includes the whole of June and `to: '2026-06-30'` includes `2026-06-30T23:59`; leave a bound out for no bound. With `isRecurring` on, the bounds are a month and day (`'10-26'`) or a month (`'10'`), and the answer is ordered by month and day, then by year. Otherwise it is ordered by value. Ties are broken by property name, then by path.

A property is registered the first time a note carries it with a date type, or when the type is assigned to it, and like any registration that lasts: changing its type back keeps it indexed. The answer is `null` when `propertyNames` names a property that is not indexed, and while the Properties module is off. Ask for the range `^1.5`.

If you would rather not depend on `@mnaoumov/obsidian-lib` for the handle, the registry is a documented wire protocol you can read directly — see [Plugin API protocol](https://mnaoumov.dev/obsidian-lib/guides/plugin-api-protocol/).

## Installation

The plugin is available in [the official Community Plugins repository](https://community.obsidian.md/plugins/advanced-metadata-cache).

### Beta versions

To install the latest beta release of this plugin (regardless if it is available in [the official Community Plugins repository](https://community.obsidian.md) or not), follow these steps:

1. Ensure you have the [BRAT plugin](https://community.obsidian.md/plugins/obsidian42-brat) installed and enabled.
2. Click [Install via BRAT](https://intradeus.github.io/http-protocol-redirector?r=obsidian://brat?plugin=https://github.com/mnaoumov/obsidian-advanced-metadata-cache).
3. An Obsidian pop-up window should appear. In the window, click the `Add plugin` button once and wait a few seconds for the plugin to install.

## Debugging

By default, debug messages for this plugin (id: `advanced-metadata-cache`) are hidden.

If you need to enable them refer to the [documentation](https://mnaoumov.dev/obsidian-lib/guides/debugging/).

## Contributing

Contributions are welcome — see [CONTRIBUTING](./CONTRIBUTING.md) to get set up.

## Support

<!-- markdownlint-disable MD033 -->

<a href="https://www.buymeacoffee.com/mnaoumov" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217"></a>

<!-- markdownlint-enable MD033 -->

## My other Obsidian resources

[See my other Obsidian resources](https://github.com/mnaoumov/obsidian-resources).

## License

© [Michael Naumov](https://github.com/mnaoumov/)
