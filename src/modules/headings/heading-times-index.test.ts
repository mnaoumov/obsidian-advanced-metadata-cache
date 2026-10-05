import type { App as AppOriginal } from 'obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsComponent } from '../../plugin-settings-component.ts';
import type { HeadingSnapshot } from './heading-snapshot.ts';
import type { HeadingTimesRecord } from './heading-times-index.ts';

import { PluginSettings } from '../../plugin-settings.ts';
import {
  advanceHeadingTimes,
  HeadingTimesIndex
} from './heading-times-index.ts';

const DATA_FILE_PATH = 'heading-times.json';

describe('advanceHeadingTimes', () => {
  it('should start a note not tracked before with no times at all', () => {
    expect(advanceHeadingTimes({ previous: null, snapshots: [snapshot('A')], time: 5 })).toEqual([
      { ...snapshot('A'), created: null, modified: null, seen: null }
    ]);
  });

  it('should stamp a heading that continues nothing as created and modified now', () => {
    expect(advanceHeadingTimes({ previous: [], snapshots: [snapshot('A')], time: 5 })).toEqual([
      { ...snapshot('A'), created: 5, modified: 5, seen: null }
    ]);
  });

  it('should carry the times of a continued heading over, and stamp it modified only when its section changed', () => {
    const previous = [record('A', { created: 1, modified: 2, seen: 3 }), record('B', { created: 1, modified: 2, seen: 3 })];
    const snapshots = [snapshot('A'), snapshot('B', 'changed')];

    expect(advanceHeadingTimes({ previous, snapshots, time: 9 })).toEqual([
      { ...snapshot('A'), created: 1, modified: 2, seen: 3 },
      { ...snapshot('B', 'changed'), created: 1, modified: 9, seen: 3 }
    ]);
  });
});

