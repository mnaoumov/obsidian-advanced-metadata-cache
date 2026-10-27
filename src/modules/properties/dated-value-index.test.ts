import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type { DatedValue } from '../../plugin-api.ts';

import {
  DatedValueIndex,
  getLocalDateValue,
  isDateValue,
  isReducedPrecisionDateValue
} from './dated-value-index.ts';

describe('isDateValue', () => {
  it.each([
    '2026-10-26',
    '2026-10-26T09:30',
    '2026-10-26T09:30:15',
    '2026-10-26T09:30:15.123',
    '0001-01-01',
    '2026-10-26T09:30Z',
    '2026-10-26T09:30z',
    '2026-10-26T00:21:46-06:00',
    '2026-10-26T09:30+0200',
    '2026-10-26T09:30:15.123+02:00[Europe/Kyiv]',
    '2026-10-26T09:30[Europe/Kyiv]',
    '2026-10-26T09:30[!America/Argentina/Buenos_Aires]',
    '2026-10-26T09:30[+02:00]'
  ])('should count %s as a date', (value) => {
    expect(isDateValue(value)).toBe(true);
  });

  it.each([
    '2026-10',
    '2026-13-01',
    '2026-10-32',
    '2026-10-26T24:00',
    '2026-10-26 09:30',
    '2026-10-26Z',
    '2026-10-26+02:00',
    '2026-10-26[Europe/Kyiv]',
    '2026-10-26T09:30+24:00',
    '2026-10-26T09:30 Europe/Kyiv',
    '2026-10-26T09:30[Europe Kyiv]',
    '2026-10-26T09:30[Europe/Kyiv][u-ca=iso8601]',
    '14:30',
    '26-10-2026',
    '[[2026-10-26]]'
  ])('should not count %s as a date', (value) => {
    expect(isDateValue(value)).toBe(false);
  });
});

describe('getLocalDateValue', () => {
  it.each([
    ['2026-10-26', '2026-10-26'],
    ['2026-10-26T09:30', '2026-10-26T09:30'],
    ['2026-10-26T00:21:46-06:00', '2026-10-26T00:21:46'],
    ['2026-10-26T09:30:15.123Z', '2026-10-26T09:30:15.123'],
    ['2026-10-26T09:30+02:00[Europe/Kyiv]', '2026-10-26T09:30']
  ])('should read %s as %s', (value, localValue) => {
    expect(getLocalDateValue(value)).toBe(localValue);
  });

  it('should read a reduced-precision value as itself, never padded', () => {
    expect(getLocalDateValue('2019')).toBe('2019');
    expect(getLocalDateValue('2019-05')).toBe('2019-05');
  });

  it('should answer null for a value that is not a date', () => {
    expect(getLocalDateValue('14:30')).toBeNull();
  });
});

