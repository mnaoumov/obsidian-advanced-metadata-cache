import type {
  App as AppOriginal,
  TFile as TFileOriginal
} from 'obsidian';
import type {
  TFile,
  TFolder
} from 'obsidian-test-mocks/obsidian';
import type { Mock } from 'vitest';

import { ensureMetadataCacheReady } from '@mnaoumov/obsidian-lib/metadata-cache';
import { setTimeoutAsync } from '@mnaoumov/typescript-lib/async';
import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { waitForAllAsyncOperations } from '@mnaoumov/typescript-test-toolkit/async-operation-tracking';
import { Component } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { UnlinkedMentionMatch } from './unlinked-mentions-component.ts';

import { UnlinkedMentionIndex } from './unlinked-mention-index.ts';

interface MentionsCheckpoint {
  readonly isDirty: boolean;
  readonly save: () => Promise<void>;
}

interface SavedNotesShape {
  readonly notes: Record<string, unknown>;
}

interface UserIgnoredSource {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Tests replace the ignore predicate before scanning.
  isUserIgnored: (path: string) => boolean;
}

const hoisted = vi.hoisted(() => ({
  corePluginComponentConstructor: vi.fn()
}));

vi.mock('@mnaoumov/obsidian-lib/metadata-cache', () => ({
  ensureMetadataCacheReady: vi.fn().mockResolvedValue(undefined)
}));

// Extends the real obsidian-test-mocks Component so the real addChild lifecycle can load it.
vi.mock('./unlinked-mentions-core-plugin-component.ts', () => ({
  UnlinkedMentionsCorePluginComponent: class extends Component {
    public constructor(params: unknown) {
      super();
      hoisted.corePluginComponentConstructor(params);
    }
  }
}));

/* eslint-disable import-x/first, import-x/imports-first -- vi.mock must precede imports. */
import {
  SAVE_DEBOUNCE_IN_MILLISECONDS,
  UnlinkedMentionsComponent
} from './unlinked-mentions-component.ts';
/* eslint-enable import-x/first, import-x/imports-first -- End of the mocked imports. */

