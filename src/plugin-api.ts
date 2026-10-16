/**
 * @file
 *
 * The runtime half of this plugin's published contract: the registry contract and its version.
 *
 * The TYPES are not declared here. They live in the repo-root `api.d.ts`, which is the file a consumer
 * reads — the whole of this plugin's public surface, both this registry API and the two replaced core
 * methods — and are re-exported from it so there is exactly one declaration of each and nothing to
 * drift.
 */

import type { PluginApiContract } from 'obsidian-dev-utils/obsidian/plugin/plugin-api';

export type {
  AdvancedMetadataCacheApi,
  AdvancedMetadataCacheMigratableSettings,
  HeadingTimes,
  MigrateSettingsParams,
  MigrateSettingsResult
} from '../api.d.ts';

/**
 * The contract this plugin publishes. It declares the method names; a consumer that wants schema
 * validation at the boundary supplies its own contract to `watchPluginApi`, and the consumer's wins.
 */
export const PLUGIN_API_CONTRACT: PluginApiContract = {
  getBacklinksForFile: {},
  getBacklinksForFileOriginal: {},
  getBacklinksForFileSafe: {},
  getHeadingTimes: {},
  getLinkSuggestions: {},
  getLinkSuggestionsOriginal: {},
  getLinkSuggestionsSafe: {},
  getPathsByName: {},
  getPathsByNameSafe: {},
  getTitlePropertyNames: {},
  getTitles: {},
  migrateSettings: {}
};

/**
 * The version of the contract above — independent of the plugin's own version, so a consumer asks for
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
 * an Obsidian function for members Obsidian never declared.
 */
export const PLUGIN_API_VERSION = '1.3.0';
