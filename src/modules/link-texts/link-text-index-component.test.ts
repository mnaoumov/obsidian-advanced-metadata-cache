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

import { LinkTextIndex } from './link-text-index.ts';

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
import {
  BUILD_BATCH_SIZE,
  LinkTextIndexComponent
} from './link-text-index-component.ts';
/* eslint-enable import-x/first, import-x/imports-first -- End of the mocked imports. */

describe('LinkTextIndexComponent', () => {
  let app: App;
  let changes: (null | string[])[];
  let component: LinkTextIndexComponent;
  let index: LinkTextIndex;

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    index = new LinkTextIndex();
    changes = [];
    index.onChange((targetPaths) => {
      changes.push(targetPaths);
    });
    component = new LinkTextIndexComponent({ app: castTo<AppOriginal>(app), linkTextIndex: index });
  });

  it('should build from every note\'s cached links, embeds included, and say so once', async () => {
    createFile('Bravo.md', '');
    createFile('IMG_2231.jpg', '');
    createFile('Charlie.md', '[alpha](Bravo.md) [[Bravo|alpha]] [[Bravo]] [Bravo](Bravo.md) ![[IMG_2231.jpg|boarding pass]] [[Missing|x]]');

    await load();

    expect(component.isBuilt).toBe(true);
    expect(index.getLinkTexts('Bravo.md')).toEqual([{ count: 2, sourcePaths: ['Charlie.md'], text: 'alpha' }]);
    expect(index.getLinkTexts('IMG_2231.jpg')).toEqual([{ count: 1, sourcePaths: ['Charlie.md'], text: 'boarding pass' }]);
    expect(changes).toEqual([null]);
  });

  it('should wait for the metadata cache before building, and let a caller wait for the build', async () => {
    createFile('Bravo.md', '');
    createFile('Charlie.md', '[[Bravo|alpha]]');
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
    expect(index.getLinkTexts('Bravo.md')).toEqual([]);

    const waitPromise = component.waitForBuild();
    resolveReady();
    await waitPromise;

    expect(index.getLinkTexts('Bravo.md')).toHaveLength(1);
  });

  it('should re-read a note Obsidian resolved again, and report the targets it changed', async () => {
    createFile('Bravo.md', '');
    createFile('Delta.md', '');
    const charlie = createFile('Charlie.md', '[[Bravo|alpha]]');
    await load();
    changes = [];

    await app.vault.modify(charlie, '[[Delta|echo]]');
    app.metadataCache.trigger('resolve', charlie);
    app.metadataCache.trigger('resolve', charlie);

    expect(index.getLinkTexts('Bravo.md')).toEqual([]);
    expect(index.getLinkTexts('Delta.md')).toEqual([{ count: 1, sourcePaths: ['Charlie.md'], text: 'echo' }]);
    expect(changes).toEqual([['Bravo.md', 'Delta.md']]);
  });

  it('should drop the last reference when its source is deleted', async () => {
    createFile('Bravo.md', '');
    const charlie = createFile('Charlie.md', '[[Bravo|alpha]]');
    await load();
    changes = [];

    await app.fileManager.trashFile(charlie);

    expect(index.getLinkTexts('Bravo.md')).toEqual([]);
    expect(changes).toEqual([['Bravo.md']]);
  });

  it('should move a renamed source\'s texts to its new path', async () => {
    createFile('Bravo.md', '');
    const charlie = createFile('Charlie.md', '[[Bravo|alpha]]');
    await load();

    await app.vault.rename(charlie, 'Renamed.md');

    expect(index.getSourcePaths('Charlie.md', false)).toEqual([]);

    // Obsidian moves the cache with the note; the mock parses it again, and Obsidian resolves it again.
    await reparse('Renamed.md');

    expect(index.getLinkTexts('Bravo.md')).toEqual([{ count: 1, sourcePaths: ['Renamed.md'], text: 'alpha' }]);
  });

  it('should follow a renamed target while the links still resolve to it, and drop a deleted one', async () => {
    const bravo = createFile('Bravo.md', '');
    createFile('Charlie.md', '[Bravo text](Folder/Bravo.md) [[Bravo|alpha]]');
    await app.vault.createFolder('Folder');
    await load();

    await app.vault.rename(bravo, 'Folder/Bravo.md');

    expect(index.getLinkTexts('Folder/Bravo.md')).toEqual([
      { count: 1, sourcePaths: ['Charlie.md'], text: 'Bravo text' },
      { count: 1, sourcePaths: ['Charlie.md'], text: 'alpha' }
    ]);
    expect(index.getLinkTexts('Bravo.md')).toEqual([]);

    changes = [];
    const renamed = app.vault.getFileByPath('Folder/Bravo.md');
    if (renamed) {
      await app.fileManager.trashFile(renamed);
    }

    expect(index.getLinkTexts('Folder/Bravo.md')).toEqual([]);
    expect(changes).toEqual([['Folder/Bravo.md']]);
  });

  it('should handle a renamed folder holding both sources and targets', async () => {
    await app.vault.createFolder('Folder');
    createFile('Folder/Bravo.md', '');
    createFile('Folder/Charlie.md', '[[Bravo|alpha]]');
    createFile('Delta.md', '[[Bravo|echo]]');
    await load();

    const folder = app.vault.getFolderByPath('Folder');
    if (folder) {
      await app.vault.rename(folder, 'Moved');
    }
    await reparse('Moved/Charlie.md');

    expect(index.getLinkTexts('Moved/Bravo.md')).toEqual([
      { count: 1, sourcePaths: ['Moved/Charlie.md'], text: 'alpha' },
      { count: 1, sourcePaths: ['Delta.md'], text: 'echo' }
    ]);
    expect(index.getSourcePaths('Folder', true)).toEqual([]);
  });

  it('should ignore the plugin\'s own data notes and notes with no cache', async () => {
    createFile('Bravo.md', '');
    const transport = createFile('Plugin data/advanced-metadata-cache/journal.md', '[[Bravo|generated]]');
    const pdf = createFile('Scan.pdf', '');
    await load();

    app.metadataCache.trigger('resolve', transport);
    app.metadataCache.trigger('resolve', pdf);

    expect(index.getLinkTexts('Bravo.md')).toEqual([]);
  });

  it('should build a vault larger than one batch', async () => {
    createFile('Bravo.md', '');
    for (let noteIndex = 0; noteIndex < BUILD_BATCH_SIZE; noteIndex++) {
      createFile(`Note ${String(noteIndex)}.md`, '[[Bravo|alpha]]');
    }

    await load();

    expect(index.getLinkTexts('Bravo.md')[0]?.count).toBe(BUILD_BATCH_SIZE);
  });

  it('should stop building when switched off between two batches', async () => {
    createFile('Bravo.md', '');
    for (let noteIndex = 0; noteIndex < BUILD_BATCH_SIZE; noteIndex++) {
      createFile(`Note ${String(noteIndex)}.md`, '[[Bravo|alpha]]');
    }
    const getFileByPath = app.vault.getFileByPath.bind(app.vault);
    let readCount = 0;
    vi.spyOn(app.vault, 'getFileByPath').mockImplementation((path) => {
      readCount++;
      if (readCount === BUILD_BATCH_SIZE) {
        component.unload();
      }
      return getFileByPath(path);
    });

    await load();

    expect(component.isBuilt).toBe(false);
  });

  it('should clear the index and release waiters when switched off', async () => {
    createFile('Bravo.md', '');
    createFile('Charlie.md', '[[Bravo|alpha]]');
    await load();
    changes = [];

    component.unload();
    await component.waitForBuild();

    expect(index.getLinkTexts('Bravo.md')).toEqual([]);
    expect(changes).toEqual([null]);
  });

  it('should not build when switched off while waiting for the metadata cache', async () => {
    createFile('Bravo.md', '');
    createFile('Charlie.md', '[[Bravo|alpha]]');
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
    expect(index.getLinkTexts('Bravo.md')).toEqual([]);
  });

  function createFile(path: string, content: string): TFile {
    return app.vault.createSync__(path, content);
  }

  async function reparse(path: string): Promise<void> {
    const file = app.vault.getFileByPath(path);
    if (!file) {
      throw new Error(`No file at ${path}`);
    }
    await app.vault.modify(file, await app.vault.read(file));
    app.metadataCache.trigger('resolve', file);
  }

  async function load(): Promise<void> {
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);
    await waitForAllAsyncOperations();
  }
});
