import type { App as AppOriginal } from 'obsidian';

import { setTimeoutAsync } from '@mnaoumov/typescript-lib/async';
import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { waitForAllAsyncOperations } from '@mnaoumov/typescript-test-toolkit/async-operation-tracking';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { HtmlIndexComponent } from './html-index-component.ts';

describe('HTML incremental index', () => {
  it('uses lexical exclusions when a note has no core cache entry yet', async () => {
    const app = App.createConfigured__();
    Object.assign(app.metadataCache, {
      onCleanCache: (callback: () => void): void => {
        callback();
      }
    });
    app.vault.createSync__('Alpha.md', 'Text <br>');
    vi.spyOn(app.metadataCache, 'getFileCache').mockReturnValue(null);
    const component = new HtmlIndexComponent({ app: castTo<AppOriginal>(app) });
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);
    await waitForAllAsyncOperations();
    expect(component.getRanges('Alpha.md')?.map((range) => range.html)).toEqual(['<br>']);
    component.unload();
    await waitForAllAsyncOperations();
  });

  it('settles a waiting caller when unloaded before metadata readiness', async () => {
    const app = App.createConfigured__();
    let finish: (() => void) | undefined;
    Object.assign(app.metadataCache, {
      onCleanCache: (callback: () => void): void => {
        finish = callback;
      }
    });
    const component = new HtmlIndexComponent({ app: castTo<AppOriginal>(app) });
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);
    component.unload();
    finish?.();
    await waitForAllAsyncOperations();
    await component.waitForBuild();
    expect(component.isBuilt).toBe(false);
    expect(component.getRanges('Alpha.md')).toBeNull();
  });

  it('does not restart a child unloaded during attachment', async () => {
    const app = App.createConfigured__();
    Object.assign(app.metadataCache, {
      onCleanCache: (callback: () => void): void => {
        callback();
      }
    });
    const component = new HtmlIndexComponent({ app: castTo<AppOriginal>(app) });
    const addChild = component.addChild.bind(component);
    vi.spyOn(component, 'addChild').mockImplementation((child) => {
      const added = addChild(child);
      component.unload();
      return added;
    });
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);
    await waitForAllAsyncOperations();
    expect(component.isBuilt).toBe(false);
  });

  it('discards a build unloaded during a read', async () => {
    const app = App.createConfigured__();
    Object.assign(app.metadataCache, {
      onCleanCache: (callback: () => void): void => {
        callback();
      }
    });
    app.vault.createSync__('Alpha.md', '<br>');
    const component = new HtmlIndexComponent({ app: castTo<AppOriginal>(app) });
    vi.spyOn(app.vault, 'cachedRead').mockImplementation(() => {
      component.unload();
      return Promise.resolve('<br>');
    });
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);
    await waitForAllAsyncOperations();
    expect(component.isBuilt).toBe(false);
    expect(component.getRanges('Alpha.md')).toBeNull();
  });

  it('restores unchanged notes without reads, isolates answers and follows edit, rename and delete', async () => {
    const app = App.createConfigured__();
    Object.assign(app.metadataCache, {
      onCleanCache: (callback: () => void): void => {
        callback();
      }
    });
    const file = app.vault.createSync__('Alpha.md', 'Text <span>alpha</span>');
    app.vault.createSync__('Bravo.md', 'Plain');
    app.vault.createSync__('Alpha.txt', '<span>');
    app.vault.createSync__('Plugin data/advanced-metadata-cache/Alpha.md', '<span>');
    let saved: null | string = null;
    const storage = {
      close: vi.fn(noopAsync),
      read: (): Promise<null | string> => Promise.resolve(saved),
      write: (json: string): Promise<void> => {
        saved = json;
        return noopAsync();
      }
    };
    const first = new HtmlIndexComponent({ app: castTo<AppOriginal>(app), storage });
    expect(first.getRanges(file.path)).toBeNull();
    expect(first.getDiagnostics(file.path)).toBeNull();
    await load(first);
    expect(first.isBuilt).toBe(true);
    expect(first.getRanges('Bravo.md')).toEqual([]);
    expect(first.getDiagnostics('Bravo.md')).toEqual([]);
    expect(first.getDiagnostics('Missing.md')).toBeNull();
    expect(first.getRanges('Alpha.txt')).toBeNull();
    expect(first.getRanges('Plugin data/advanced-metadata-cache/Alpha.md')).toBeNull();
    const answer = first.getRanges(file.path) ?? [];
    expect(answer.map((range) => range.tagName)).toEqual(['span', 'span']);
    answer.length = 0;
    expect(first.getRanges(file.path)).toHaveLength(2);
    expect(first.getDiagnostics(file.path)).toEqual([]);
    expect(first.getDiagnostics(file.path)).toEqual([]);
    first.unload();
    await waitForAllAsyncOperations();
    expect(saved).not.toBeNull();
    expect(storage.close).toHaveBeenCalledOnce();
    const read = vi.spyOn(app.vault, 'cachedRead');
    const second = new HtmlIndexComponent({ app: castTo<AppOriginal>(app), storage });
    await load(second);
    expect(read).not.toHaveBeenCalled();
    expect(second.getRanges(file.path)).toHaveLength(2);
    await app.vault.modify(file, 'Now <br>');
    await waitForAllAsyncOperations();
    expect(second.getRanges(file.path)).toBeNull();
    app.metadataCache.trigger('changed', file, 'Now <br>', app.metadataCache.getFileCache(file));
    await waitForAllAsyncOperations();
    expect(second.getRanges(file.path)?.map((range) => range.tagName)).toEqual(['br']);
    await app.vault.rename(file, 'Charlie.md');
    await waitForAllAsyncOperations();
    expect(second.getRanges('Alpha.md')).toBeNull();
    expect(second.getRanges('Charlie.md')).toHaveLength(1);
    await app.vault.modify(file, '<script>');
    await waitForAllAsyncOperations();
    expect(second.getDiagnostics(file.path)).toBeNull();
    app.metadataCache.trigger('changed', file, '<script>', app.metadataCache.getFileCache(file));
    await waitForAllAsyncOperations();
    expect(second.getDiagnostics(file.path)?.map((diagnostic) => diagnostic.kind)).toEqual(['sanitized']);
    await app.fileManager.trashFile(file);
    await waitForAllAsyncOperations();
    expect(second.getRanges('Charlie.md')).toBeNull();
    second.unload();
    await waitForAllAsyncOperations();

    async function load(component: HtmlIndexComponent): Promise<void> {
      await component.loadWithPromises();
      app.workspace.setLayoutReady__();
      await setTimeoutAsync(0);
      await waitForAllAsyncOperations();
      await component.waitForBuild();
    }
  });
});
