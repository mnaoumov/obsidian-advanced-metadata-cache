import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type { DatedValue } from '../../plugin-api.ts';

import {
  DatedValueIndex,
  isDateValue
} from './dated-value-index.ts';

describe('isDateValue', () => {
  it.each([
    '2026-10-26',
    '2026-10-26T09:30',
    '2026-10-26T09:30:15',
    '2026-10-26T09:30:15.123',
    '0001-01-01'
  ])('should count %s as a date', (value) => {
    expect(isDateValue(value)).toBe(true);
  });

  it.each([
    '2026-10',
    '2026-13-01',
    '2026-10-32',
    '2026-10-26T24:00',
    '2026-10-26 09:30',
    '2026-10-26T09:30Z',
    '2026-10-26T09:30+02:00',
    '26-10-2026',
    '[[2026-10-26]]'
  ])('should not count %s as a date', (value) => {
    expect(isDateValue(value)).toBe(false);
  });
});

describe('DatedValueIndex', () => {
  let index: DatedValueIndex;

  beforeEach(() => {
    index = new DatedValueIndex();
  });

  it('should list every date in order, by value then property name then path, and skip non-dates', () => {
    add('B.md', 'birthday', '1990-10-26');
    add('A.md', 'birthday', '1990-10-26');
    add('A.md', 'anniversary', '1990-10-26');
    add('C.md', 'due', '2026-01-02T10:00');
    add('C.md', 'due', '2026-01-02');
    add('D.md', 'status', 'done');

    expect(getValues({})).toEqual([
      'A.md anniversary 1990-10-26',
      'A.md birthday 1990-10-26',
      'B.md birthday 1990-10-26',
      'C.md due 2026-01-02',
      'C.md due 2026-01-02T10:00'
    ]);
  });

  it('should answer a range with inclusive bounds compared as prefixes', () => {
    for (const value of ['2025-12-31T23:59', '2026-01-01', '2026-10-31', '2026-10-31T23:59', '2026-11-01']) {
      add('A.md', 'due', value);
    }

    expect(getValues({ from: '2026', to: '2026-10' })).toEqual(['A.md due 2026-01-01', 'A.md due 2026-10-31', 'A.md due 2026-10-31T23:59']);
    expect(getValues({ from: '2026-10-31', to: '2026-10-31' })).toEqual(['A.md due 2026-10-31', 'A.md due 2026-10-31T23:59']);
    expect(getValues({ to: '2025' })).toEqual(['A.md due 2025-12-31T23:59']);
    expect(getValues({ from: '2026-11' })).toEqual(['A.md due 2026-11-01']);
    expect(getValues({ from: '2027', to: '2026' })).toEqual([]);
  });

  it('should answer a recurring range by month and day, ordered by month and day then year, wrapping the year end', () => {
    add('Ann.md', 'birthday', '1990-12-20');
    add('Bob.md', 'birthday', '1985-01-05');
    add('Cid.md', 'birthday', '2001-10-26');
    add('Dee.md', 'birthday', '1970-10-26');
    add('Eve.md', 'birthday', '1999-02-29');

    expect(getValues({ from: '10-26', isRecurring: true, to: '11-25' })).toEqual(['Dee.md birthday 1970-10-26', 'Cid.md birthday 2001-10-26']);
    expect(getValues({ from: '12-15', isRecurring: true, to: '01-15' })).toEqual(['Ann.md birthday 1990-12-20', 'Bob.md birthday 1985-01-05']);
    expect(getValues({ from: '02', isRecurring: true, to: '02' })).toEqual(['Eve.md birthday 1999-02-29']);
    expect(getValues({ from: '10-26', isRecurring: true, to: '10' })).toEqual(['Dee.md birthday 1970-10-26', 'Cid.md birthday 2001-10-26']);
    expect(getValues({ isRecurring: true })).toEqual([
      'Bob.md birthday 1985-01-05',
      'Eve.md birthday 1999-02-29',
      'Dee.md birthday 1970-10-26',
      'Cid.md birthday 2001-10-26',
      'Ann.md birthday 1990-12-20'
    ]);
  });

  it('should keep only the properties asked about', () => {
    add('A.md', 'birthday', '1990-10-26');
    add('A.md', 'due', '2026-10-26');

    expect(index.getDatedValues({}, (propertyName) => propertyName === 'due')).toEqual([{ path: 'A.md', propertyName: 'due', value: '2026-10-26' }]);
  });

  it('should forget a removed entry, ignore a repeat, and forget everything on clear', () => {
    add('A.md', 'due', '2026-10-26');
    add('A.md', 'due', '2026-10-26');
    add('B.md', 'due', '2026-10-26');
    index.remove({ path: 'A.md', propertyName: 'due', value: '2026-10-26' });
    index.remove({ path: 'Z.md', propertyName: 'due', value: '2026-10-26' });
    index.remove({ path: 'A.md', propertyName: 'due', value: 'not a date' });

    expect(getValues({})).toEqual(['B.md due 2026-10-26']);
    expect(getValues({ isRecurring: true })).toEqual(['B.md due 2026-10-26']);

    index.clear();

    expect(getValues({})).toEqual([]);
    expect(getValues({ isRecurring: true })).toEqual([]);
  });

  it('should hand out copies, so a caller writing to an answer changes nothing', () => {
    add('A.md', 'due', '2026-10-26');
    const [entry] = index.getDatedValues({}, () => true);
    Object.assign(entry ?? {}, { path: 'Changed.md' });

    expect(getValues({})).toEqual(['A.md due 2026-10-26']);
  });

  function add(path: string, propertyName: string, value: string): void {
    index.add({ path, propertyName, value });
  }

  function format(entry: DatedValue): string {
    return `${entry.path} ${entry.propertyName} ${entry.value}`;
  }

  function getValues(query: Parameters<DatedValueIndex['getDatedValues']>[0]): string[] {
    return index.getDatedValues(query, () => true).map((entry) => format(entry));
  }
});
