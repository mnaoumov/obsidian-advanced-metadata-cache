# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code
in this repository.

## Every index is a module, and a module is a component

`src/modules/` holds one folder per index. Each is declared to `ModulesComponent`
(`src/modules/modules-component.ts`) as a `ModuleDefinition`: how to build its component, and which
`PluginSettings` toggle decides whether it runs. `ModulesComponent` adds the component as a child when
the toggle goes on and removes it when it goes off, live, off the settings component's `saveSettings`
event — so a module's whole footprint (its index, its listeners, its patches, its commands) is tied to
one component's lifecycle and nothing survives it being switched off.

That is why a module registers its own commands rather than letting the plugin do it: see
`BacklinksModuleComponent`, which passes itself as the `lifetimeOwner`. A command registered by the
plugin would stay in the palette calling into a torn-down index.

Adding a module means adding its folder, its toggle to `PluginSettings`, its row to
`getSettingDefinitionItems`, and one entry to the array in `Plugin.onloadImpl`. Nothing else knows how
many modules there are. The `backlinks` module defaults **on**, because it is the behavior this plugin
inherited wholesale from Backlink Cache; a module added later defaults **off**.

## Invariant: a self-link is never indexed as a re-resolution source

`BacklinkCacheComponent.refreshBacklinks` records a self-link as a **backlink** (so the panel shows it)
but deliberately skips adding it to `resolvedBasenameMap`.

`resolvedBasenameMap` answers "when a file with this basename changes, which notes must be re-resolved?".
Including the changed note itself is vacuous — whatever produced the change already resolved it — and it
is actively harmful here, because this plugin **replaces** `metadataCache.updateRelatedLinks` rather than
calling through. A self-entry makes that replacement queue the note for re-resolution in response to its
own change, which fires `changed`, which refreshes its backlinks, which queues it again. That feedback
cycle is Backlink Cache issue #17: a note with 72 self-links stalled the editor for 20-30 seconds. Each
pass is linear in the self-link count, so the cost is the number of passes, not a quadratic per pass.

This is the **one deliberate departure** from the original Obsidian algorithm. The differential-parity
oracle in `src/modules/backlinks/backlink-cache-component.test.ts` models the original faithfully, and
the original *would* queue the note; a dedicated test in that suite pins the divergence so the parity
claim stays honest. Queuing strictly less is safe.

Before changing anything in this area, read that parity suite — its cases encode which behaviors are
guaranteed to match Obsidian exactly.
