import type { App as AppOriginal } from 'obsidian';
import type { MockInstance } from 'vitest';

import { ensureMetadataCacheReady } from '@mnaoumov/obsidian-lib/metadata-cache';
import { setTimeoutAsync } from '@mnaoumov/typescript-lib/async';
import { noop } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { waitForAllAsyncOperations } from '@mnaoumov/typescript-test-toolkit/async-operation-tracking';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

vi.mock('@mnaoumov/obsidian-lib/metadata-cache', async (importOriginal) => ({
  ...await importOriginal<typeof import('@mnaoumov/obsidian-lib/metadata-cache')>(),
  ensureMetadataCacheReady: vi.fn(async () => {
    // Ready at once.
  })
}));

/* eslint-disable import-x/first, import-x/imports-first -- vi.mock must precede imports. */
import {
  STARTUP_BATCH_SIZE,
  UnparsedFrontmatterReporterComponent
} from './unparsed-frontmatter-reporter-component.ts';
/* eslint-enable import-x/first, import-x/imports-first -- End of the mocked imports. */

const BROKEN = '---\ntitle: 759/21777/26\nctime: 1\nctime: 2\n---\n# Case\n';
const BROKEN_DIFFERENTLY = '---\ntitle: 759/21777/26\naliases: [a\n---\n# Case\n';
const FIXED = '---\ntitle: 759/21777/26\nctime: 1\n---\n# Case\n';

