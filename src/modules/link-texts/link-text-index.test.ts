import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { LinkTextIndex } from './link-text-index.ts';

describe('LinkTextIndex', () => {
  it('should count each text across sources, most used first, then in code-unit order', () => {
    const index = new LinkTextIndex();

    index.setSource('C.md', [{ targetPath: 'Bravo.md', text: 'alpha' }, { targetPath: 'Bravo.md', text: 'alpha' }, { targetPath: 'Bravo.md', text: 'Zulu' }]);
    index.setSource('A.md', [{ targetPath: 'Bravo.md', text: 'alpha' }, { targetPath: 'Bravo.md', text: 'Echo' }]);

    expect(index.getLinkTexts('Bravo.md')).toEqual([
      { count: 3, sourcePaths: ['A.md', 'C.md'], text: 'alpha' },
      { count: 1, sourcePaths: ['A.md'], text: 'Echo' },
      { count: 1, sourcePaths: ['C.md'], text: 'Zulu' }
    ]);
    expect(index.getLinkTexts('Unknown.md')).toEqual([]);
  });

  it('should report only the targets a replacement changed', () => {
    const index = new LinkTextIndex();
    index.setSource('C.md', [{ targetPath: 'Bravo.md', text: 'alpha' }, { targetPath: 'Delta.md', text: 'echo' }]);

    expect(index.setSource('C.md', [{ targetPath: 'Delta.md', text: 'echo' }, { targetPath: 'Bravo.md', text: 'alpha' }])).toEqual([]);
    expect(index.setSource('C.md', [{ targetPath: 'Bravo.md', text: 'alpha' }, { targetPath: 'Bravo.md', text: 'alpha' }, { targetPath: 'Delta.md', text: 'echo' }])).toEqual(['Bravo.md']);
    expect(index.setSource('C.md', [{ targetPath: 'Delta.md', text: 'foxtrot' }])).toEqual(['Bravo.md', 'Delta.md']);
  });

  it('should forget a target once its last reference is gone', () => {
    const index = new LinkTextIndex();
    index.setSource('C.md', [{ targetPath: 'Bravo.md', text: 'alpha' }]);

    expect(index.deleteSource('C.md')).toEqual(['Bravo.md']);
    expect(index.getLinkTexts('Bravo.md')).toEqual([]);
    expect(index.getSourcePaths('C.md', false)).toEqual([]);
    expect(index.deleteSource('C.md')).toEqual([]);
  });

  it('should keep a text another source still uses', () => {
    const index = new LinkTextIndex();
    index.setSource('C.md', [{ targetPath: 'Bravo.md', text: 'alpha' }]);
    index.setSource('D.md', [{ targetPath: 'Bravo.md', text: 'alpha' }]);

    index.deleteSource('C.md');

    expect(index.getLinkTexts('Bravo.md')).toEqual([{ count: 1, sourcePaths: ['D.md'], text: 'alpha' }]);
  });

  it('should find sources and linking sources by path or under a folder', () => {
    const index = new LinkTextIndex();
    index.setSource('Folder/C.md', [{ targetPath: 'Folder/Bravo.md', text: 'alpha' }]);
    index.setSource('D.md', [{ targetPath: 'Folder/Bravo.md', text: 'echo' }, { targetPath: 'Other.md', text: 'x' }]);

    expect(index.getSourcePaths('Folder', true)).toEqual(['Folder/C.md']);
    expect(index.getSourcePaths('D.md', false)).toEqual(['D.md']);
    expect(index.getSourcePathsLinkingTo('Folder', true).sort()).toEqual(['D.md', 'Folder/C.md']);
    expect(index.getSourcePathsLinkingTo('Other.md', false)).toEqual(['D.md']);
  });

  it('should tell listeners about changes until they unsubscribe, and survive one that throws', () => {
    const index = new LinkTextIndex();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
      // Expected: the throwing listener is reported.
    });
    const failing = vi.fn(() => {
      throw new Error('listener failed');
    });
    const listener = vi.fn();
    index.onChange(failing);
    const unsubscribe = index.onChange(listener);

    index.notify([]);
    index.notify(['Bravo.md']);
    index.clear();
    index.setSource('C.md', [{ targetPath: 'Bravo.md', text: 'alpha' }]);
    index.clear();
    unsubscribe();
    index.notify(null);

    expect(listener.mock.calls).toEqual([[['Bravo.md']], [null]]);
    expect(consoleError).toHaveBeenCalledTimes(3);
    consoleError.mockRestore();
  });
});
