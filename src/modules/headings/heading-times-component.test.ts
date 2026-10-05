import type {
  App as AppOriginal,
  TFile as TFileOriginal
} from 'obsidian';
import type { TFile } from 'obsidian-test-mocks/obsidian';

import { MarkdownView } from 'obsidian';
import {
  setTimeoutAsync,
  waitForAllAsyncOperations
} from 'obsidian-dev-utils/async';
import { noopAsync } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../../plugin-settings-component.ts';
import type { HeadingSnapshot } from './heading-snapshot.ts';
import type { HeadingTimesRecord } from './heading-times-index.ts';
import type { VisibleLineRange } from './visible-lines.ts';

import { PluginSettings } from '../../plugin-settings.ts';
import { HeadingTimesIndex } from './heading-times-index.ts';

const hoisted = vi.hoisted(() => ({
  getVisibleLineRange: vi.fn<() => null | VisibleLineRange>(() => null)
}));

vi.mock('obsidian-dev-utils/obsidian/metadata-cache', () => ({
  ensureMetadataCacheReady: vi.fn().mockResolvedValue(undefined)
}));

// The editor geometry is read by its own function, tested on its own; here only what it answers matters.
vi.mock('./visible-lines.ts', () => ({
  getVisibleLineRange: hoisted.getVisibleLineRange
}));

/* eslint-disable import-x/first, import-x/imports-first -- vi.mock must precede imports. */
import {
  HeadingTimesComponent,
  SAVE_DEBOUNCE_IN_MILLISECONDS,
  SEEN_POLL_INTERVAL_IN_MILLISECONDS
} from './heading-times-component.ts';
/* eslint-enable import-x/first, import-x/imports-first -- End of the mocked imports. */

type RecordedTimes = Pick<HeadingTimesRecord, 'created' | 'modified' | 'seen' | 'text'>;

const DATA_FILE_PATH = 'heading-times.json';
const NOW = 1_000_000;