describe('HeadingTimesIndex', () => {
  let app: App;
  let index: HeadingTimesIndex;
  let settings: PluginSettings;

  beforeEach(() => {
    app = App.createConfigured__();
    settings = new PluginSettings();
    settings.isHeadingsModuleEnabled = true;
    index = new HeadingTimesIndex({
      app: castTo<AppOriginal>(app),
      getDataFilePath: (): string => DATA_FILE_PATH,
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings })
    });
  });

  it('should answer a tracked note from its records', () => {
    const file = app.vault.createSync__('Alpha.md', '# A\n');
    index.record({ mtime: 1, path: 'Alpha.md', snapshots: [snapshot('A')], time: 1 });

    expect(index.getHeadingTimes(castTo<never>(file))).toEqual([
      { created: null, heading: 'A', level: 1, line: 0, modified: null, seen: null }
    ]);
  });

  it('should answer an untracked note with its current headings and no times', () => {
    const file = app.vault.createSync__('Alpha.md', '# A\n## B\n');

    expect(index.getHeadingTimes(castTo<never>(file))).toEqual([
      { created: null, heading: 'A', level: 1, line: 0, modified: null, seen: null },
      { created: null, heading: 'B', level: 2, line: 1, modified: null, seen: null }
    ]);
  });

  it('should answer nothing for an untracked note without a cache', () => {
    const file = app.vault.createSync__('Alpha.txt', 'text');

    expect(index.getHeadingTimes(castTo<never>(file))).toEqual([]);
  });

  it('should answer nothing while the module is off', () => {
    const file = app.vault.createSync__('Alpha.md', '# A\n');
    settings.isHeadingsModuleEnabled = false;

    expect(index.getHeadingTimes(castTo<never>(file))).toEqual([]);
  });

  it('should become dirty on a change and clean on a save, and save what it held', async () => {
    expect(index.isDirty).toBe(false);
    index.record({ mtime: 1, path: 'Alpha.md', snapshots: [snapshot('A')], time: 1 });
    expect(index.isDirty).toBe(true);

    const savePromise = index.save();
    index.clear();
    await savePromise;

    expect(index.isDirty).toBe(false);
    await index.load();
    expect(index.get('Alpha.md')?.headings.map((heading) => heading.text)).toEqual(['A']);
  });

  it('should load an empty index when there is no file', async () => {
    index.record({ mtime: 1, path: 'Alpha.md', snapshots: [], time: 1 });
    await index.load();

    expect(index.getPaths()).toEqual([]);
  });

  it.each([
    ['not JSON', '{'],
    ['another version', JSON.stringify({ notes: {}, version: 2 })],
    ['notes that are not an object', JSON.stringify({ notes: null, version: 1 })],
    ['a bare value', '5']
  ])('should load an empty index from a file holding %s', async (_name, json) => {
    await app.vault.adapter.write(DATA_FILE_PATH, json);
    await index.load();

    expect(index.getPaths()).toEqual([]);
  });

  it('should keep the well-formed notes of a file and drop the rest', async () => {
    const good = { headings: [record('A', { created: 1, modified: null, seen: 2 })], mtime: 1 };
    await app.vault.adapter.write(
      DATA_FILE_PATH,
      JSON.stringify({
        notes: {
          'Bad heading.md': { headings: [{ ...good.headings[0], created: 'yesterday' }], mtime: 1 },
          'Bad headings.md': { headings: 'none', mtime: 1 },
          'Bad mtime.md': { headings: [], mtime: 'now' },
          'Good.md': good,
          'Null.md': null,
          'Null heading.md': { headings: [null], mtime: 1 }
        },
        version: 1
      })
    );

    await index.load();

    expect(index.getPaths()).toEqual(['Good.md']);
    expect(index.get('Good.md')).toEqual(good);
  });

  it('should forget a note, and a whole folder of them', () => {
    index.record({ mtime: 1, path: 'A.md', snapshots: [], time: 1 });
    index.record({ mtime: 1, path: 'Folder/B.md', snapshots: [], time: 1 });
    index.record({ mtime: 1, path: 'Folder/Sub/C.md', snapshots: [], time: 1 });
    index.record({ mtime: 1, path: 'Folder2/D.md', snapshots: [], time: 1 });

    index.delete('A.md');
    index.deleteSubtree('Folder');

    expect(index.getPaths()).toEqual(['Folder2/D.md']);
  });

  it('should stay clean when forgetting a note it never tracked', async () => {
    index.record({ mtime: 1, path: 'A.md', snapshots: [], time: 1 });
    await index.save();
    index.delete('Never.md');

    expect(index.isDirty).toBe(false);
  });

  it('should move a note, and a whole folder of them, to the new path', () => {
    index.record({ mtime: 1, path: 'A.md', snapshots: [snapshot('A')], time: 1 });
    index.record({ mtime: 1, path: 'Folder/B.md', snapshots: [], time: 1 });
    index.record({ mtime: 1, path: 'Folder/Sub/C.md', snapshots: [], time: 1 });

    index.rename('A.md', 'Renamed.md');
    index.rename('Never.md', 'Still never.md');
    index.renameSubtree('Folder', 'Moved');

    expect(index.getPaths().sort()).toEqual(['Moved/B.md', 'Moved/Sub/C.md', 'Renamed.md']);
    expect(index.get('Renamed.md')?.headings.map((heading) => heading.text)).toEqual(['A']);
  });

  it('should track a new note empty, dropping whatever the path held before', () => {
    index.trackEmpty('New.md', 1);
    index.record({ mtime: 1, path: 'Old.md', snapshots: [snapshot('A')], time: 1 });
    index.trackEmpty('Old.md', 2);

    expect(index.get('New.md')).toEqual({ headings: [], mtime: 1 });
    expect(index.get('Old.md')).toEqual({ headings: [], mtime: 2 });
  });

  describe('markSeen', () => {
    beforeEach(() => {
      index.record({
        mtime: 1,
        path: 'A.md',
        snapshots: [snapshot('One', '', 0), snapshot('Two', '', 10), snapshot('Three', '', 20)],
        time: 1
      });
    });

    it('should stamp every heading whose own section overlaps the range, and only those', () => {
      index.markSeen({ fromLine: 9, path: 'A.md', time: 7, toLine: 12 });

      expect(index.get('A.md')?.headings.map((heading) => heading.seen)).toEqual([7, 7, null]);
    });

    it('should stamp the last heading through the end of the note', () => {
      index.markSeen({ fromLine: 500, path: 'A.md', time: 7, toLine: 600 });

      expect(index.get('A.md')?.headings.map((heading) => heading.seen)).toEqual([null, null, 7]);
    });

    it('should change nothing when nothing new was seen', async () => {
      index.markSeen({ fromLine: 0, path: 'A.md', time: 7, toLine: 0 });
      await index.save();
      const before = index.get('A.md');

      index.markSeen({ fromLine: 0, path: 'A.md', time: 7, toLine: 0 });

      expect(index.isDirty).toBe(false);
      expect(index.get('A.md')).toBe(before);
    });

    it('should ignore a note it does not track', () => {
      index.markSeen({ fromLine: 0, path: 'Never.md', time: 7, toLine: 0 });

      expect(index.get('Never.md')).toBeUndefined();
    });
  });
});

function record(text: string, times: Pick<HeadingTimesRecord, 'created' | 'modified' | 'seen'>): HeadingTimesRecord {
  return { ...snapshot(text), ...times };
}

function snapshot(text: string, body = '', line = 0): HeadingSnapshot {
  return { bodyHash: '', level: 1, line, subtreeHash: `${text}:${body}`, text };
}
