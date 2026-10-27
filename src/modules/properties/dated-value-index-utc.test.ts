import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { DatedValuesQuery } from '../../plugin-api.ts';

import { DatedValueIndex } from './dated-value-index.ts';

describe('UTC date queries', () => {
  it('orders and bounds instants that cross the four-digit year boundary', () => {
    const index = new DatedValueIndex();
    index.add({ path: 'A.md', propertyName: 'date', value: '9999-12-31T20:00Z' });
    index.add({ path: 'B.md', propertyName: 'date', value: '9999-12-31T23:30-02:00' });
    expect(paths(index, { from: '9999-12-31T00:00Z', missingTimeZone: 'skip', to: '9999-12-31T23:59-23:59' })).toEqual(['A.md', 'B.md']);
  });

  it('retains zone-free periods at both ends of the four-digit calendar', () => {
    const index = new DatedValueIndex();
    index.add({ path: 'First.md', propertyName: 'date', value: '0000-01-01' });
    index.add({ path: 'Last.md', propertyName: 'date', value: '9999-12-31' });
    expect(paths(index, { from: '0000-01-01T00:00Z', missingTimeZone: 'utc', to: '0000-01-01T00:00Z' })).toEqual(['First.md']);
    expect(paths(index, { from: '9999-12-31T00:00Z', missingTimeZone: 'utc', to: '9999-12-31T23:59-23:59' })).toEqual(['Last.md']);
  });

  function createIndex(): DatedValueIndex {
    const index = new DatedValueIndex();
    for (
      const [path, value] of [
        ['Mexico.md', '2026-10-26T23:00-06:00'],
        ['Kyiv.md', '2026-10-27T07:00[Europe/Kyiv]'],
        ['Local.md', '2026-10-27T06:00'],
        ['Day.md', '2026-10-27'],
        ['Month.md', '2026-10'],
        ['Year.md', '2026'],
        ['Other.md', '2025-01-01']
      ]
    ) {
      if (path && value) {
        index.add({ path, propertyName: 'date', value });
      }
    }
    return index;
  }

  function paths(index: DatedValueIndex, query: DatedValuesQuery): string[] {
    return index.getDatedValues({ ...query, timeBasis: 'utc' }, () => true, () => true, 'UTC').map((entry) => entry.path);
  }

  it('matches equal instants in different zones with inclusive offset-bearing bounds', () => {
    expect(paths(createIndex(), { from: '2026-10-27T05:00Z', missingTimeZone: 'skip', to: '2026-10-27T07:00+02:00' })).toEqual(['Mexico.md', 'Kyiv.md']);
  });

  it('merges zoneless periods and times in instant order', () => {
    expect(paths(createIndex(), { from: '2026-10-27T05:00Z', missingTimeZone: 'utc', to: '2026-10-27T06:00Z' })).toEqual(['Year.md', 'Month.md', 'Day.md', 'Mexico.md', 'Kyiv.md', 'Local.md']);
  });

  it('uses the specified zone per query without rebuilding', () => {
    const index = createIndex();
    const query = { from: '2026-10-27T04:00Z', to: '2026-10-27T04:00Z' };
    expect(paths(index, { ...query, missingTimeZone: { zone: 'Europe/Kyiv' } })).toContain('Local.md');
    expect(paths(index, { ...query, missingTimeZone: 'utc' })).not.toContain('Local.md');
    expect(paths(index, { ...query, missingTimeZone: 'default' })).toEqual(paths(index, { ...query, missingTimeZone: 'utc' }));
  });

  it('fails only on zoneless values in range and in included properties', () => {
    const index = createIndex();
    expect(() => paths(index, { from: '2026-10-27T05:00Z', missingTimeZone: 'fail' })).toThrow(/Missing time zone.*2026/);
    expect(paths(index, { from: '2027-01-01T00:00Z', missingTimeZone: 'fail' })).toEqual([]);
    expect(index.getDatedValues({ missingTimeZone: 'fail', timeBasis: 'utc' }, () => false, () => true, 'UTC')).toEqual([]);
  });

  it('excludes reduced values in non-date properties and removes every view', () => {
    const index = createIndex();
    expect(index.getDatedValues({ missingTimeZone: 'utc', timeBasis: 'utc' }, () => true, () => false).some((entry) => entry.value === '2026')).toBe(false);
    index.remove({ path: 'Mexico.md', propertyName: 'date', value: '2026-10-26T23:00-06:00' });
    expect(paths(index, { missingTimeZone: 'skip' })).toEqual(['Kyiv.md']);
    index.clear();
    expect(paths(index, {})).toEqual([]);
  });

  it('keeps invalid zoned date shapes in the wall-clock view without breaking indexing or removal', () => {
    const index = new DatedValueIndex();
    for (const value of ['2026-02-31T12:00Z', '2026-10-27T06:00[Unknown/Zone]']) {
      const entry = { path: 'Invalid.md', propertyName: 'date', value };
      index.add(entry);
      expect(index.getDatedValues({}, () => true, () => true)).toContainEqual(entry);
      expect(paths(index, { missingTimeZone: 'skip' })).toEqual([]);
      index.remove(entry);
    }
  });

  it('uses the device zone when the setting and query zone are omitted', () => {
    const index = new DatedValueIndex();
    index.add({ path: 'Local.md', propertyName: 'date', value: '2026-10-27T06:00' });
    expect(index.getDatedValues({ timeBasis: 'utc' }, () => true, () => true)).toEqual([{ path: 'Local.md', propertyName: 'date', value: '2026-10-27T06:00' }]);
  });

  it('orders equal instants by original value, property, and path', () => {
    const index = new DatedValueIndex();
    for (const path of ['B.md', 'A.md']) {
      for (const propertyName of ['second', 'first']) {
        index.add({ path, propertyName, value: '2026-10-27T06:00Z' });
        index.add({ path, propertyName, value: '2026-10-27T06:00' });
      }
    }
    expect(index.getDatedValues({ missingTimeZone: 'utc', timeBasis: 'utc' }, () => true, () => true).map((entry) => `${entry.value} ${entry.propertyName} ${entry.path}`)).toEqual([
      '2026-10-27T06:00 first A.md',
      '2026-10-27T06:00 first B.md',
      '2026-10-27T06:00 second A.md',
      '2026-10-27T06:00 second B.md',
      '2026-10-27T06:00Z first A.md',
      '2026-10-27T06:00Z first B.md',
      '2026-10-27T06:00Z second A.md',
      '2026-10-27T06:00Z second B.md'
    ]);
  });

  it('propagates unexpected host failures instead of treating them as invalid user data', () => {
    const index = new DatedValueIndex();
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementationOnce((): never => {
      throw new Error('Host failure');
    });
    try {
      expect(() => {
        index.add({ path: 'Host.md', propertyName: 'date', value: '2026-10-27T06:00[America/Chicago]' });
      }).toThrow('Host failure');
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects recurring UTC queries, invalid zones and incomplete bounds', () => {
    const index = createIndex();
    expect(() => paths(index, { isRecurring: true })).toThrow(RangeError);
    expect(() => paths(index, { missingTimeZone: { zone: 'Invalid/Zone' } })).toThrow(RangeError);
    expect(() => paths(index, { from: '2026' })).toThrow(RangeError);
    expect(paths(index, { from: '2027-01-01T00:00Z', to: '2026-01-01T00:00Z' })).toEqual([]);
  });
});
