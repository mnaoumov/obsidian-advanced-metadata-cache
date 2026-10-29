/**
 * @file
 *
 * The runtime half of this plugin's published contract: the registry contract. Its version is in
 * `plugin-api-version.ts`, which imports nothing, so a suite running outside Obsidian can read it.
 *
 * The TYPES are not declared here. They live in the repo-root `api.d.ts`, which is the file a consumer
 * reads — the whole of this plugin's public surface — and are re-exported from it so there is exactly one declaration of each and nothing to
 * drift.
 */

import type { ApiContract } from '@mnaoumov/typescript-lib/api-contract';

import { ADVANCED_METADATA_CACHE_API_CONTRACT } from '../api-contract.ts';

export type {
  AdvancedMetadataCacheApi,
  AdvancedMetadataCacheMigratableSettings,
  DatedValue,
  DatedValuesQuery,
  HeadingTimes,
  LinkText,
  LinkTextsChangedCallback,
  MigrateSettingsParams,
  MigrateSettingsResult,
  UnlinkedMention,
  UnlinkedMentionRange
} from '../api.d.ts';

/**
 * The contract this plugin publishes: the repo-root `api-contract.ts` constant a consumer copies, so the
 * provider and its consumers validate against one definition. Assigning it here is also what checks
 * that the hand-written schemas are Standard Schemas the registry accepts.
 */
export const PLUGIN_API_CONTRACT: ApiContract = ADVANCED_METADATA_CACHE_API_CONTRACT;
