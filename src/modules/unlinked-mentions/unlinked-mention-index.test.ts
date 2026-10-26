import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import {
  getNameKey,
  UnlinkedMentionIndex
} from './unlinked-mention-index.ts';

describe('UnlinkedMentionIndex', () => {
  let index: UnlinkedMentionIndex;

  beforeEach(() => {
    index = new UnlinkedMentionIndex();
  });

  it('should key a name by its canonical tokens', () => {
    expect(getNameKey('Foo-bar')).toBe('FOO BAR');
    expect(getNameKey('東京')).toBeNull();
  });

  it('should list the clean keys and a note\'s mention keys, and restore them without a scan', () => {
    index.setNames('Alpha.md', ['Alpha']);
    index.setNames('Beta.md', ['Beta']);
    const marker = index.beginFullScan();
    index.setText('One.md', 'alpha beta');
    index.completeFullScan(marker);
    index.setNames('Gamma.md', ['Gamma']);

    expect(index.getCleanKeys()).toEqual(['ALPHA', 'BETA']);
    expect(index.getMentionKeys('One.md')).toEqual(['ALPHA', 'BETA']);
    expect(index.getMentionKeys('Two.md')).toEqual([]);

    const restored = new UnlinkedMentionIndex();
    restored.setNames('Alpha.md', ['Alpha']);
    restored.restoreText('One.md', ['ALPHA', 'BETA']);
    expect(restored.getCandidatePaths(['Alpha'])).toBeNull();

    restored.markClean(['ALPHA']);
    expect(restored.getCandidatePaths(['Alpha'])).toEqual(new Set(['One.md']));
    expect(restored.getMentionKeys('One.md')).toEqual(['ALPHA']);
  });

  it('should answer null for a name that is dirty, unknown or not indexable', () => {
    index.setNames('Alpha.md', ['Alpha']);

    expect(index.getCandidatePaths(['Alpha'])).toBeNull();
    expect(index.getCandidatePaths(['Unknown'])).toBeNull();
    expect(index.getCandidatePaths(['東京'])).toBeNull();
  });

  it('should list the notes whose text holds a name once a full scan has cleaned it', () => {
    index.setNames('Alpha.md', ['Alpha', 'First Name']);
    index.setNames('Beta.md', ['Beta']);
    const marker = index.beginFullScan();
    index.setText('One.md', 'about alpha and beta');
    index.setText('Two.md', 'the first   NAME, then first');
    index.setText('Three.md', 'nothing');
    index.completeFullScan(marker);

    expect(index.getCandidatePaths(['Alpha'])).toEqual(new Set(['One.md']));
    expect(index.getCandidatePaths(['Alpha', 'First Name'])).toEqual(new Set(['One.md', 'Two.md']));
    expect(index.getCandidatePaths(['Beta'])).toEqual(new Set(['One.md']));
  });

  it('should keep a name that appeared during a scan dirty, and clean it with the next', () => {
    index.setNames('Alpha.md', ['Alpha']);
    const marker = index.beginFullScan();
    index.setNames('Gamma.md', ['Gamma']);
    index.completeFullScan(marker);

    expect(index.getCandidatePaths(['Alpha'])).toEqual(new Set());
    expect(index.getCandidatePaths(['Gamma'])).toBeNull();

    const nextMarker = index.beginFullScan();
    index.setText('One.md', 'gamma');
    index.completeFullScan(nextMarker);

    expect(index.getCandidatePaths(['Gamma'])).toEqual(new Set(['One.md']));
  });

  it('should update what a note mentions when its text changes, and forget it when removed', () => {
    cleanNames({ 'Alpha.md': ['Alpha'], 'Beta.md': ['Beta'] });
    index.setText('One.md', 'alpha');
    index.setText('One.md', 'beta');

    expect(index.getCandidatePaths(['Alpha'])).toEqual(new Set());
    expect(index.getCandidatePaths(['Beta'])).toEqual(new Set(['One.md']));

    index.removeText('One.md');
    expect(index.getCandidatePaths(['Beta'])).toEqual(new Set());
  });

  it('should keep a name shared by two notes until both drop it, and forget its mentions then', () => {
    cleanNames({ 'A/Same.md': ['Same'], 'B/Same.md': ['Same', 'Other'] });
    index.setText('One.md', 'same other');

    index.removeNames('A/Same.md');
    expect(index.getCandidatePaths(['Same'])).toEqual(new Set(['One.md']));

    index.setNames('B/Same.md', ['Other']);
    expect(index.getCandidatePaths(['Same'])).toBeNull();
    expect(index.getCandidatePaths(['Other'])).toEqual(new Set(['One.md']));

    index.removeNames('B/Same.md');
    expect(index.getCandidatePaths(['Other'])).toBeNull();
  });

  it('should prune a removed name from the trie without losing a longer name through it', () => {
    cleanNames({ 'Long.md': ['Foo Bar Baz'], 'Short.md': ['Foo'] });
    index.removeNames('Short.md');
    index.setText('One.md', 'foo bar baz');

    expect(index.getCandidatePaths(['Foo Bar Baz'])).toEqual(new Set(['One.md']));
  });

  it('should move what a note mentions to its new path', () => {
    cleanNames({ 'Alpha.md': ['Alpha'] });
    index.setText('One.md', 'alpha');
    index.renameText('One.md', 'Renamed.md');
    index.renameText('Missing.md', 'Elsewhere.md');

    expect(index.getCandidatePaths(['Alpha'])).toEqual(new Set(['Renamed.md']));
  });

  it('should forget the names and texts under a folder', () => {
    cleanNames({ 'Folder/Alpha.md': ['Alpha'], 'Other.md': ['Other'] });
    index.setText('Folder/One.md', 'other');
    index.setText('Folder2/Two.md', 'other');

    index.removeSubtree('Folder');

    expect(index.getCandidatePaths(['Alpha'])).toBeNull();
    expect(index.getCandidatePaths(['Other'])).toEqual(new Set(['Folder2/Two.md']));
  });

  it('should forget everything when cleared', () => {
    cleanNames({ 'Alpha.md': ['Alpha'] });
    index.setText('One.md', 'alpha');
    index.clear();

    expect(index.getCandidatePaths(['Alpha'])).toBeNull();
  });

  function cleanNames(namesByPath: Record<string, string[]>): void {
    for (const [path, names] of Object.entries(namesByPath)) {
      index.setNames(path, names);
    }

    index.completeFullScan(index.beginFullScan());
  }
});