describe('UnparsedFrontmatterReporterComponent', () => {
  let app: App;
  let component: UnparsedFrontmatterReporterComponent;
  let warn: MockInstance<Console['warn']>;

  beforeEach(() => {
    app = App.createConfigured__();
    component = new UnparsedFrontmatterReporterComponent({ app: castTo<AppOriginal>(app) });
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      // Asserted on, not printed.
    });
  });

  afterEach(() => {
    component.unload();
    warn.mockRestore();
  });

  it('should report at startup every note whose frontmatter does not parse, and no other', async () => {
    app.vault.createSync__('Case.md', BROKEN);
    app.vault.createSync__('Fine.md', FIXED);
    app.vault.createSync__('Empty.md', '---\n---\nBody');
    app.vault.createSync__('Plain.md', 'No frontmatter');

    await load();

    expect(getReportedPaths()).toEqual(['Case.md']);
    expect(warn.mock.calls[0]?.[1]).toEqual(expect.any(String));
  });

  it('should report once per error, and again only after the error changed or the note was fixed', async () => {
    const file = app.vault.createSync__('Case.md', BROKEN);
    await load();

    await app.vault.modify(file, `${BROKEN}More\n`);
    await settle();
    expect(getReportedPaths()).toEqual(['Case.md']);

    await app.vault.modify(file, BROKEN_DIFFERENTLY);
    await settle();
    expect(getReportedPaths()).toEqual(['Case.md', 'Case.md']);

    await app.vault.modify(file, FIXED);
    await settle();
    await app.vault.modify(file, BROKEN);
    await settle();
    expect(getReportedPaths()).toEqual(['Case.md', 'Case.md', 'Case.md']);
  });

  it('should report a note that breaks after startup', async () => {
    const file = app.vault.createSync__('Case.md', FIXED);
    await load();
    expect(getReportedPaths()).toEqual([]);

    await app.vault.modify(file, BROKEN);
    await settle();

    expect(getReportedPaths()).toEqual(['Case.md']);
  });

  it('should report nothing once unloaded', async () => {
    const file = app.vault.createSync__('Case.md', FIXED);
    await load();
    component.unload();

    await app.vault.modify(file, BROKEN);
    await settle();

    expect(getReportedPaths()).toEqual([]);
  });

  it('should not report a note in the plugin\'s own data folder', async () => {
    app.vault.createFolderSync__('Plugin data/advanced-metadata-cache');
    app.vault.createSync__('Plugin data/advanced-metadata-cache/Journal.md', BROKEN);

    await load();

    expect(getReportedPaths()).toEqual([]);
  });

  it('should check every note when the vault holds more than one startup batch', async () => {
    for (let index = 0; index < STARTUP_BATCH_SIZE; index++) {
      app.vault.createSync__(`Fine ${String(index)}.md`, FIXED);
    }
    app.vault.createSync__('Case.md', BROKEN);

    await load();

    expect(getReportedPaths()).toEqual(['Case.md']);
  });

  it('should report a note again when another note with the same error takes a deleted note\'s path', async () => {
    const file = app.vault.createSync__('Case.md', BROKEN);
    await load();

    await app.fileManager.trashFile(file);
    await settle();
    const recreated = await app.vault.create('Case.md', BROKEN);
    await settle();

    expect(recreated.path).toBe('Case.md');
    expect(getReportedPaths()).toEqual(['Case.md', 'Case.md']);
  });

  it('should report a note again when another note with the same error takes a renamed note\'s path', async () => {
    const file = app.vault.createSync__('Case.md', BROKEN);
    await load();

    await app.vault.rename(file, 'Moved.md');
    await settle();
    await app.vault.create('Case.md', BROKEN);
    await settle();

    expect(getReportedPaths().filter((path) => path === 'Case.md')).toHaveLength(2);
  });

  it('should forget only the notes inside a renamed folder', async () => {
    app.vault.createFolderSync__('Folder');
    app.vault.createSync__('Folder/Inside.md', BROKEN);
    const outside = app.vault.createSync__('Outside.md', BROKEN);
    await load();

    await app.vault.rename(ensureNonNullable(app.vault.getFolderByPath('Folder')), 'Moved');
    await settle();
    await app.vault.createFolder('Folder');
    await app.vault.create('Folder/Inside.md', BROKEN);
    await app.vault.modify(outside, `${BROKEN}More\n`);
    await settle();

    expect(getReportedPaths().filter((path) => path === 'Folder/Inside.md')).toHaveLength(2);
    expect(getReportedPaths().filter((path) => path === 'Outside.md')).toHaveLength(1);
  });

  it('should stop the startup check when unloaded while the metadata cache gets ready', async () => {
    let resolveReady: () => void = noop;
    vi.mocked(ensureMetadataCacheReady).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
    });
    app.vault.createSync__('Case.md', BROKEN);

    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);
    component.unload();
    resolveReady();
    await settle();

    expect(getReportedPaths()).toEqual([]);
  });

  it('should stop the startup check when unloaded while a note is read', async () => {
    app.vault.createSync__('Case.md', BROKEN);
    app.vault.createSync__('Other.md', BROKEN);
    const cachedRead = app.vault.cachedRead.bind(app.vault);
    vi.spyOn(app.vault, 'cachedRead').mockImplementation(async (file) => {
      component.unload();
      return cachedRead(file);
    });

    await load();

    expect(getReportedPaths()).toEqual([]);
  });

  it('should stop the startup check when unloaded between batches', async () => {
    for (let index = 0; index < STARTUP_BATCH_SIZE - 1; index++) {
      app.vault.createSync__(`Fine ${String(index)}.md`, FIXED);
    }
    app.vault.createSync__('Case.md', BROKEN);
    app.vault.createSync__('Later.md', BROKEN);
    const cachedRead = app.vault.cachedRead.bind(app.vault);
    vi.spyOn(app.vault, 'cachedRead').mockImplementation(async (file) => {
      window.setTimeout(() => {
        component.unload();
      }, 0);
      return cachedRead(file);
    });

    await load();

    expect(getReportedPaths()).toEqual(['Case.md']);
  });

  it('should not report from a read that a newer parse overtook', async () => {
    const file = app.vault.createSync__('Case.md', BROKEN);
    const cachedRead = app.vault.cachedRead.bind(app.vault);
    const getFileCache = app.metadataCache.getFileCache.bind(app.metadataCache);
    vi.spyOn(app.vault, 'cachedRead').mockImplementation(async (readFile) => {
      vi.spyOn(app.metadataCache, 'getFileCache').mockImplementation((cachedFile) => {
        const cache = getFileCache(cachedFile);
        return cache ? { ...cache } : cache;
      });
      return cachedRead(readFile);
    });

    await load();

    expect(file.path).toBe('Case.md');
    expect(getReportedPaths()).toEqual([]);
  });

  function getReportedPaths(): string[] {
    return warn.mock.calls.map((call) => /"(?<path>[^"]+)"/.exec(String(call[0]))?.groups?.['path'] ?? '');
  }

  async function load(): Promise<void> {
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await settle();
  }

  async function settle(): Promise<void> {
    await setTimeoutAsync(0);
    await waitForAllAsyncOperations();
  }
});
