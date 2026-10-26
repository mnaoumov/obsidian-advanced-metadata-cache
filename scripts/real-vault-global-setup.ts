import type { PopulateFilesParams } from 'obsidian-integration-testing';

import {
  readdir,
  readFile
} from 'node:fs/promises';
import {
  join,
  relative
} from 'node:path';
import process from 'node:process';
import { createSetup } from 'obsidian-integration-testing/vitest-global-setup-plugin';

/**
 * The environment variable naming the vault to copy. There is no default: the project measures what a real vault's
 * notes cost, and no vault in this repository has real notes in it.
 */
export const REAL_VAULT_PATH_ENV = 'AMC_REAL_VAULT_PATH';

/*
 * Copies every markdown note of the vault named by `AMC_REAL_VAULT_PATH` into the temporary vault before Obsidian
 * opens it. Only notes: the source vault's `.obsidian` would bring its own plugins along, and its attachments cost the
 * `Unlinked mentions` build nothing. Used by `integration-tests:real-vault`.
 */
async function populate(): Promise<PopulateFilesParams> {
  const sourcePath = process.env[REAL_VAULT_PATH_ENV];
  if (!sourcePath) {
    throw new Error(`Set ${REAL_VAULT_PATH_ENV} to the vault to measure; this project copies its notes.`);
  }

  const files: PopulateFilesParams = {};
  const entries = await readdir(sourcePath, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }

    const fullPath = join(entry.parentPath, entry.name);
    const path = relative(sourcePath, fullPath).replaceAll('\\', '/');
    if (path.split('/').some((segment) => segment.startsWith('.'))) {
      continue;
    }

    files[path] = await readFile(fullPath, 'utf-8');
  }

  return files;
}

const { setup, teardown } = createSetup({ populate });

export {
  setup,
  teardown
};
