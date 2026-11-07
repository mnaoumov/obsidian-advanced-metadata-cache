# Storage and sync

The unlinked-mention, property-value, external-link and HTML-range caches live in **IndexedDB on each device, outside the vault**. Databases are scoped by Obsidian's local vault identity and this plugin's id. Copying a vault does not copy these caches. Each checkpoint commits changed records and removals together; it does not rewrite a JSON cache file in the vault. The existing startup validation and `Safe` API readiness guarantees still apply.

External-link records include each link's position and the note's observed modification time and size. On restart or switch-on, unchanged notes reuse those records; changed notes and missing or invalid records are read again. Notes with no links have records too. A same-size rewrite that preserves the modification time cannot be detected by this stat comparison. Clearing the local cache is safe: the next build reads the notes again.

HTML records include original source fragments and UTF-16 positions, with the same per-note stat validation. Runtime sanitizer diagnostics stay in memory and are rebuilt for the current Obsidian version. See [HTML range index](./html.md).

**Heading history and registered property names are authoritative state.** Each device keeps them in its own local replica, in IndexedDB. They reach the vault only on a device that turns on **Sync between devices** in the plugin's settings. Then they are written as ordinary Markdown files under the plugin data folder, in its `advanced-metadata-cache` subfolder, for Obsidian Sync or a folder-based sync tool to carry. Each device owns its own journal files, and records are periodically compacted into bounded snapshots. Files stay below the shared store's 1,000,000-byte default limit. Account storage limits still apply.

## Sync between devices

**Sync is a choice each device makes for itself, and it starts off.** A device that never turns it on creates no folder: its heading history and property registrations stay in its local storage, and nothing it does reaches another device. The choice is kept in the device's local storage, never in the synchronized settings, so a synced `data.json` cannot turn it on for a new device.

An upgrade from 2.4.0 or 2.5.0, which wrote to a visible `Plugin data/advanced-metadata-cache/` folder on every device, keeps sync on in one case only: the `Headings` module is on and the vault already holds heading journals there. Heading times are history that cannot be rebuilt from notes. Property names alone never turn it on, because consumers register them again on every start and the date properties are registered by the plugin itself. On every other device sync starts off, and the existing folder is left untouched. Once no device syncs, that folder may be deleted.

**Turning sync on** publishes this device's full state to the folder, and from then on it reads what the other devices wrote. Turn it on on every device that should share heading times. **Turning it off** stops this device writing to the vault and reading from it. It deletes nothing: the local replica keeps everything, and the files already in the vault stay for the devices that still sync.

**The folder** is `@Plugin sync data (DO NOT REMOVE)` for a fresh vault. Other plugins by the same author use the same folder, each in its own subfolder. A vault that already holds this plugin's history in `Plugin data` keeps using it. Whichever folder a device first synced to is its permanent discovery point. To put the data elsewhere, change **Plugin data folder** and press **Move**, on one device, while sync is on. The move copies the history, verifies it, then switches the writer. The old folder is kept as a reader for the devices that have not caught up, and every device follows the move on its own. Saving the setting alone moves nothing. A hidden folder (a segment that starts with `.`) is refused, because Obsidian Sync and most other tools skip it.

**While a device syncs**, the plugin adds each folder it uses to Obsidian's **Excluded files**, so the journals stay out of search, the graph and the quick switcher. It also writes a `README.md` into its own subfolder, and one into the shared folder if that has none yet. An entry the user had before is never taken over, and an entry the plugin added is removed when sync is turned off, unless another plugin still keeps a subfolder there. The plugin also skips its own transport in every index, wherever it lies. Keep the folder in backups: unlike derived caches, heading history cannot be rebuilt from notes.

## Heading history across devices

Every device retains its latest observed heading snapshot per tracked path. Matching uses the same text/body/neighbor rules as ordinary editing. Creation times merge by minimum; modification and seen times merge by maximum. Unknown times remain `null` unless another device observed the event. The newest parse supplies the document structure.

A rename carries history to its new path. An observed delete establishes an incarnation boundary; creating a new note at that path starts new history. A stale device's observations from the old incarnation cannot attach to the new note. Concurrent lifecycle events inherit wall-clock ordering and clock-skew limitations. Identical-heading swaps and delete-and-retype remain the heading matcher's documented ambiguities. Deletions and recreations while the module is off cannot always be distinguished from ordinary edits.

A missing file at startup does not delete shared history: a sync tool may deliver the journal before the note. Shared changes are merged after relevant transport changes, every 30 seconds while the module is active, and on window focus. Answers are eventually consistent with what the sync tool has delivered, rather than globally synchronous across devices.

## Migration and recovery

On first use of each module, the plugin imports its old `heading-times.json`, `property-values.json` or `unlinked-mentions.json` from the plugin folder. It removes that file only after the replacement has committed durably. A local import marker makes retries safe if removing the old file fails. Invalid legacy files are preserved and reported instead of being silently discarded.

Registered property names merge additively. Values remain local and are rebuilt from Obsidian's metadata cache, including after adopting another device's registration. Clearing browser/application data loses local caches and device identity; shared history remains recoverable from the vault journals. Removing the journals from every device and backup loses that authoritative history.

## Storage measurement

An isolated desktop run with 35,000 synthetic indexed-note records produced 15,008,104 bytes in 19 authoritative transport files; the largest was 999,978 bytes. The fixture contributes one heading, 20 mention keys and one property value per note. Serialized local records occupied 9,862,811 bytes for mentions and 2,648,945 bytes for property values, excluding IndexedDB physical overhead. No derived property value appeared in the synced files. These are fixture measurements, not estimates for every vault; heading counts and text lengths change the sizes.

Reproduce with `BC_PERF_VAULT_SIZE=1 BC_PERF_DELETE_COUNT=1 npx vitest run src/persistence/storage-size.desktop-performance.integration.test.ts --project integration-tests:desktop-performance --maxWorkers 1` (set those environment variables using your shell's syntax). The background vault is small; the test itself writes the 35,000-record storage fixture.
