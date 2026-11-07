import type { App as AppOriginal } from 'obsidian';
import type { TFile } from 'obsidian-test-mocks/obsidian';

import { IncrementalFileIndexComponent } from '@mnaoumov/obsidian-lib/components/incremental-file-index-component';
import { setTimeoutAsync } from '@mnaoumov/typescript-lib/async';
import {
  noop,
  noopAsync
} from '@mnaoumov/typescript-lib/function';
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
import { ExternalLinkIndexComponent } from './external-link-index-component.ts';
/* eslint-enable import-x/first, import-x/imports-first -- End of the mocked imports. */

describe('ExternalLinkIndexComponent', () => {
  let app: App;
  let component: ExternalLinkIndexComponent;

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    component = new ExternalLinkIndexComponent({ app: castTo<AppOriginal>(app) });
  });

  it('should build from every note\'s text, skipping other files and the plugin\'s own data', async () => {
    createFile('Alpha.md', '---\nsource: https://a.com\n---\nSee https://b.com/x');
    createFile('Bravo.md', 'No links');
    createFile('Data.txt', 'https://c.com');
    createFile('Plugin data/advanced-metadata-cache/journal.md', 'https://d.com');

    await load();

    expect(component.isBuilt).toBe(true);
    expect(component.externalLinkIndex.getHosts().map((usage) => usage.host)).toEqual(['a.com', 'b.com']);
    expect(component.externalLinkIndex.getLinks('Alpha.md').map((link) => link.isInFrontmatter)).toEqual([true, false]);
  });

  it('should restore unchanged notes without reading text and read only changed notes after a restart', async () => {
    const alpha = createFile('Alpha.md', 'https://a.com');
    const bravo = createFile('Bravo.md', 'https://b.com');
    let saved: null | string = null;
    const storage = {
      read: (): Promise<null | string> => Promise.resolve(saved),
      write: (json: string): Promise<void> => {
        saved = json;
        return noopAsync();
      }
    };
    component = new ExternalLinkIndexComponent({ app: castTo<AppOriginal>(app), storage });
    await load();
    const expected = component.externalLinkIndex.getLinks(alpha.path);
    component.unload();
    await waitForAllAsyncOperations();
    expect(saved).not.toBeNull();
    await app.vault.modify(bravo, 'https://c.com/changed');
    const read = vi.spyOn(app.vault, 'cachedRead');
    // eslint-disable-next-line require-atomic-updates -- The previous lifetime was unloaded and drained before creating this one.
    component = new ExternalLinkIndexComponent({ app: castTo<AppOriginal>(app), storage });
    await load();
    expect(read.mock.calls.map(([file]) => file.path)).toEqual(['Bravo.md']);
    expect(component.externalLinkIndex.getLinks(alpha.path)).toEqual(expected);
    expect(getPaths('c.com')).toEqual(['Bravo.md']);
    component.unload();
    await waitForAllAsyncOperations();
  });

  it('should wait for the metadata cache before building, and let a caller wait for the build', async () => {
    createFile('Alpha.md', 'https://a.com');
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
    expect(getPaths('a.com')).toEqual([]);

    const waitPromise = component.waitForBuild();
    resolveReady();
    await waitPromise;

    expect(getPaths('a.com')).toEqual(['Alpha.md']);
  });

  it('should save renamed and deleted records and close only after the unload write finishes', async () => {
    const alpha = createFile('Alpha.md', 'https://a.com');
    const bravo = createFile('Bravo.md', 'https://b.com');
    const close = vi.fn(async (): Promise<void> => {
      await noopAsync();
    });
    let finishWrite: () => void = noop;
    const write = vi.fn(async (_json: string): Promise<void> => {
      await new Promise<void>((resolve) => {
        finishWrite = resolve;
      });
    });
    component = new ExternalLinkIndexComponent({ app: castTo<AppOriginal>(app), storage: { close, read: (): Promise<null> => Promise.resolve(null), write } });
    await load();
    await app.vault.rename(alpha, 'Renamed.md');
    await app.fileManager.trashFile(bravo);
    component.unload();
    expect(write).toHaveBeenCalledOnce();
    expect(JSON.parse(write.mock.calls[0]?.[0] ?? 'null')).toMatchObject({ notes: { 'Renamed.md': { mtime: alpha.stat.mtime, size: alpha.stat.size } } });
    expect(write.mock.calls[0]?.[0]).not.toContain('Alpha.md');
    expect(write.mock.calls[0]?.[0]).not.toContain('Bravo.md');
    expect(close).not.toHaveBeenCalled();
    finishWrite();
    await waitForAllAsyncOperations();
    expect(close).toHaveBeenCalledOnce();
  });

  it('should preserve the previous checkpoint when unloaded during restoration', async () => {
    createFile('Alpha.md', 'https://a.com');
    let finishRead: (json: null | string) => void = noop;
    const write = vi.fn(async (_json: string): Promise<void> => {
      await noopAsync();
    });
    const close = vi.fn(async (): Promise<void> => {
      await noopAsync();
    });
    component = new ExternalLinkIndexComponent({
      app: castTo<AppOriginal>(app),
      storage: {
        close,
        read: async (): Promise<null | string> =>
          await new Promise<null | string>((resolve) => {
            finishRead = resolve;
          }),
        write
      }
    });
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);
    component.unload();
    finishRead(null);
    await waitForAllAsyncOperations();
    expect(component.isBuilt).toBe(false);
    expect(getPaths('a.com')).toEqual([]);
    expect(write).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it('should follow an edit, a rename and a delete', async () => {
    const alpha = createFile('Alpha.md', 'https://a.com');
    const bravo = createFile('Bravo.md', 'https://a.com');
    await load();

    await app.vault.modify(alpha, 'https://b.com');
    // The mock parses before it fires `modify`; Obsidian fires `changed` after it, carrying the text.
    expect(getPaths('a.com')).toEqual(['Bravo.md']);
    app.metadataCache.trigger('changed', alpha, 'https://b.com', {});
    await app.vault.rename(bravo, 'Renamed.md');
    await waitForAllAsyncOperations();

    expect(getPaths('a.com')).toEqual(['Renamed.md']);
    expect(getPaths('b.com')).toEqual(['Alpha.md']);

    await app.fileManager.trashFile(alpha);

    expect(getPaths('b.com')).toEqual([]);
  });

  it('should clear the index and release waiters when switched off', async () => {
    createFile('Alpha.md', 'https://a.com');
    await load();

    component.unload();
    await component.waitForBuild();

    expect(getPaths('a.com')).toEqual([]);
  });

  it('should not build when switched off while waiting for the metadata cache', async () => {
    createFile('Alpha.md', 'https://a.com');
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
    expect(getPaths('a.com')).toEqual([]);
  });

  it('should not build when switched off while the notes are being read', async () => {
    createFile('Alpha.md', 'https://a.com');
    const cachedRead = app.vault.cachedRead.bind(app.vault);
    vi.spyOn(app.vault, 'cachedRead').mockImplementation(async (file) => {
      component.unload();
      return cachedRead(file);
    });
    vi.spyOn(app.vault, 'read').mockImplementation(async (file) => {
      component.unload();
      return cachedRead(file);
    });

    await load();

    expect(component.isBuilt).toBe(false);
  });

  it('should not load the reader when switched off as it is added', async () => {
    createFile('Alpha.md', 'https://a.com');
    // The reader starts loading inside `addChild`, so this is the moment just after it was added.
    vi.spyOn(IncrementalFileIndexComponent.prototype, 'onload').mockImplementationOnce(() => {
      component.unload();
    });

    await load();

    expect(component.isBuilt).toBe(false);
  });

  function createFile(path: string, content: string): TFile {
    return app.vault.createSync__(path, content);
  }

  function getPaths(host: string): string[] {
    return component.externalLinkIndex.getPathsLinkingToHost(host);
  }

  async function load(): Promise<void> {
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);
    await waitForAllAsyncOperations();
  }
});