describe('isReducedPrecisionDateValue', () => {
  it.each(['2019', '2019-05', '0001', '2019-12'])('should count %s as a reduced-precision date', (value) => {
    expect(isReducedPrecisionDateValue(value)).toBe(true);
  });

  it.each(['2019-13', '2019-00', '2019-5', '201', '20190', '2019-05-01', '2019T10:00', '2019-05Z', '-2019', '2019.5'])('should not count %s', (value) => {
    expect(isReducedPrecisionDateValue(value)).toBe(false);
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

  it('should order and match a zoned value by its local part, and report it as written', () => {
    add('A.md', 'ctime', '2026-10-26T23:00-06:00');
    add('B.md', 'ctime', '2026-10-26T09:00+02:00[Europe/Kyiv]');
    add('C.md', 'ctime', '2026-10-26T09:00');
    add('D.md', 'ctime', '2026-10-27T01:00Z');

    expect(getValues({ from: '2026-10-26', to: '2026-10-26' })).toEqual([
      'C.md ctime 2026-10-26T09:00',
      'B.md ctime 2026-10-26T09:00+02:00[Europe/Kyiv]',
      'A.md ctime 2026-10-26T23:00-06:00'
    ]);
    expect(getValues({ from: '10-27', isRecurring: true })).toEqual(['D.md ctime 2026-10-27T01:00Z']);

    index.remove({ path: 'A.md', propertyName: 'ctime', value: '2026-10-26T23:00-06:00' });
    expect(getValues({ to: '2026-10-26' })).toEqual([
      'C.md ctime 2026-10-26T09:00',
      'B.md ctime 2026-10-26T09:00+02:00[Europe/Kyiv]'
    ]);
  });

  it('should keep only the properties asked about', () => {
    add('A.md', 'birthday', '1990-10-26');
    add('A.md', 'due', '2026-10-26');

    expect(index.getDatedValues({}, { isDateProperty: () => true, isIncluded: (propertyName) => propertyName === 'due' })).toEqual([{ path: 'A.md', propertyName: 'due', value: '2026-10-26' }]);
  });

  it('should place a reduced-precision value at the start of its period, and report it as written', () => {
    add('A.md', 'closed', '2019-01-01');
    add('B.md', 'closed', '2019');
    add('C.md', 'closed', '2019-05-01');
    add('D.md', 'closed', '2019-05');
    add('E.md', 'closed', '2018-12-31T23:59');

    expect(getValues({})).toEqual([
      'E.md closed 2018-12-31T23:59',
      'B.md closed 2019',
      'A.md closed 2019-01-01',
      'D.md closed 2019-05',
      'C.md closed 2019-05-01'
    ]);
  });

  it('should match a reduced-precision value with every range its period overlaps', () => {
    add('Year.md', 'closed', '2019');
    add('Month.md', 'closed', '2019-05');
    add('Day.md', 'closed', '2019-03-15');
    add('Before.md', 'closed', '2019-02-28');

    expect(getValues({ from: '2019-03-01', to: '2019-06-30' })).toEqual(['Year.md closed 2019', 'Day.md closed 2019-03-15', 'Month.md closed 2019-05']);
    expect(getValues({ from: '2019-05-10', to: '2019-05-20' })).toEqual(['Year.md closed 2019', 'Month.md closed 2019-05']);
    expect(getValues({ from: '2019-05-10T08:00' })).toEqual(['Year.md closed 2019', 'Month.md closed 2019-05']);
    expect(getValues({ to: '2019-01' })).toEqual(['Year.md closed 2019']);
    expect(getValues({ from: '2019-06', to: '2019-12-31' })).toEqual(['Year.md closed 2019']);
    expect(getValues({ from: '2019', to: '2019' })).toEqual(['Year.md closed 2019', 'Before.md closed 2019-02-28', 'Day.md closed 2019-03-15', 'Month.md closed 2019-05']);
    expect(getValues({ from: '2020' })).toEqual([]);
    expect(getValues({ to: '2018-12-31' })).toEqual([]);
    expect(getValues({ from: '2019-05-10', to: '2018' })).toEqual([]);
  });

  it('should leave a year alone out of a recurring range, and match a month by overlap', () => {
    add('Year.md', 'closed', '2019');
    add('May.md', 'closed', '2019-05');
    add('Dec.md', 'closed', '2018-12');
    add('Day.md', 'closed', '2020-05-15');

    expect(getValues({ isRecurring: true })).toEqual(['May.md closed 2019-05', 'Day.md closed 2020-05-15', 'Dec.md closed 2018-12']);
    expect(getValues({ from: '05-10', isRecurring: true, to: '05-20' })).toEqual(['May.md closed 2019-05', 'Day.md closed 2020-05-15']);
    expect(getValues({ from: '05-16', isRecurring: true, to: '06' })).toEqual(['May.md closed 2019-05']);
    expect(getValues({ from: '12-20', isRecurring: true, to: '01-05' })).toEqual(['Dec.md closed 2018-12']);
    expect(getValues({ from: '06', isRecurring: true, to: '11' })).toEqual([]);

    index.remove({ path: 'Year.md', propertyName: 'closed', value: '2019' });
    index.remove({ path: 'May.md', propertyName: 'closed', value: '2019-05' });

    expect(getValues({})).toEqual(['Dec.md closed 2018-12', 'Day.md closed 2020-05-15']);
    expect(getValues({ isRecurring: true })).toEqual(['Day.md closed 2020-05-15', 'Dec.md closed 2018-12']);
  });

  it('should count a reduced-precision value only in a property the caller calls a date property', () => {
    add('A.md', 'pages', '1500');
    add('A.md', 'pages', '2026-10-26');
    add('A.md', 'closed', '2019');

    expect(index.getDatedValues({}, { isDateProperty: (propertyName) => propertyName === 'closed', isIncluded: () => true }).map((entry) => format(entry))).toEqual([
      'A.md closed 2019',
      'A.md pages 2026-10-26'
    ]);
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
    const [entry] = index.getDatedValues({}, { isDateProperty: () => true, isIncluded: () => true });
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
    return index.getDatedValues(query, { isDateProperty: () => true, isIncluded: () => true }).map((entry) => format(entry));
  }
});
