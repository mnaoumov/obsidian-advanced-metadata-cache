# Storage and sync

The unlinked-mention and property-value caches live in **IndexedDB on each device, outside the vault**. Databases are scoped by Obsidian's local vault identity and this plugin's id. Copying a vault does not copy these caches. Each checkpoint commits changed records and removals together; it does not rewrite a JSON cache file in the vault. The existing startup validation and `Safe` API readiness guarantees still apply.

**Heading history and registered property names are authoritative state.** They sync as ordinary Markdown files under `Plugin data/advanced-metadata-cache/`. Obsidian Sync and folder-based sync tools can carry them. Each device owns its own journal files, and records are periodically compacted into bounded snapshots. Files stay below the shared store's 1,000,000-byte default limit. Account storage limits still apply.

Add `Plugin data/advanced-metadata-cache/` to Obsidian's **Excluded files** if these transport documents should stay out of search and the quick switcher. The plugin excludes its own transport from heading tracking and unlinked-mention results. It does not change your vault-wide exclusions. Keep this folder in backups: unlike derived caches, heading history cannot be rebuilt from notes.

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
