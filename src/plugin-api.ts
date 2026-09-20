/**
 * @file
 *
 * The runtime half of this plugin's published contract: the registry contract and its version.
 *
 * The TYPES are not declared here. They live in the repo-root `api.d.ts`, which is the file a consumer
 * reads, and are re-exported from it so there is exactly one declaration of each and nothing to drift.
 */

import type { PluginApiContract } from 'obsidian-dev-utils/obsidian/plugin/plugin-api';

export type { AdvancedMetadataCacheApi } from '../api.d.ts';

/**
 * The contract this plugin publishes. It declares the method names; a consumer that wants schema
 * validation at the boundary supplies its own contract to `watchPluginApi`, and the consumer's wins.
 */
export const PLUGIN_API_CONTRACT: PluginApiContract = {
  getTitlePropertyNames: {},
  getTitles: {}
};

/**
 * The version of the contract above — independent of the plugin's own version, so a consumer asks for
 * `'^1'` and keeps working across releases that change nothing it depends on.
 *
 * `1.0.0` is the `Titles` module's pair of reads, the first answer this plugin publishes that Obsidian
 * has no method of its own for. The two older modules widen a core method instead and are declared in
 * `types.d.ts`; they are deliberately not mirrored here, because a consumer of those calls core.
 */
export const PLUGIN_API_VERSION = '1.0.0';
