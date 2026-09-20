import { pollInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';

import { PERFORMANCE_VAULT_LINKER_FOLDER } from './generate-performance-vault.ts';

/**
 * A known note in the generated performance vault. The metadata cache answering for it is the
 * signal that the startup scan has got past merely listing files.
 */
const WITH_CACHE_PATH = `${PERFORMANCE_VAULT_LINKER_FOLDER}/link-0.md`;

/*
 * The scan is waited for in NODE rather than inside one `evalInObsidian` closure: a multi-minute
 * wait declared inside a single `Runtime.evaluate` is past the transport's per-command cap however
 * generous the project's own budget is, so it could only ever die as a bare `script timeout` naming
 * nothing. Each poll here is a separate, very short eval; the long budget lives on this side.
 */
const INDEX_WAIT_IN_MS = 240_000;
const INDEX_POLL_IN_MS = 2000;

/**
 * How many consecutive polls must report an unchanged file count before the vault is taken to be
 * fully scanned. The exact file count is not known here — the generator sizes it from
 * `BC_PERF_VAULT_SIZE` — so stability is the only honest readiness signal.
 */
const STABLE_POLLS_REQUIRED = 3;

/**
 * What a readiness poll reads out of the running vault.
 */
interface VaultScanStatus {
  readonly fileCount: number;
  readonly isCacheReady: boolean;
}

/**
 * Waits, from Node, until the performance vault's startup scan has settled.
 *
 * Shared by every performance suite that measures against the generated vault: a measurement taken
 * while Obsidian is still indexing measures the indexing.
 *
 * @returns A {@link Promise} that resolves once the file count has stopped moving and the metadata
 *   cache can answer for a known note.
 */
export async function waitForPerformanceVaultScan(): Promise<void> {
  let previousFileCount = -1;
  let stablePolls = 0;

  await pollInObsidian({
    input: { WITH_CACHE_PATH },
    intervalInMilliseconds: INDEX_POLL_IN_MS,
    poll({
      app,
      WITH_CACHE_PATH: withCachePath
    }): VaultScanStatus {
      return {
        fileCount: app.vault.getFiles().length,
        isCacheReady: !!app.metadataCache.getCache(withCachePath)
      };
    },
    timeoutInMilliseconds: INDEX_WAIT_IN_MS,
    timeoutMessage: 'the performance vault to finish its startup scan',
    until(status: VaultScanStatus): boolean {
      stablePolls = status.fileCount > 0 && status.fileCount === previousFileCount ? stablePolls + 1 : 0;
      previousFileCount = status.fileCount;
      return stablePolls >= STABLE_POLLS_REQUIRED && status.isCacheReady;
    },
    vaultPath: getTemporaryVault().path
  });
}
