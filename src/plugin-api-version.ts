/**
 * The version of the contract in `plugin-api.ts` — independent of the plugin's own version, so a consumer asks for
 * `'^1'` and keeps working across releases that change nothing it depends on.
 *
 * `1.0.0` is the `Titles` module's pair of reads, the first answer this plugin publishes that Obsidian
 * has no method of its own for. `1.1.0` adds `migrateSettings`, purely additively, so a plugin handing
 * its title property over asks for `'^1'` with a contract naming that member, and against `1.0.0` its
 * offer simply waits. `1.2.0` adds `getHeadingTimes`, as additively: the `Headings` module's answer,
 * which `Advanced Note Composer` sorts headings by. `1.3.0` adds what the `Backlinks` and `Names` modules
 * offer beyond the core method each replaces — the `Safe` and `Original` variants and the reverse name
 * lookup — which until then were grafted onto the patched core methods themselves. A consumer that asks
 * for `'^1.3.0'` with a contract naming them finds the module through the registry instead of by probing
 * an Obsidian function for members Obsidian never declared. `1.4.0` adds the `Properties` module, as
 * additively: `registerPropertyName` and the four lookups of notes by a frontmatter property and its value,
 * which `Permanent Links` resolves its keys with.
 */
export const PLUGIN_API_VERSION = '1.4.0';
