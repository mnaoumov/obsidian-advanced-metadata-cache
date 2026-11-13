import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { BlockMetadata } from '../../plugin-api.ts';

import { BlockMetadataIndex } from './block-metadata-index.ts';

const POSITION = { end: { col: 3, line: 3, offset: 30 }, start: { col: 0, line: 1, offset: 10 } };

describe('BlockMetadataIndex', () => {
  it('should answer copies of a note\'s fences, and empty for a note with none', () => {
    const index = new BlockMetadataIndex();
    index.setPath('Alpha.md', [entry({ status: 'done' })]);

    const answer = index.getBlockMetadata('Alpha.md');
    expect(answer).toEqual([entry({ status: 'done' })]);
    expect(answer[0]).not.toBe(index.getBlockMetadata('Alpha.md')[0]);
    expect(index.getBlockMetadata('Bravo.md')).toEqual([]);
  });

  it('should find fences by property and by value, as frontmatter values are matched', () => {
    const index = new BlockMetadataIndex();
    const alpha = [entry({ priority: 2, status: 'done' }), entry({ status: ['open', true] }), entry(null), entry({ other: 1 })];
    index.setPath('Bravo.md', [entry({ status: null })]);
    index.setPath('Alpha.md', alpha);

    expect(index.getBlockMetadataWithProperty('status').map((match) => match.path)).toEqual(['Alpha.md', 'Alpha.md', 'Bravo.md']);
    expect(index.getBlockMetadataWithProperty('status', 'done')).toEqual([{ blockMetadata: alpha[0], path: 'Alpha.md' }]);
    expect(index.getBlockMetadataWithProperty('status', 'open')).toEqual([{ blockMetadata: alpha[1], path: 'Alpha.md' }]);
    expect(index.getBlockMetadataWithProperty('status', 'true')).toHaveLength(1);
    expect(index.getBlockMetadataWithProperty('priority', '2')).toHaveLength(1);
    expect(index.getBlockMetadataWithProperty('status', 'null')).toEqual([]);
    expect(index.getBlockMetadataWithProperty('missing')).toEqual([]);
  });

  it('should replace a note\'s fences, dropping property names it no longer has, and tell listeners only of a real change', () => {
    const index = new BlockMetadataIndex();
    const listener = vi.fn();
    const unsubscribe = index.onChange(listener);

    index.setPath('Alpha.md', [entry({ status: 'done' })]);
    index.setPath('Alpha.md', [entry({ status: 'done' })]);
    index.setPath('Alpha.md', [entry({ owner: 'me' })]);
    index.deletePath('Alpha.md');
    unsubscribe();
    index.clear();

    expect(listener.mock.calls).toEqual([[['Alpha.md']], [['Alpha.md']], [['Alpha.md']]]);
    expect(index.getBlockMetadataWithProperty('status')).toEqual([]);
    expect(index.getBlockMetadataWithProperty('owner')).toEqual([]);
    expect(index.getPaths('Alpha.md', false)).toEqual([]);
  });

  it('should list paths at a file or under a folder, and move a note\'s fences on a rename', () => {
    const index = new BlockMetadataIndex();
    index.setPath('Folder/Alpha.md', [entry({ status: 'done' })]);
    index.setPath('Bravo.md', [entry({ status: 'done' })]);

    expect(index.getPaths('Folder', true)).toEqual(['Folder/Alpha.md']);
    expect(index.getPaths('Bravo.md', false)).toEqual(['Bravo.md']);

    index.movePath('Folder/Alpha.md', 'Moved/Alpha.md');

    expect(index.getBlockMetadataWithProperty('status').map((match) => match.path)).toEqual(['Bravo.md', 'Moved/Alpha.md']);
  });

  it('should forget everything on clear, and tell listeners any note may have changed', () => {
    const index = new BlockMetadataIndex();
    index.setPath('Alpha.md', [entry({ status: 'done' })]);
    const listener = vi.fn();
    index.onChange(listener);

    index.clear();

    expect(listener).toHaveBeenCalledWith(null);
    expect(index.getBlockMetadata('Alpha.md')).toEqual([]);
    expect(index.getBlockMetadataWithProperty('status')).toEqual([]);
  });
});

function entry(properties: BlockMetadata['properties']): BlockMetadata {
  return { error: properties ? null : 'bad', position: POSITION, properties, target: null };
}
