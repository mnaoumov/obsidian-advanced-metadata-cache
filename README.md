# Advanced Metadata Cache

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/mnaoumov) [![GitHub release](https://img.shields.io/github/v/release/mnaoumov/obsidian-advanced-metadata-cache)](https://github.com/mnaoumov/obsidian-advanced-metadata-cache/releases) [![GitHub downloads](https://img.shields.io/github/downloads/mnaoumov/obsidian-advanced-metadata-cache/total)](https://github.com/mnaoumov/obsidian-advanced-metadata-cache/releases) [![Coverage: 100%](https://img.shields.io/badge/coverage-100%25-brightgreen)](https://github.com/mnaoumov/obsidian-advanced-metadata-cache)

Some of the questions [Obsidian](https://obsidian.md/) answers about a vault have no index behind them. Asking which notes link to this one means scanning every note, on every call — the Backlinks pane pays that cost, and so does every plugin that asks the same question. On a large vault it is slow enough to be felt.

This plugin maintains the indexes those questions deserve and answers from them instead. It does so by replacing the method that already asks the question, so nothing has to know the plugin is installed: the Backlinks pane gets faster, and so does anything else that asks.

Each index is a **module** that is switched on or off on its own, so a vault only pays for the ones it uses. On a small vault you will not notice any of them; that is the point at which you do not need this.

## Demo vault

**The documentation is an interactive demo vault.** Every feature has a note that explains what it does and why you would want it, with buttons that measure the difference for real.

**[Start reading here](<./demo-vault/00 Start.md>)** — it is plain markdown, so it works on GitHub with nothing installed.

A copy of the vault ships with every release. You can access it via any of the following:

1. Running the **Advanced Metadata Cache: Open demo vault** command.
2. Downloading `advanced-metadata-cache-demo-vault.zip` from the [Releases](https://github.com/mnaoumov/obsidian-advanced-metadata-cache/releases). It unzips into a single `advanced-metadata-cache-demo-vault-<version>` folder.
3. Browsing its source in [`demo-vault/`](./demo-vault/README.md) in this repository.

## What it does

- **A backlink index that keeps itself current**, so the Backlinks pane and every plugin that asks for backlinks stop rescanning the vault. [01 Backlink cache](<./demo-vault/01 Backlink cache.md>)
- **Three ways to ask** — fast from the cache, safe after pending changes settle, or the original built-in implementation for comparison. [02 Fast, safe, and original backlinks](<./demo-vault/02 Fast, safe, and original backlinks.md>)
- **Canvas files are indexed too**, and their links are exposed through `getCache()`, which is otherwise left empty for canvas files. [03 Canvas backlinks](<./demo-vault/03 Canvas backlinks.md>)
- **Frontmatter markdown links count as backlinks** when the [`Frontmatter Markdown Links`](https://community.obsidian.md/plugins/frontmatter-markdown-links) plugin is installed. [03 Canvas backlinks](<./demo-vault/03 Canvas backlinks.md>)
- **Every index is a module of its own**, switched on or off without touching the others, and refresh behavior is configurable. [04 Settings](<./demo-vault/04 Settings.md>)

## Modules

| Module    | What it indexes                                                | Default |
|-----------|----------------------------------------------------------------|---------|
| Backlinks | Which notes link to a note, answering `getBacklinksForFile()`. | On      |

Switching a module off unloads it completely — its index, its listeners and the commands it registers all go with it, and the built-in implementation answers again. Switching one back on rebuilds its index from scratch.

## For plugin developers

This plugin replaces `app.metadataCache.getBacklinksForFile()` with a faster implementation, adds an overload accepting a vault `path` as well as a `TFile`, and keeps the original reachable:

```js
const fast = app.metadataCache.getBacklinksForFile(pathOrFile);
const safe = await app.metadataCache.getBacklinksForFile.safe(pathOrFile);
const original = app.metadataCache.getBacklinksForFile.originalFn(file);
```

All three members arrived in 1.0.0, and all three are present only while the **Backlinks** module is on — a consumer that cannot assume it is should fall back to the built-in signature rather than assume the widened one.

To use the updated signatures from your own plugin, copy [types.d.ts](./types.d.ts) into your code. [02 Fast, safe, and original backlinks](<./demo-vault/02 Fast, safe, and original backlinks.md>) runs all three side by side.

## Installation

The plugin is not yet listed in [the official Community Plugins repository](https://community.obsidian.md/plugins). Until it is, install it as a beta release.

### Beta versions

To install the latest beta release of this plugin (regardless if it is available in [the official Community Plugins repository](https://community.obsidian.md) or not), follow these steps:

1. Ensure you have the [BRAT plugin](https://community.obsidian.md/plugins/obsidian42-brat) installed and enabled.
2. Click [Install via BRAT](https://intradeus.github.io/http-protocol-redirector?r=obsidian://brat?plugin=https://github.com/mnaoumov/obsidian-advanced-metadata-cache).
3. An Obsidian pop-up window should appear. In the window, click the `Add plugin` button once and wait a few seconds for the plugin to install.

## Debugging

By default, debug messages for this plugin are hidden.

To show them, run the following command in the `DevTools Console`:

```js
window.DEBUG.enable('advanced-metadata-cache');
```

For more details, refer to the [documentation](https://mnaoumov.dev/obsidian-dev-utils/guides/debugging/).

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
