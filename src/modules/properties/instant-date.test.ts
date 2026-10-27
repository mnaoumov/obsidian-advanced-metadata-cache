import {
  describe,
  expect,
  it
} from 'vitest';

import {
  getInstantPeriod,
  readInstantBound,
  validateTimeZone
} from './instant-date.ts';

describe('instant dates', () => {
  it.each([
    ['2026-03-08T02:30', 'America/New_York', '2026-03-08T07:30:00.000Z'],
    ['2026-11-01T01:30', 'America/New_York', '2026-11-01T05:30:00.000Z'],
    ['2026-10-25T03:30[Europe/Kyiv]', 'UTC', '2026-10-25T00:30:00.000Z'],
    ['2026-03-29T03:30[Europe/Kyiv]', 'UTC', '2026-03-29T01:30:00.000Z'],
    ['2026-10-26T23:00-0600[Europe/Kyiv]', 'UTC', '2026-10-27T05:00:00.000Z'],
    ['2026-10-26T23:00[+02:00]', 'UTC', '2026-10-26T21:00:00.000Z'],
    ['2011-12-30T12:00', 'Pacific/Apia', '2011-12-30T22:00:00.000Z'],
    ['2026-10-04T02:15', 'Australia/Lord_Howe', '2026-10-03T15:45:00.000Z']
  ])('converts %s in %s with compatible disambiguation', (value, zone, expected) => {
    expect(new Date(getInstantPeriod({ fallbackZone: zone, value }).start).toISOString()).toBe(expected);
  });

  it('spans a 23-hour calendar day across spring forward', () => {
    const period = getInstantPeriod({ fallbackZone: 'America/New_York', value: '2026-03-08' });
    expect(new Date(period.start).toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(new Date(period.end).toISOString()).toBe('2026-03-09T03:59:59.999Z');
  });

  it('spans a whole reduced-precision month and year', () => {
    expect(new Date(getInstantPeriod({ fallbackZone: 'UTC', value: '2024-02' }).end).toISOString()).toBe('2024-02-29T23:59:59.999Z');
    expect(new Date(getInstantPeriod({ fallbackZone: 'UTC', value: '2024' }).end).toISOString()).toBe('2024-12-31T23:59:59.999Z');
  });

  it('converts ISO year zero through Intl eras', () => {
    expect(new Date(getInstantPeriod({ fallbackZone: 'Etc/UTC', value: '0000-01-02T00:00' }).start).toISOString()).toBe('0000-01-02T00:00:00.000Z');
  });

  it.each(['2026-02-31', 'not a date'])('rejects an impossible local calendar value %s', (value) => {
    expect(() => getInstantPeriod({ fallbackZone: 'UTC', value })).toThrow(RangeError);
  });

  it('bounds the formatter cache while preserving conversions', () => {
    for (const zone of Intl.supportedValuesOf('timeZone').slice(0, 34)) {
      validateTimeZone(zone);
    }
    expect(new Date(getInstantPeriod({ fallbackZone: 'Europe/Kyiv', value: '2026-10-27T06:00' }).start).toISOString()).toBe('2026-10-27T04:00:00.000Z');
  });

  it.each(['2026', '2026-10-27', '2026-10-27T10:00', 'garbage', '2026-13-01T10:00Z', '2026-02-31T00:00Z'])('rejects an incomplete or invalid UTC bound %s', (value) => {
    expect(() => readInstantBound(value)).toThrow(RangeError);
  });
});
