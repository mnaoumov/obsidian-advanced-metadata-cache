import { waitForPerformanceVaultScan as waitForScan } from '@mnaoumov/obsidian-dev-toolkit/test-runners/performance-vault-scan';
import { readdirSync } from 'node:fs';
import {
  join,
  relative,
  sep
} from 'node:path';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';

import { PERFORMANCE_VAULT_LINKER_FOLDER } from './generate-performance-vault.ts';

/**
 * Waits for the on-disk corpus and settled metadata before AMC's measurements.
 *
 * @returns Completion of consecutive fully ready polls.
 */
export async function waitForPerformanceVaultScan(): Promise<void> {
  const vaultPath = getTemporaryVault().path;
  // Suites delete fixtures and AMC creates shared journals, so use the current visible disk manifest.
  const expectedFileCount = readdirSync(vaultPath, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && relative(vaultPath, join(entry.parentPath, entry.name)).split(sep).every((part) => !part.startsWith('.'))).length;
  await waitForScan({
    cachePath: `${PERFORMANCE_VAULT_LINKER_FOLDER}/link-0.md`,
    expectedFileCount,
    vaultPath
  });
}
