import type { GeneratePerformanceVaultOptions } from '@mnaoumov/obsidian-dev-toolkit/test-runners/performance-vault';

export {
  PERFORMANCE_VAULT_DELETE_FOLDER_A,
  PERFORMANCE_VAULT_DELETE_FOLDER_B,
  PERFORMANCE_VAULT_DELETE_TARGET,
  PERFORMANCE_VAULT_FILLER_FOLDER,
  PERFORMANCE_VAULT_LINKER_FOLDER,
  PERFORMANCE_VAULT_MENTION_FOLDER,
  PERFORMANCE_VAULT_TARGET
} from '@mnaoumov/obsidian-dev-toolkit/test-runners/performance-vault';

/**
Number of linker fixtures asserted by AMC's performance suites.
*/
export const PERFORMANCE_VAULT_LINKER_COUNT = 50;
const DEFAULT_DELETE_COUNT = 1000;
const DEFAULT_FILLER_COUNT = 90_000;
const MENTION_INTERVAL = 25;
/**
Number of notes in each deletion scenario.
*/
export const PERFORMANCE_VAULT_DELETE_COUNT = Number(process.env['BC_PERF_DELETE_COUNT']) || DEFAULT_DELETE_COUNT;
const FILLER_COUNT = Number(process.env['BC_PERF_VAULT_SIZE']) || DEFAULT_FILLER_COUNT;
const MENTION_COUNT = 1000;
const TARGET_COUNT = 2;
const DELETION_FOLDER_COUNT = 2;
/**
Exact corpus size, including AMC's scenario fixtures.
*/
export const PERFORMANCE_VAULT_FILE_COUNT = FILLER_COUNT + PERFORMANCE_VAULT_LINKER_COUNT + MENTION_COUNT + DELETION_FOLDER_COUNT * PERFORMANCE_VAULT_DELETE_COUNT + TARGET_COUNT;
const BYTES_PER_NOTE = 1200;
/**
 * AMC scenario dimensions for the shared generator. Filler count retains the historical environment variable's
 * meaning. Filler now holds deterministic synthetic prose, so timings require a new baseline.
 */
export const PERFORMANCE_VAULT_OPTIONS: GeneratePerformanceVaultOptions = {
  cyrillicShare: 0,
  deletionCount: PERFORMANCE_VAULT_DELETE_COUNT,
  linkerCount: PERFORMANCE_VAULT_LINKER_COUNT,
  mentionCount: MENTION_COUNT,
  mentionInterval: MENTION_INTERVAL,
  noteCount: PERFORMANCE_VAULT_FILE_COUNT,
  totalBytes: PERFORMANCE_VAULT_FILE_COUNT * BYTES_PER_NOTE
};
