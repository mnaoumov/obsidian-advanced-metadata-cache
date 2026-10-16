import { defineEslintConfigs } from 'obsidian-dev-utils/script-utils/linters/eslint-config';

export const configs = defineEslintConfigs({
  editContext(context) {
    // The published contract sits at the repo root beside `api.d.ts`, so a consumer can copy it; lint it as source.
    context.sourceFiles.push('api-contract.ts');
  }
});