const DATA_FILE_PATH = 'unlinked-mentions.json';
describe('UnlinkedMentionsComponent', () => {
  let app: App;
  let component: UnlinkedMentionsComponent;
  let isUserIgnored: Mock<(path: string) => boolean>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = App.createConfigured__();
    isUserIgnored = vi.fn(() => false);
    castTo<UserIgnoredSource>(app.metadataCache).isUserIgnored = isUserIgnored;
    component = createComponent();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should install the pane patch and build the index once the layout is ready', async () => {
    expect(component.isBuilt).toBe(false);

    await load();

    expect(component.isBuilt).toBe(true);
    expect(hoisted.corePluginComponentConstructor).toHaveBeenCalledWith({ app, unlinkedMentionsComponent: component });
  });

  it('should find the notes that mention a note by its name or an alias, outside links', async () => {
    const alpha = createNote('Alpha.md', '---\naliases:\n  - First\n---\nalpha itself');
    createNote('One.md', 'about Alpha');
    createNote('Two.md', 'the first one');
    createNote('Three.md', 'nothing here');
    createNote('Four.md', 'Alphabet');
    await load();

    expect(summarize(await component.getUnlinkedMentions(asOriginal(alpha)))).toEqual([
      ['One.md', [[6, 11]]],
      ['Two.md', [[4, 9]]]
    ]);
  });

  it('should confirm a candidate with the exact name, so the same words joined differently do not count', async () => {
    const note = createNote('Alpha Beta.md');
    createNote('One.md', 'alpha-beta');
    await load();
    const cachedRead = vi.spyOn(app.vault, 'cachedRead');

    expect(await component.getUnlinkedMentions(asOriginal(note))).toEqual([]);
    expect(cachedRead.mock.calls.map(([file]) => file.path)).toEqual(['One.md']);
  });

  it('should answer a call before the layout is ready by building first', async () => {
    const alpha = createNote('Alpha.md');
    createNote('One.md', 'alpha');

    expect(summarize(await component.getUnlinkedMentions(asOriginal(alpha)))).toEqual([['One.md', [[0, 5]]]]);
    expect(component.isBuilt).toBe(true);
  });

  it('should skip a note excluded from search', async () => {
    const alpha = createNote('Alpha.md');
    createNote('Ignored/One.md', 'alpha');
    isUserIgnored.mockImplementation((path: string) => path.startsWith('Ignored/'));
    await load();

    expect(await component.getUnlinkedMentions(asOriginal(alpha))).toEqual([]);
  });

  it('should read every note for a name with no word character', async () => {
    const tokyo = createNote('東京.md');
    createNote('One.md', '東京タワー');
    await load();
    const cachedRead = vi.spyOn(app.vault, 'cachedRead');

    expect(summarize(await component.getUnlinkedMentions(asOriginal(tokyo)))).toEqual([['One.md', [[0, 2]]]]);
    expect(cachedRead).toHaveBeenCalledTimes(1);
  });

  it('should read only the candidate notes for an indexed name', async () => {
    const alpha = createNote('Alpha.md');
    createNote('One.md', 'alpha');
    createNote('Two.md', 'beta');
    await load();
    const cachedRead = vi.spyOn(app.vault, 'cachedRead');

    await component.getUnlinkedMentions(asOriginal(alpha));

    expect(cachedRead.mock.calls.map(([file]) => file.path)).toEqual(['One.md']);
  });

  it('should scan every note once more for a note created after the build, then answer from the index', async () => {
    createNote('One.md', 'gamma');
    await load();

    const gamma = createNote('Gamma.md');
    app.vault.trigger('create', gamma);
    const cachedRead = vi.spyOn(app.vault, 'cachedRead');

    expect(summarize(await component.getUnlinkedMentions(asOriginal(gamma)))).toEqual([['One.md', [[0, 5]]]]);
    const firstReadCount = cachedRead.mock.calls.length;
    expect(firstReadCount).toBeGreaterThan(1);

    await component.getUnlinkedMentions(asOriginal(gamma));
    expect(cachedRead.mock.calls.length - firstReadCount).toBe(1);
  });

  it('should follow a changed note\'s text and aliases', async () => {
    const alpha = createNote('Alpha.md');
    const one = createNote('One.md', 'nothing');
    await load();

    app.metadataCache.trigger('changed', castTo<TFile>(one), 'now alpha', castTo<never>({}));
    await app.vault.modify(one, 'now alpha');

    expect(summarize(await component.getUnlinkedMentions(asOriginal(alpha)))).toEqual([['One.md', [[4, 9]]]]);
  });

  it('should forget a deleted note and a deleted folder', async () => {
    const alpha = createNote('Alpha.md');
    const one = createNote('One.md', 'alpha');
    const folder = createFolder('Folder');
    createNote('Folder/Two.md', 'alpha');
    await load();

    app.vault.trigger('delete', one);
    app.vault.trigger('delete', folder);
    app.vault.deleteVaultAbstractFile__('One.md');
    app.vault.deleteVaultAbstractFile__('Folder/Two.md');

    expect(await component.getUnlinkedMentions(asOriginal(alpha))).toEqual([]);
  });

  it('should follow a renamed note and a renamed folder', async () => {
    createNote('Alpha.md');
    const one = createNote('One.md', 'alpha renamed');
    createFolder('Old');
    createNote('Old/Two.md', 'alpha');
    await load();

    await app.fileManager.renameFile(one, 'Moved.md');
    const folder = renameFolderInVault('Old', 'New');
    app.vault.trigger('rename', folder, 'Old');
    const alpha = castTo<TFile>(app.vault.getFileByPath('Alpha.md'));
    await app.fileManager.renameFile(alpha, 'Renamed.md');

    const renamed = castTo<TFile>(app.vault.getFileByPath('Renamed.md'));
    expect(summarize(await component.getUnlinkedMentions(asOriginal(renamed))).map(([path]) => path)).toEqual(['Moved.md']);
    const two = castTo<TFile>(app.vault.getFileByPath('New/Two.md'));
    expect(summarize(await component.getUnlinkedMentions(asOriginal(two)))).toEqual([]);
  });

  it('should ignore a rename of something that is neither a file nor a folder', async () => {
    await load();

    expect(() => {
      app.vault.trigger('rename', castTo<TFile>({ path: 'odd' }), 'old');
    }).not.toThrow();
  });

  it('should find a mention in one given note, and none in the note itself', async () => {
    const alpha = createNote('Alpha.md');
    const one = createNote('One.md', 'alpha');
    const pdf = createNote('Doc.pdf', 'alpha');
    await load();

    expect(await component.getUnlinkedMentionIn(asOriginal(alpha), asOriginal(one))).toMatchObject({ file: one, ranges: [[0, 5]] });
    expect(await component.getUnlinkedMentionIn(asOriginal(alpha), asOriginal(alpha))).toBeNull();
    expect(await component.getUnlinkedMentionIn(asOriginal(alpha), asOriginal(pdf))).toBeNull();
  });

  it('should stop a scan and stay not built when unloaded during the build', async () => {
    createNote('Alpha.md');
    createNote('One.md', 'alpha');
    const loadPromise = load();
    component.unload();
    await loadPromise;

    expect(component.isBuilt).toBe(false);
  });

  it('should stop reading and leave the scan incomplete when unloaded mid-scan', async () => {
    for (let index = 0; index < 30; index++) {
      createNote(`Note ${String(index)}.md`, 'alpha');
    }

    const cachedRead = vi.spyOn(app.vault, 'cachedRead').mockImplementation((file) => {
      component.unload();
      return Promise.resolve(app.vault.readSync__(file));
    });

    await load();

    expect(component.isBuilt).toBe(false);
    // The first batch was already reading; no later batch started.
    expect(cachedRead.mock.calls.length).toBeLessThan(30);
  });

  it('should drop a note deleted while the scan read it', async () => {
    const alpha = createNote('Alpha.md');
    createNote('One.md', 'alpha');
    vi.spyOn(app.vault, 'cachedRead').mockImplementation((file) => {
      const content = app.vault.readSync__(file);
      if (file.path === 'One.md') {
        app.vault.deleteVaultAbstractFile__(file.path);
      }

      return Promise.resolve(content);
    });

    await load();

    expect(await component.getUnlinkedMentions(asOriginal(alpha))).toEqual([]);
  });

  it('should save the index on its debounce once built, and not before', async () => {
    createNote('Alpha.md');
    createNote('One.md', 'alpha');
    vi.useFakeTimers();
    await component.loadWithPromises();

    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_IN_MILLISECONDS);
    expect(await app.vault.adapter.exists(DATA_FILE_PATH)).toBe(false);

    app.workspace.setLayoutReady__();
    await vi.advanceTimersByTimeAsync(0);
    expect(component.isBuilt).toBe(true);
    expect(await app.vault.adapter.exists(DATA_FILE_PATH)).toBe(false);

    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_IN_MILLISECONDS);
    expect(JSON.parse(await app.vault.adapter.read(DATA_FILE_PATH))).toMatchObject({
      cleanKeys: [0, 1],
      keys: ['ALPHA', 'ONE'],
      notes: { 'Alpha.md': { keys: [] }, 'One.md': { keys: [0] } },
      version: 1
    });
  });

  it('should save on unload, and not when unloaded before the build ended', async () => {
    createNote('Alpha.md');
    const loadPromise = load();
    component.unload();
    await loadPromise;
    await waitForAllAsyncOperations();
    expect(await app.vault.adapter.exists(DATA_FILE_PATH)).toBe(false);

    await restart();
    component.unload();
    await waitForAllAsyncOperations();
    expect(await app.vault.adapter.exists(DATA_FILE_PATH)).toBe(true);
  });

  it('should reuse the saved index on the next build, reading no note that is unchanged', async () => {
    const alpha = createNote('Alpha.md');
    createNote('One.md', 'alpha');
    createNote('Two.md', 'beta');
    await load();
    const cachedRead = vi.spyOn(app.vault, 'cachedRead');

    await restart();

    expect(cachedRead).not.toHaveBeenCalled();
    expect(summarize(await component.getUnlinkedMentions(asOriginal(alpha)))).toEqual([['One.md', [[0, 5]]]]);
    expect(cachedRead.mock.calls.map(([file]) => file.path)).toEqual(['One.md']);
  });

  it('should read again a note changed, created or renamed while nothing watched, and forget a deleted one', async () => {
    const alpha = createNote('Alpha.md');
    const one = createNote('One.md', 'beta');
    const two = createNote('Two.md', 'alpha');
    createNote('Three.md', 'alpha');
    await load();
    await unloadComponent();

    await app.vault.modify(one, 'now alpha');
    createNote('Four.md', 'alpha');
    app.vault.deleteVaultAbstractFile__(two.path);
    await app.vault.rename(castTo<TFile>(app.vault.getFileByPath('Three.md')), 'Five.md');
    const cachedRead = vi.spyOn(app.vault, 'cachedRead');

    component = createComponent();
    await load();

    expect(cachedRead.mock.calls.map(([file]) => file.path).sort()).toEqual(['Five.md', 'Four.md', 'One.md']);
    expect(summarize(await component.getUnlinkedMentions(asOriginal(alpha))).map(([path]) => path)).toEqual(['Five.md', 'Four.md', 'One.md']);
  });

  it('should keep a note `changed` scanned during the load rather than its saved entry', async () => {
    const alpha = createNote('Alpha.md');
    const one = createNote('One.md', 'beta');
    await load();
    const read = app.vault.adapter.read.bind(app.vault.adapter);
    // The note changes while the build reads the saved file, so its saved entry is older than what `changed` scanned.
    vi.spyOn(app.vault.adapter, 'read').mockImplementation(async (path) => {
      if (path === DATA_FILE_PATH) {
        await app.vault.modify(one, 'alpha now');
        app.metadataCache.trigger('changed', castTo<TFile>(one), 'alpha now', castTo<never>({}));
      }

      return await read(path);
    });
    const cachedRead = vi.spyOn(app.vault, 'cachedRead');
    await restart();

    // Its `mtime` no longer matches the saved one, but `changed` already scanned it, so the build does not read it.
    expect(cachedRead).not.toHaveBeenCalled();

    expect(summarize(await component.getUnlinkedMentions(asOriginal(alpha)))).toEqual([['One.md', [[0, 5]]]]);
  });

  it('should treat a name the saved index had not looked for as dirty', async () => {
    createNote('One.md', 'gamma');
    await load();
    await unloadComponent();

    const gamma = createNote('Gamma.md');
    component = createComponent();
    await load();
    const cachedRead = vi.spyOn(app.vault, 'cachedRead');

    expect(summarize(await component.getUnlinkedMentions(asOriginal(gamma)))).toEqual([['One.md', [[0, 5]]]]);
    expect(cachedRead.mock.calls.length).toBeGreaterThan(1);
  });

  it('should save a name that was dirty as not looked for', async () => {
    createNote('One.md', 'gamma');
    await load();
    const gamma = createNote('Gamma.md');
    app.vault.trigger('create', gamma);
    component.unload();
    await waitForAllAsyncOperations();

    expect(JSON.parse(await app.vault.adapter.read(DATA_FILE_PATH))).toMatchObject({ cleanKeys: [0], keys: ['ONE'] });
  });

  it('should save after a deleted note, a deleted folder and a rename', async () => {
    createNote('Alpha.md');
    const one = createNote('One.md', 'alpha');
    const folder = createFolder('Folder');
    createNote('Folder/Two.md', 'alpha');
    createNote('Three.md', 'alpha');
    await load();

    app.vault.trigger('delete', one);
    app.vault.trigger('delete', folder);
    await app.fileManager.renameFile(castTo<TFile>(app.vault.getFileByPath('Three.md')), 'Moved.md');
    app.vault.trigger('rename', castTo<TFile>(app.vault.getFileByPath('Alpha.md')), 'Never scanned.md');
    component.unload();
    await waitForAllAsyncOperations();

    const saved = JSON.parse(await app.vault.adapter.read(DATA_FILE_PATH)) as SavedNotesShape;
    expect(Object.keys(saved.notes).sort()).toEqual(['Alpha.md', 'Moved.md']);
  });

  it('should stay not built when unloaded while reading the notes changed since the save', async () => {
    createNote('Alpha.md');
    const one = createNote('One.md', 'beta');
    await load();
    await unloadComponent();
    await app.vault.modify(one, 'now alpha');
    vi.spyOn(app.vault, 'cachedRead').mockImplementation((file) => {
      component.unload();
      return Promise.resolve(app.vault.readSync__(file));
    });

    component = createComponent();
    await load();

    expect(component.isBuilt).toBe(false);
  });

  it('should build by reading every note when the saved file is not one it can use', async () => {
    const alpha = createNote('Alpha.md');
    createNote('One.md', 'alpha');
    await app.vault.adapter.write(DATA_FILE_PATH, '{"version":0}');
    const cachedRead = vi.spyOn(app.vault, 'cachedRead');

    await load();

    expect(cachedRead).toHaveBeenCalledTimes(2);
    expect(summarize(await component.getUnlinkedMentions(asOriginal(alpha)))).toEqual([['One.md', [[0, 5]]]]);
  });

  it('should ignore its own journals during builds, changes, renames, restores and direct matching', async () => {
    const alpha = createNote('Alpha.md');
    const journal = createNote('Plugin data/advanced-metadata-cache/history/journal.md', 'alpha');
    const cachedRead = vi.spyOn(app.vault, 'cachedRead');
    await load();
    expect(cachedRead).not.toHaveBeenCalledWith(journal);
    app.metadataCache.trigger('changed', journal, 'alpha', app.metadataCache.getFileCache(journal));
    expect(await component.getUnlinkedMentionIn(asOriginal(alpha), asOriginal(journal))).toBeNull();
    expect(await component.getUnlinkedMentions(asOriginal(alpha))).toEqual([]);
    const source = createNote('User.md', 'alpha');
    await app.fileManager.renameFile(source, 'Plugin data/advanced-metadata-cache/history/moved.md');
    await restart();
    expect(await component.getUnlinkedMentions(asOriginal(alpha))).toEqual([]);
    await unloadComponent();
  });

  it('should ignore a note moved into the transport folder while its text was being read', async () => {
    const alpha = createNote('Alpha.md');
    const moving = createNote('Moving.md', 'alpha');
    vi.spyOn(app.vault, 'cachedRead').mockImplementation(async (file) => {
      const content = app.vault.readSync__(file);
      if (file === moving) {
        await app.fileManager.renameFile(moving, 'Plugin data/advanced-metadata-cache/history/moved.md');
      }
      return content;
    });
    await load();
    expect(await component.getUnlinkedMentions(asOriginal(alpha))).toEqual([]);
    await unloadComponent();
  });
  it('should retain a failed checkpoint for retry and close the connection on unload', async () => {
    const write = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    component = new UnlinkedMentionsComponent({ app: castTo<AppOriginal>(app), getDataFilePath: (): string => DATA_FILE_PATH, storage: { close, read: (): Promise<null> => Promise.resolve(null), write } });
    createNote('Alpha.md');
    await load();
    write.mockRejectedValueOnce(new Error('quota'));
    await expect(castTo<MentionsCheckpoint>(component).save()).rejects.toThrow('quota');
    expect(castTo<MentionsCheckpoint>(component).isDirty).toBe(true);
    await unloadComponent();
    expect(write).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });
  it.each(['metadata', 'persistence'] as const)('should not open or restore persistence after unloading during %s readiness', async (phase) => {
    const file = createNote('Alpha.md');
    const saved = JSON.stringify({ cleanKeys: [], keys: [], notes: { [file.path]: { keys: [], mtime: file.stat.mtime, size: file.stat.size } }, version: 1 });
    const read = vi.fn<() => Promise<null | string>>(() => {
      component.unload();
      return Promise.resolve(saved);
    });
    const restore = vi.spyOn(UnlinkedMentionIndex.prototype, 'restoreText');
    component = new UnlinkedMentionsComponent({ app: castTo<AppOriginal>(app), getDataFilePath: (): string => DATA_FILE_PATH, storage: { read, write: noopAsync } });
    if (phase === 'metadata') {
      vi.mocked(ensureMetadataCacheReady).mockImplementationOnce(() => {
        component.unload();
        return noopAsync();
      });
    }
    try {
      await load();
      expect(restore).not.toHaveBeenCalled();
      expect(read).toHaveBeenCalledTimes(phase === 'metadata' ? 0 : 1);
    } finally {
      restore.mockRestore();
    }
  });
  it('should save the names a query-started full scan cleaned when unloaded before the debounce', async () => {
    createNote('One.md', 'gamma');
    await load();
    const gamma = createNote('Gamma.md');
    app.vault.trigger('create', gamma);

    expect(summarize(await component.getUnlinkedMentions(asOriginal(gamma)))).toEqual([['One.md', [[0, 5]]]]);
    await unloadComponent();

    expect(JSON.parse(await app.vault.adapter.read(DATA_FILE_PATH))).toMatchObject({ cleanKeys: [0, 1], keys: ['ONE', 'GAMMA'] });
  });

  it('should leave a dirty name dirty when unloaded during the full scan a query started', async () => {
    createNote('One.md', 'gamma');
    await load();
    const gamma = createNote('Gamma.md');
    app.vault.trigger('create', gamma);
    vi.spyOn(app.vault, 'cachedRead').mockImplementation((file) => {
      component.unload();
      return Promise.resolve(app.vault.readSync__(file));
    });

    await component.getUnlinkedMentions(asOriginal(gamma));
    await waitForAllAsyncOperations();

    expect(JSON.parse(await app.vault.adapter.read(DATA_FILE_PATH))).toMatchObject({ cleanKeys: [0], keys: ['ONE'] });
  });

  it('should save on unload a change only the names saw, which the file index has no record of', async () => {
    const write = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    component = new UnlinkedMentionsComponent({ app: castTo<AppOriginal>(app), getDataFilePath: (): string => DATA_FILE_PATH, storage: { read: (): Promise<null> => Promise.resolve(null), write } });
    const pdf = createNote('Doc.pdf');
    createNote('One.md', 'doc');
    vi.useFakeTimers();
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_IN_MILLISECONDS);
    write.mockClear();

    app.vault.trigger('rename', pdf, 'Old.pdf');
    component.unload();
    await vi.advanceTimersByTimeAsync(0);

    expect(write).toHaveBeenCalledOnce();
  });

  function createComponent(): UnlinkedMentionsComponent {
    return new UnlinkedMentionsComponent({ app: castTo<AppOriginal>(app), getDataFilePath: () => DATA_FILE_PATH });
  }

  function createFolder(path: string): TFolder {
    return app.vault.createFolderSync__(path);
  }

  function createNote(path: string, content = ''): TFile {
    return app.vault.createSync__(path, content);
  }

  async function load(): Promise<void> {
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);
    await waitForAllAsyncOperations();
  }

  // Switches the module off, which saves the index, and on again, which loads it.
  async function restart(): Promise<void> {
    await unloadComponent();
    component = createComponent();
    await load();
  }

  async function unloadComponent(): Promise<void> {
    component.unload();
    await waitForAllAsyncOperations();
  }

  function renameFolderInVault(oldPath: string, newPath: string): TFolder {
    const movedFiles = app.vault.getFiles().filter((file) => file.path.startsWith(`${oldPath}/`));

    for (const movedFile of movedFiles) {
      app.vault.deleteVaultAbstractFile__(movedFile.path);
    }

    app.vault.deleteVaultAbstractFile__(oldPath);
    const folder = app.vault.createFolderSync__(newPath);

    for (const movedFile of movedFiles) {
      app.vault.createSync__(`${newPath}/${movedFile.name}`, app.vault.readSync__(movedFile));
    }

    return folder;
  }
});

function asOriginal(file: TFile): TFileOriginal {
  return castTo<TFileOriginal>(file);
}

function summarize(matches: UnlinkedMentionMatch[]): [string, [number, number][]][] {
  return matches.map((match): [string, [number, number][]] => [match.file.path, match.ranges]).sort(([a], [b]) => a.localeCompare(b));
}
