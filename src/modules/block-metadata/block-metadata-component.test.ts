import type { App as AppOriginal } from 'obsidian';
import type { TFile } from 'obsidian-test-mocks/obsidian';

import { setTimeoutAsync } from '@mnaoumov/typescript-lib/async';
import { noop } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { waitForAllAsyncOperations } from '@mnaoumov/typescript-test-toolkit/async-operation-tracking';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { BlockMetadataIndex } from './block-metadata-index.ts';

const hoisted = vi.hoisted(() => ({
  ensureMetadataCacheReady: vi.fn<() => Promise<void>>(async () => {
    // Ready at once unless a test says otherwise.
  })
}));

vi.mock('@mnaoumov/obsidian-lib/metadata-cache', async (importOriginal) => ({
  ...await importOriginal<typeof import('@mnaoumov/obsidian-lib/metadata-cache')>(),
  ensureMetadataCacheReady: hoisted.ensureMetadataCacheReady
}));

/* eslint-disable import-x/first, import-x/imports-first -- vi.mock must precede imports. */
import { BlockMetadataComponent } from './block-metadata-component.ts';
/* eslint-enable import-x/first, import-x/imports-first -- End of the mocked imports. */

const NOTE = '# Tasks\n\n```advanced-metadata-cache\nstatus: done\n```\n\nBody\n';
const OTHER_NOTE = '# Tasks\n\n```advanced-metadata-cache\nstatus: open\n```\n';

describe('BlockMetadataComponent', () => {
  let app: App;
  let blockMetadataIndex: BlockMetadataIndex;
  let component: BlockMetadataComponent;

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    blockMetadataIndex = new BlockMetadataIndex();
    component = new BlockMetadataComponent({ app: castTo<AppOriginal>(app), blockMetadataIndex });
  });

  it('should build from the notes holding code sections, and tell listeners once it is built', async () => {
    createFile('Alpha.md', NOTE);
    createFile('Bravo.md', 'No code here');
    const listener = vi.fn();
    blockMetadataIndex.onChange(listener);

    await load();

    expect(component.isBuilt).toBe(true);
    expect(getStatusPaths()).toEqual(['Alpha.md']);
    expect(blockMetadataIndex.getBlockMetadata('Alpha.md')[0]?.target).toMatchObject({ heading: 'Tasks', level: 1, type: 'heading' });
    expect(listener).toHaveBeenLastCalledWith(null);
  });

  it('should wait for the metadata cache before building, and let a caller wait for the build', async () => {
    createFile('Alpha.md', NOTE);
    let resolveReady: () => void = noop;
    hoisted.ensureMetadataCacheReady.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
    });

    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);

    expect(component.isBuilt).toBe(false);

    const waitPromise = component.waitForBuild();
    resolveReady();
    await waitPromise;

    expect(getStatusPaths()).toEqual(['Alpha.md']);
  });

  it('should re-read a note Obsidian parsed again', async () => {
    const alpha = createFile('Alpha.md', NOTE);
    await load();

    await app.vault.modify(alpha, OTHER_NOTE);

    expect(blockMetadataIndex.getBlockMetadataWithProperty('status', 'open').map((match) => match.path)).toEqual(['Alpha.md']);
    expect(blockMetadataIndex.getBlockMetadataWithProperty('status', 'done')).toEqual([]);
  });

  it('should drop a deleted note, and move a renamed one', async () => {
    const alpha = createFile('Alpha.md', NOTE);
    const bravo = createFile('Bravo.md', NOTE);
    await load();

    await app.fileManager.trashFile(alpha);
    await app.vault.rename(bravo, 'Renamed.md');

    expect(getStatusPaths()).toEqual(['Renamed.md']);
  });

  it('should move the notes of a renamed folder', async () => {
    await app.vault.createFolder('Folder');
    createFile('Folder/Alpha.md', NOTE);
    await load();

    const folder = app.vault.getFolderByPath('Folder');
    if (folder) {
      await app.vault.rename(folder, 'Moved');
    }

    expect(getStatusPaths()).toEqual(['Moved/Alpha.md']);
  });

  it('should drop a note renamed away from a note or into the plugin\'s own data folder', async () => {
    const alpha = createFile('Alpha.md', NOTE);
    const bravo = createFile('Bravo.md', NOTE);
    await app.vault.createFolder('Plugin data/advanced-metadata-cache');
    await load();

    await app.vault.rename(alpha, 'Alpha.txt');
    await app.vault.rename(bravo, 'Plugin data/advanced-metadata-cache/Bravo.md');

    expect(getStatusPaths()).toEqual([]);
  });

  it('should ignore the plugin\'s own data notes and a changed file that is no note', async () => {
    createFile('Plugin data/advanced-metadata-cache/journal.md', NOTE);
    const text = createFile('Alpha.txt', NOTE);
    await load();

    app.metadataCache.trigger('changed', text, NOTE, {});

    expect(getStatusPaths()).toEqual([]);
  });

  it('should skip a note whose cache changed while it was being read', async () => {
    const alpha = createFile('Alpha.md', NOTE);
    const cachedRead = app.vault.cachedRead.bind(app.vault);
    vi.spyOn(app.vault, 'cachedRead').mockImplementationOnce(async (file) => {
      const data = await cachedRead(file);
      app.metadataCache.cache__.set(alpha.path, {});
      return data;
    });

    await load();

    expect(getStatusPaths()).toEqual([]);
    expect(component.isBuilt).toBe(true);
  });

  it('should stop building when switched off during a read', async () => {
    createFile('Alpha.md', NOTE);
    const cachedRead = app.vault.cachedRead.bind(app.vault);
    vi.spyOn(app.vault, 'cachedRead').mockImplementationOnce(async (file) => {
      component.unload();
      return await cachedRead(file);
    });

    await load();

    expect(component.isBuilt).toBe(false);
    expect(getStatusPaths()).toEqual([]);
  });

  it('should clear the index and release waiters when switched off', async () => {
    createFile('Alpha.md', NOTE);
    await load();

    component.unload();
    await component.waitForBuild();

    expect(getStatusPaths()).toEqual([]);
  });

  it('should not build when switched off while waiting for the metadata cache', async () => {
    createFile('Alpha.md', NOTE);
    let resolveReady: () => void = noop;
    hoisted.ensureMetadataCacheReady.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
    });

    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);
    component.unload();
    resolveReady();
    await waitForAllAsyncOperations();

    expect(component.isBuilt).toBe(false);
    expect(getStatusPaths()).toEqual([]);
  });

  function createFile(path: string, content: string): TFile {
    return app.vault.createSync__(path, content);
  }

  function getStatusPaths(): string[] {
    return blockMetadataIndex.getBlockMetadataWithProperty('status').map((match) => match.path);
  }

  async function load(): Promise<void> {
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);
    await waitForAllAsyncOperations();
  }
});
