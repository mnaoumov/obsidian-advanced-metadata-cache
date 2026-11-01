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
  TagIndexComponent
} from './tag-index-component.ts';
/* eslint-enable import-x/first, import-x/imports-first -- End of the mocked imports. */

describe('TagIndexComponent', () => {
  let app: App;
  let component: TagIndexComponent;

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    component = new TagIndexComponent({ app: castTo<AppOriginal>(app) });
  });

  it('should build from every note\'s cached tags, body and frontmatter apart', async () => {
    createFile('Alpha.md', '---\ntags: [project]\n---\nText');
    createFile('Bravo.md', 'Text #project/alpha');
    createFile('Charlie.md', 'No tags');

    await load();

    expect(component.isBuilt).toBe(true);
    expect(getPaths('project')).toEqual(['Alpha.md', 'Bravo.md']);
    expect(component.tagIndex.getPathsWithTag('project', { source: 'frontmatter' })).toEqual(['Alpha.md']);
    expect(component.tagIndex.getPathsWithTag('project', { source: 'body' })).toEqual(['Bravo.md']);
  });

  it('should wait for the metadata cache before building, and let a caller wait for the build', async () => {
    createFile('Alpha.md', '#project');
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
    expect(getPaths('project')).toEqual([]);

    const waitPromise = component.waitForBuild();
    resolveReady();
    await waitPromise;

    expect(getPaths('project')).toEqual(['Alpha.md']);
  });

  it('should re-read a note Obsidian parsed again', async () => {
    const alpha = createFile('Alpha.md', '#project');
    await load();

    await app.vault.modify(alpha, '#other');

    expect(getPaths('project')).toEqual([]);
    expect(getPaths('other')).toEqual(['Alpha.md']);
  });

  it('should drop a deleted note', async () => {
    const alpha = createFile('Alpha.md', '#project');
    await load();

    await app.fileManager.trashFile(alpha);

    expect(getPaths('project')).toEqual([]);
  });

  it('should move a renamed note\'s tags to its new path', async () => {
    const alpha = createFile('Alpha.md', '#project');
    await load();

    await app.vault.rename(alpha, 'Renamed.md');

    expect(getPaths('project')).toEqual(['Renamed.md']);
  });

  it('should move the notes of a renamed folder', async () => {
    await app.vault.createFolder('Folder');
    createFile('Folder/Alpha.md', '#project');
    createFile('Bravo.md', '#project');
    await load();

    const folder = app.vault.getFolderByPath('Folder');
    if (folder) {
      await app.vault.rename(folder, 'Moved');
    }

    expect(getPaths('project')).toEqual(['Bravo.md', 'Moved/Alpha.md']);
    expect(component.tagIndex.getPaths('Folder', true)).toEqual([]);
  });

  it('should drop a note renamed away from a note, and read a file renamed to one once Obsidian parses it', async () => {
    const text = createFile('Alpha.txt', '#project');
    const bravo = createFile('Bravo.md', '#project');
    await load();

    await app.vault.rename(bravo, 'Bravo.txt');

    expect(getPaths('project')).toEqual([]);

    await app.vault.rename(text, 'Alpha.md');
    await app.vault.modify(text, '#project');

    expect(getPaths('project')).toEqual(['Alpha.md']);
  });

  it('should drop a note renamed into the plugin\'s own data folder', async () => {
    const alpha = createFile('Alpha.md', '#project');
    await app.vault.createFolder('Plugin data/advanced-metadata-cache');
    await load();

    await app.vault.rename(alpha, 'Plugin data/advanced-metadata-cache/Alpha.md');

    expect(getPaths('project')).toEqual([]);
  });

  it('should drop a note whose cache is gone, and ignore a changed file that is no note or no longer exists', async () => {
    const alpha = createFile('Alpha.md', '#project');
    const bravo = createFile('Bravo.md', '#project');
    const pdf = createFile('Scan.pdf', '');
    await load();

    vi.spyOn(app.metadataCache, 'getFileCache').mockReturnValue(null);
    app.metadataCache.trigger('changed', alpha, '', {});
    vi.restoreAllMocks();
    app.metadataCache.trigger('changed', pdf, '', {});
    await app.fileManager.trashFile(bravo);
    app.metadataCache.trigger('changed', bravo, '', {});

    expect(getPaths('project')).toEqual([]);
  });

  it('should ignore the plugin\'s own data notes', async () => {
    createFile('Plugin data/advanced-metadata-cache/journal.md', '#project');
    await load();

    expect(getPaths('project')).toEqual([]);
  });

  it('should build a vault larger than one batch', async () => {
    for (let noteIndex = 0; noteIndex <= BUILD_BATCH_SIZE; noteIndex++) {
      createFile(`Note ${String(noteIndex)}.md`, '#project');
    }

    await load();

    expect(getPaths('project')).toHaveLength(BUILD_BATCH_SIZE + 1);
  });

  it('should stop building when switched off between two batches', async () => {
    for (let noteIndex = 0; noteIndex < BUILD_BATCH_SIZE * 2; noteIndex++) {
      createFile(`Note ${String(noteIndex)}.md`, '#project');
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
    createFile('Alpha.md', '#project');
    await load();

    component.unload();
    await component.waitForBuild();

    expect(getPaths('project')).toEqual([]);
  });

  it('should not build when switched off while waiting for the metadata cache', async () => {
    createFile('Alpha.md', '#project');
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
    expect(getPaths('project')).toEqual([]);
  });

  function createFile(path: string, content: string): TFile {
    return app.vault.createSync__(path, content);
  }

  function getPaths(tag: string): string[] {
    return component.tagIndex.getPathsWithTag(tag);
  }

  async function load(): Promise<void> {
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);
    await waitForAllAsyncOperations();
  }
});
