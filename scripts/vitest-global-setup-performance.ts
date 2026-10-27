import { createPerformanceVaultSetup } from '@mnaoumov/obsidian-dev-toolkit/test-runners/performance-vault-setup';

import { PERFORMANCE_VAULT_OPTIONS } from './helpers/generate-performance-vault.ts';

/**
Populates the generated corpus before Obsidian opens it.
*/
export const { setup, teardown } = await createPerformanceVaultSetup(PERFORMANCE_VAULT_OPTIONS);