describe('HeadingTimesComponent', () => {
  let app: App;
  let component: HeadingTimesComponent;
  let index: HeadingTimesIndex;

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.getVisibleLineRange.mockReturnValue(null);
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    app = App.createConfigured__();

    const settings = new PluginSettings();
    settings.isHeadingsModuleEnabled = true;
    index = new HeadingTimesIndex({
      app: castTo<AppOriginal>(app),
      getDataFilePath: (): string => DATA_FILE_PATH,
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings })
    });
    component = new HeadingTimesComponent({ app: castTo<AppOriginal>(app), headingTimesIndex: index });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('events', () => {
    beforeEach(async () => {
      await load();
    });

    it('should record a parse of a note, stamped now, against what it had', () => {
      const file = createNote('Alpha.md', '# One\n');
      index.trackEmpty('Alpha.md', 0);

      triggerChanged(file, '# One\n');

      expect(timesOf('Alpha.md')).toEqual([{ created: NOW, modified: NOW, seen: null, text: 'One' }]);
    });

    it('should start tracking a note it had never seen at its first parse, with no times', () => {
      const file = createNote('Alpha.md', '# One\n');

      triggerChanged(file, '# One\n');

      expect(timesOf('Alpha.md')).toEqual([{ created: null, modified: null, seen: null, text: 'One' }]);
    });

    it('should record a parse with no cache as a note without headings', () => {
      const file = createNote('Alpha.md', '# One\n');
      index.trackEmpty('Alpha.md', 0);

      app.metadataCache.trigger('changed', file, '# One\n', castTo<never>(null));

      expect(timesOf('Alpha.md')).toEqual([]);
    });

    it('should track a note created now as empty, so its headings are all created now', () => {
      const file = createNote('Alpha.md', '# One\n');

      app.vault.trigger('create', file);
      triggerChanged(file, '# One\n');

      expect(timesOf('Alpha.md')).toEqual([{ created: NOW, modified: NOW, seen: null, text: 'One' }]);
    });

    it('should not track a created file that is not a note, nor a created folder', () => {
      app.vault.trigger('create', createNote('Alpha.txt', 'text'));
      app.vault.trigger('create', app.vault.createFolderSync__('Folder'));

      expect(index.getPaths()).toEqual([]);
    });

    it('should forget a deleted note and a deleted folder', () => {
      const file = createNote('Alpha.md');
      const folder = app.vault.createFolderSync__('Folder');
      index.trackEmpty('Alpha.md', 0);
      index.trackEmpty('Folder/Beta.md', 0);
      index.trackEmpty('Gamma.md', 0);

      app.vault.trigger('delete', file);
      app.vault.trigger('delete', folder);

      expect(index.getPaths()).toEqual(['Gamma.md']);
    });

    it('should move a renamed note and a renamed folder', () => {
      const file = createNote('Renamed.md');
      const folder = app.vault.createFolderSync__('Moved');
      index.trackEmpty('Alpha.md', 0);
      index.trackEmpty('Folder/Beta.md', 0);

      app.vault.trigger('rename', file, 'Alpha.md');
      app.vault.trigger('rename', folder, 'Folder');

      expect(index.getPaths().sort()).toEqual(['Moved/Beta.md', 'Renamed.md']);
    });

    it('should start tracking a note when it is opened, with its current headings as the baseline', async () => {
      createNote('Alpha.md', '# One\n');

      app.workspace.trigger('file-open', getFile('Alpha.md'));
      await waitForAllAsyncOperations();

      expect(timesOf('Alpha.md')).toEqual([{ created: null, modified: null, seen: null, text: 'One' }]);
    });

    it('should leave a tracked note alone when it is opened again', async () => {
      createNote('Alpha.md', '# One\n');
      index.trackEmpty('Alpha.md', 0);

      app.workspace.trigger('file-open', getFile('Alpha.md'));
      await waitForAllAsyncOperations();

      expect(timesOf('Alpha.md')).toEqual([]);
    });

    it('should ignore an open of nothing, and of a file that is not a note', async () => {
      createNote('Alpha.txt', 'text');

      app.workspace.trigger('file-open', null);
      app.workspace.trigger('file-open', getFile('Alpha.txt'));
      await waitForAllAsyncOperations();

      expect(index.getPaths()).toEqual([]);
    });

    it('should keep the newer answer when a parse lands while an open is reading the note', async () => {
      const file = createNote('Alpha.md', '# One\n');
      vi.spyOn(app.vault, 'cachedRead').mockImplementation(() => {
        index.trackEmpty('Alpha.md', 0);
        return Promise.resolve('# One\n');
      });

      app.workspace.trigger('file-open', castTo<TFileOriginal>(file));
      await waitForAllAsyncOperations();

      expect(timesOf('Alpha.md')).toEqual([]);
    });
  });

  describe('catching up on load', () => {
    it('should forget a gone note, skip an unchanged one and re-read a changed one stamped with its mtime', async () => {
      const unchanged = createNote('Unchanged.md', '# Same\n');
      const changed = createNote('Changed.md', '# Old\nbody\n');
      index.record({ mtime: unchanged.stat.mtime, path: 'Unchanged.md', snapshots: [], time: 1 });
      index.trackEmpty('Gone.md', 0);
      index.record({ mtime: changed.stat.mtime - 1, path: 'Changed.md', snapshots: [], time: 1 });
      await index.save();

      await load();

      expect(index.getPaths().sort()).toEqual(['Changed.md', 'Unchanged.md']);
      expect(timesOf('Unchanged.md')).toEqual([]);
      expect(timesOf('Changed.md')).toEqual([{ created: changed.stat.mtime, modified: changed.stat.mtime, seen: null, text: 'Old' }]);
    });

    it('should keep the newer answer when a parse lands while it is reading the note', async () => {
      const file = createNote('Alpha.md', '# One\n');
      index.trackEmpty('Alpha.md', file.stat.mtime - 1);
      await index.save();
      vi.spyOn(app.vault, 'cachedRead').mockImplementation(() => {
        index.record({ mtime: file.stat.mtime, path: 'Alpha.md', snapshots: [], time: NOW });
        return Promise.resolve('# One\n');
      });

      await load();

      expect(timesOf('Alpha.md')).toEqual([]);
    });

    it('should start tracking every note already open', async () => {
      createNote('Alpha.md', '# One\n');
      const markdownView = Object.create(MarkdownView.prototype);
      Object.assign(markdownView, { file: getFile('Alpha.md') });
      const fileLessView = Object.create(MarkdownView.prototype);
      Object.assign(fileLessView, { file: null });
      vi.spyOn(app.workspace, 'getLeavesOfType').mockReturnValue([
        castTo<never>({ view: markdownView }),
        castTo<never>({ view: fileLessView }),
        castTo<never>({ view: {} })
      ]);

      await load();

      expect(timesOf('Alpha.md')).toEqual([{ created: null, modified: null, seen: null, text: 'One' }]);
    });

    it('should stop when unloaded while the index is loading', async () => {
      const on = vi.spyOn(app.metadataCache, 'on');
      vi.spyOn(index, 'load').mockImplementation(() => {
        component.unload();
        return noopAsync();
      });

      await load();

      expect(on).not.toHaveBeenCalled();
    });

    it('should stop catching up when unloaded during a read', async () => {
      const file = createNote('Alpha.md', '# One\n');
      index.trackEmpty('Alpha.md', file.stat.mtime - 1);
      await index.save();
      const record = vi.spyOn(index, 'record');
      vi.spyOn(app.vault, 'cachedRead').mockImplementation(() => {
        component.unload();
        return Promise.resolve('# One\n');
      });

      await load();

      expect(record).not.toHaveBeenCalled();
    });

    it('should stop tracking an opened note when unloaded during its read', async () => {
      await load();
      createNote('Alpha.md', '# One\n');
      const record = vi.spyOn(index, 'record');
      vi.spyOn(app.vault, 'cachedRead').mockImplementation(() => {
        component.unload();
        return Promise.resolve('# One\n');
      });

      app.workspace.trigger('file-open', getFile('Alpha.md'));
      await waitForAllAsyncOperations();

      expect(record).not.toHaveBeenCalled();
    });
  });

  describe('seen', () => {
    let poll: () => void;

    beforeEach(async () => {
      const setInterval = vi.spyOn(window, 'setInterval');
      await load();
      const [callback, delay] = setInterval.mock.calls.at(-1) ?? [];
      expect(delay).toBe(SEEN_POLL_INTERVAL_IN_MILLISECONDS);
      poll = castTo<() => void>(callback);
      index.record({ mtime: 0, path: 'Alpha.md', snapshots: snapshotsAt([0, 10, 20]), time: 1 });
    });

    it('should stamp the headings on screen at two polls in a row, where the two overlap', () => {
      hoisted.getVisibleLineRange.mockReturnValueOnce({ fromLine: 0, path: 'Alpha.md', toLine: 12 });
      hoisted.getVisibleLineRange.mockReturnValueOnce({ fromLine: 5, path: 'Alpha.md', toLine: 25 });

      poll();
      expect(seenOf('Alpha.md')).toEqual([null, null, null]);
      poll();

      expect(seenOf('Alpha.md')).toEqual([NOW, NOW, null]);
    });

    it('should stamp nothing when the two polls were in different notes', () => {
      hoisted.getVisibleLineRange.mockReturnValueOnce({ fromLine: 0, path: 'Beta.md', toLine: 30 });
      hoisted.getVisibleLineRange.mockReturnValueOnce({ fromLine: 0, path: 'Alpha.md', toLine: 30 });

      poll();
      poll();

      expect(seenOf('Alpha.md')).toEqual([null, null, null]);
    });

    it('should stamp nothing when nothing was on screen at one of the polls', () => {
      hoisted.getVisibleLineRange.mockReturnValueOnce({ fromLine: 0, path: 'Alpha.md', toLine: 30 });
      hoisted.getVisibleLineRange.mockReturnValueOnce(null);
      hoisted.getVisibleLineRange.mockReturnValueOnce({ fromLine: 0, path: 'Alpha.md', toLine: 30 });

      poll();
      poll();
      poll();

      expect(seenOf('Alpha.md')).toEqual([null, null, null]);
    });

    it('should stamp nothing when the two ranges do not overlap', () => {
      hoisted.getVisibleLineRange.mockReturnValueOnce({ fromLine: 0, path: 'Alpha.md', toLine: 5 });
      hoisted.getVisibleLineRange.mockReturnValueOnce({ fromLine: 20, path: 'Alpha.md', toLine: 25 });

      poll();
      poll();

      expect(seenOf('Alpha.md')).toEqual([null, null, null]);
    });

    it('should stamp nothing in a note it does not track', () => {
      const markSeen = vi.spyOn(index, 'markSeen');
      hoisted.getVisibleLineRange.mockReturnValue({ fromLine: 0, path: 'Beta.md', toLine: 5 });

      poll();
      poll();

      expect(markSeen).not.toHaveBeenCalled();
    });
  });

  describe('saving', () => {
    it('should save once the debounce has passed, and not before', async () => {
      await load();
      vi.useFakeTimers();
      const save = vi.spyOn(index, 'save');

      index.trackEmpty('Alpha.md', 0);
      triggerChanged(createNote('Alpha.md', '# One\n'), '# One\n');
      vi.advanceTimersByTime(SAVE_DEBOUNCE_IN_MILLISECONDS - 1);
      expect(save).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      vi.useRealTimers();
      await waitForAllAsyncOperations();

      expect(save).toHaveBeenCalledOnce();
      expect(await app.vault.adapter.read(DATA_FILE_PATH)).toContain('Alpha.md');
    });

    it('should save what is unsaved when switched off, and clear the memory', async () => {
      await load();
      index.trackEmpty('Alpha.md', 0);

      component.unload();
      await waitForAllAsyncOperations();

      expect(index.getPaths()).toEqual([]);
      expect(await app.vault.adapter.read(DATA_FILE_PATH)).toContain('Alpha.md');
    });

    it('should not save when switched off with nothing unsaved', async () => {
      await load();
      const save = vi.spyOn(index, 'save');

      component.unload();
      await waitForAllAsyncOperations();

      expect(save).not.toHaveBeenCalled();
    });
  });

  /**
   * Creates a note in the mocked vault and forgets whatever its creation made the component record, so a
   * test starts from a note this module has never seen and decides itself which events it gets to see.
   *
   * @param path - The note's path.
   * @param content - Its content.
   * @returns The note.
   */
  function createNote(path: string, content = ''): TFile {
    const file = app.vault.createSync__(path, content);
    index.delete(path);
    return file;
  }

  function getFile(path: string): TFileOriginal {
    return castTo<TFileOriginal>(app.vault.getFileByPath(path));
  }

  async function load(): Promise<void> {
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await setTimeoutAsync(0);
    await waitForAllAsyncOperations();
  }

  function seenOf(path: string): (null | number)[] {
    return index.get(path)?.headings.map((heading) => heading.seen) ?? [];
  }

  function snapshotsAt(lines: readonly number[]): HeadingSnapshot[] {
    return lines.map((line) => ({ bodyHash: '', level: 1, line, subtreeHash: String(line), text: String(line) }));
  }

  function timesOf(path: string): RecordedTimes[] {
    return index.get(path)?.headings.map(({ created, modified, seen, text }) => ({ created, modified, seen, text })) ?? [];
  }

  function triggerChanged(file: TFile, content: string): void {
    app.metadataCache.trigger('changed', file, content, app.metadataCache.getFileCache(file));
  }
});
