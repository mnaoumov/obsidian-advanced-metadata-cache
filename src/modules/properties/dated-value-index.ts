/**
 * @file
 *
 * The ordered half of the `Properties` module: every date-shaped value of every indexed property, kept
 * sorted by wall-clock value, recurring month and day, and (for zoned values) UTC instant, so a range of dates, and a range of a
 * recurring date such as a birthday, is a binary search and a slice rather than a walk.
 *
 * A value counts as a date when it is shaped `YYYY-MM-DD`, optionally followed by `THH:mm`, `THH:mm:ss` or
 * `THH:mm:ss.sss`: the forms Obsidian's own `date` and `datetime` properties write. A value with a time may
 * also carry an ISO 8601 offset (`Z`, `-06:00`, `+0200`) and an RFC 9557 time zone annotation
 * (`[Europe/Kyiv]`), in that order, either or both.
 *
 * The default and recurring orderings key on the LOCAL part, the date and time as written with the zone dropped, so a value is
 * found on the calendar day it names and every key compares correctly as a plain string, which is what lets
 * both orderings be sorted arrays of strings. The optional UTC view moves a note dated
 * `2026-10-26T23:00-06:00` to the 27th. Values without a zone are converted per query from a bounded wall-clock slice.
 *
 * A value of REDUCED precision, `YYYY` or `YYYY-MM` as ISO 8601 writes a year or a month, is kept too, keyed
 * as written: it stands for its whole year or month, never for that period's first day. String order puts
 * it at the start of its period (`2019` before `2019-01-01`), and a range matches it when the two OVERLAP. The
 * upper bound, compared over its own length, already does; the lower bound adds the reduced keys that are a
 * prefix of it. A year alone has no month and day, so it stays out of the recurring view. Whether such a
 * value counts as a date at all depends on its property, which the caller decides per query.
 *
 * Kept current entry by entry from `PropertyValues.set` and `delete`: an insertion or a removal is a binary
 * search and one `splice`.
 */

import type {
  DatedValue,
  DatedValuesQuery
} from '../../plugin-api.ts';

import {
  getInstantPeriod,
  hasTimeZone,
  readInstantBound,
  validateTimeZone
} from './instant-date.ts';

type DatedEntryComparer = (entry1: LocalDatedValue, entry2: LocalDatedValue) => number;

interface DatedValueIndexGetDatedValuesOptions {
  readonly defaultTimeZone?: string;
  readonly isDateProperty: (propertyName: string) => boolean;
  readonly isIncluded: (propertyName: string) => boolean;
}

interface DatedValueIndexGetUtcValuesParams {
  readonly defaultTimeZone: string;
  readonly isDateProperty: (propertyName: string) => boolean;
  readonly isIncluded: (propertyName: string) => boolean;
  readonly query: DatedValuesQuery;
}

interface DatedValueIndexGetZonelessValuesParams extends DatedValueIndexGetUtcValuesParams {
  readonly from: number;
  readonly to: number;
  readonly zone: string;
}

interface EntryLocation {
  readonly index: number;
  readonly isFound: boolean;
}

type KeySelector = (entry: LocalDatedValue) => string;

/**
 * An entry with its local part worked out once, rather than on every comparison of a binary search.
 */
interface LocalDatedValue extends DatedValue {
  readonly isReduced: boolean;
  readonly localValue: string;
}

const UTC_CANDIDATE_PADDING = 172_800_000;
// A positive, fixed-width epoch key preserves order when an offset pushes a four-digit year into
// year -1 or 10000, where Date.toISOString switches to a signed, extended year.
const INSTANT_KEY_OFFSET = 1_000_000_000_000_000;
const INSTANT_KEY_LENGTH = String(INSTANT_KEY_OFFSET).length;
const MIN_CALENDAR_INSTANT = Date.parse('0000-01-01T00:00Z');
const MAX_CALENDAR_INSTANT = Date.parse('9999-12-31T23:59:59.999Z');
const CALENDAR_DATE_LENGTH = 'YYYY-MM-DD'.length;

const DATE_PATTERN = String.raw`\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])`;
const TIME_PATTERN = String.raw`T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?`;
const OFFSET_PATTERN = String.raw`[Zz]|[+-](?:[01]\d|2[0-3]):?[0-5]\d`;
const TIME_ZONE_NAME_PART_PATTERN = String.raw`[A-Za-z_.][\w.+-]*`;
const TIME_ZONE_ANNOTATION_PATTERN = String.raw`\[!?(?:${TIME_ZONE_NAME_PART_PATTERN}(?:\/${TIME_ZONE_NAME_PART_PATTERN})*|[+-](?:[01]\d|2[0-3]):[0-5]\d)\]`;
/**
 * The date and the time are the local part. A zone is accepted only after a time, as ISO 8601 and RFC 9557
 * have it.
 */
const DATE_VALUE_REGEXP = new RegExp(`^(?<date>${DATE_PATTERN})(?:(?<time>${TIME_PATTERN})(?:${OFFSET_PATTERN})?(?:${TIME_ZONE_ANNOTATION_PATTERN})?)?$`);
/**
 * A year, or a year and a month: never with a time or a zone, which need a day.
 */
const REDUCED_DATE_VALUE_REGEXP = /^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/;
const HALVING_DIVISOR = 2;
const YEAR_LENGTH = 'YYYY-'.length;
const REDUCED_VALUE_KEY_LENGTHS = ['YYYY'.length, 'YYYY-MM'.length];
const REDUCED_MONTH_DAY_KEY_LENGTHS = ['MM'.length];

/**
 * Entries sorted by a key, then by value, then by property name, then by path, so each entry has exactly one
 * place.
 */
class SortedDatedEntries {
  private readonly compare: DatedEntryComparer;
  private entries: LocalDatedValue[] = [];
  private readonly getKey: KeySelector;
  private readonly reducedKeyLengths: readonly number[];

  /**
   * @param getKey - The key an entry is sorted by.
   * @param reducedKeyLengths - The lengths a reduced-precision entry's key can have, shortest first.
   */
  public constructor(getKey: KeySelector, reducedKeyLengths: readonly number[]) {
    this.getKey = getKey;
    this.reducedKeyLengths = reducedKeyLengths;
    this.compare = (entry1, entry2): number =>
      compareStrings(getKey(entry1), getKey(entry2))
      || compareStrings(entry1.value, entry2.value)
      || compareStrings(entry1.propertyName, entry2.propertyName)
      || compareStrings(entry1.path, entry2.path);
  }

  public add(entry: LocalDatedValue): void {
    const { index, isFound } = this.locate(entry);

    if (!isFound) {
      this.entries.splice(index, 0, entry);
    }
  }

  public clear(): void {
    this.entries = [];
  }

  /**
   * Lists the entries whose key is at least `from` and, compared over `to`'s length, at most `to`, and the
   * reduced-precision entries whose key is a prefix of `from`, whose period `from` falls in.
   *
   * @param from - The inclusive lower bound.
   * @param to - The inclusive upper bound, as a prefix; no bound when `undefined`.
   * @returns The entries, in order.
   */
  public getRange(from: string, to: string | undefined): LocalDatedValue[] {
    const start = this.findFirst((entry) => compareStrings(this.getKey(entry), from) >= 0);
    const end = to === undefined
      ? this.entries.length
      : this.findFirst((entry) => compareStrings(this.getKey(entry).slice(0, to.length), to) > 0);
    // Each such key sorts before `from` and after the shorter one, so the slices stay in order.
    const periodSlices = this.reducedKeyLengths.filter((length) => length < from.length).map((length) => {
      const key = from.slice(0, length);
      const keyStart = this.findFirst((entry) => compareStrings(this.getKey(entry), key) >= 0);
      const keyEnd = this.findFirst((entry) => compareStrings(this.getKey(entry), key) > 0);
      return this.entries.slice(keyStart, Math.max(keyStart, Math.min(keyEnd, end)));
    });

    return [...periodSlices.flat(), ...this.entries.slice(start, Math.max(start, end))];
  }

  public remove(entry: LocalDatedValue): void {
    const { index, isFound } = this.locate(entry);

    if (isFound) {
      this.entries.splice(index, 1);
    }
  }

  /**
   * Binary search for the first entry a monotonic predicate holds for.
   *
   * @param isAtOrAfter - False for a prefix of the entries and true for the rest.
   * @returns The index of the first entry it holds for, or the length when it holds for none.
   */
  private findFirst(isAtOrAfter: (entry: LocalDatedValue) => boolean): number {
    let low = 0;
    let high = this.entries.length;

    while (low < high) {
      const middle = Math.floor((low + high) / HALVING_DIVISOR);
      const entry = this.entries[middle];

      if (entry && isAtOrAfter(entry)) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }

    return low;
  }

  /**
   * Finds an entry's place.
   *
   * @param entry - The entry.
   * @returns The index it is at, or belongs at, and whether it is there.
   */
  private locate(entry: LocalDatedValue): EntryLocation {
    const index = this.findFirst((existing) => this.compare(existing, entry) >= 0);
    const existing = this.entries.at(index);
    return { index, isFound: existing !== undefined && this.compare(existing, entry) === 0 };
  }
}

/**
 * Wall-clock and recurring views of every date, plus an instant view of zoned values.
 */
export class DatedValueIndex {
  private readonly byInstant = new SortedDatedEntries(getValueKey, []);
  private readonly byMonthDay = new SortedDatedEntries(getMonthDayKey, REDUCED_MONTH_DAY_KEY_LENGTHS);
  private readonly byValue = new SortedDatedEntries(getValueKey, REDUCED_VALUE_KEY_LENGTHS);

  /**
   * Records one value, when it is a date, of full or reduced precision.
   *
   * @param entry - The note, the property and the value.
   */
  public add(entry: DatedValue): void {
    const localEntry = toLocalDatedValue(entry);

    if (!localEntry) {
      return;
    }

    this.byValue.add(localEntry);
    if (hasTimeZone(entry.value)) {
      const instantEntry = toInstantEntry(localEntry);
      if (instantEntry) {
        this.byInstant.add(instantEntry);
      }
    }

    if (getMonthDayKey(localEntry)) {
      this.byMonthDay.add(localEntry);
    }
  }

  /**
   * Forgets every entry.
   */
  public clear(): void {
    this.byValue.clear();
    this.byMonthDay.clear();
    this.byInstant.clear();
  }

  /**
   * Lists the dated values a query matches, in order.
   *
   * @param query - The query.
   * @param options - Property inclusion and date-type predicates, and the default zone for UTC queries.
   * @returns The entries, ordered by value — by month and day first when the query is recurring — then by
   *   property name, then by path.
   */
  public getDatedValues(query: DatedValuesQuery, options: DatedValueIndexGetDatedValuesOptions): DatedValue[] {
    const { defaultTimeZone = '', isDateProperty, isIncluded } = options;
    if (query.timeBasis === 'utc') {
      return this.getUtcValues({ defaultTimeZone, isDateProperty, isIncluded, query });
    }
    const entries = query.isRecurring ? this.byMonthDay : this.byValue;
    const from = query.from ?? '';
    const to = query.to;
    // Only a recurring range wraps; `from` is compared over `to`'s length, so `10-26` to `10` does not.
    const isWrapping = query.isRecurring === true && to !== undefined && compareStrings(from.slice(0, to.length), to) > 0;
    const slices = isWrapping
      ? [entries.getRange(from, undefined), entries.getRange('', to)]
      : [entries.getRange(from, to)];

    return slices.flat()
      .filter((entry) => isIncluded(entry.propertyName) && (!entry.isReduced || isDateProperty(entry.propertyName)))
      .map(({ path, propertyName, value }) => ({ path, propertyName, value }));
  }

  /**
   * Forgets one value.
   *
   * @param entry - The note, the property and the value.
   */
  public remove(entry: DatedValue): void {
    const localEntry = toLocalDatedValue(entry);

    if (!localEntry) {
      return;
    }

    this.byValue.remove(localEntry);
    if (hasTimeZone(entry.value)) {
      const instantEntry = toInstantEntry(localEntry);
      if (instantEntry) {
        this.byInstant.remove(instantEntry);
      }
    }

    if (getMonthDayKey(localEntry)) {
      this.byMonthDay.remove(localEntry);
    }
  }

  private getUtcValues(params: DatedValueIndexGetUtcValuesParams): DatedValue[] {
    const { defaultTimeZone, isIncluded, query } = params;
    if (query.isRecurring) {
      throw new RangeError('UTC queries cannot be recurring');
    }
    const from = query.from === undefined ? -Infinity : readInstantBound(query.from);
    const to = query.to === undefined ? Infinity : readInstantBound(query.to);
    const policy = query.missingTimeZone ?? 'default';
    const zone = typeof policy === 'object' ? policy.zone : (policy === 'utc' || policy === 'skip' ? 'UTC' : defaultTimeZone || new Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (policy !== 'skip') {
      validateTimeZone(zone);
    }
    if (from > to) {
      return [];
    }
    const entries = this.byInstant.getRange(Number.isFinite(from) ? getInstantKey(from) : '', Number.isFinite(to) ? getInstantKey(to) : undefined)
      .filter((entry) => isIncluded(entry.propertyName));
    if (policy !== 'skip') {
      entries.push(...this.getZonelessValues({ ...params, from, to, zone }));
    }
    return entries.sort((first, second) =>
      compareStrings(first.localValue, second.localValue)
      || compareStrings(first.value, second.value) || compareStrings(first.propertyName, second.propertyName)
      || compareStrings(first.path, second.path)
    )
      .map(({ path, propertyName, value }) => ({ path, propertyName, value }));
  }

  private getZonelessValues(params: DatedValueIndexGetZonelessValuesParams): LocalDatedValue[] {
    const { from, isDateProperty, isIncluded, query, to, zone } = params;
    const entries: LocalDatedValue[] = [];
    // All IANA offsets, including a skipped calendar day, fit within this two-day envelope.
    // Reduced precision entries preceding the lower bound are included by getRange's period slices.
    const candidates = this.byValue.getRange(
      Number.isFinite(from) ? getCandidateDateKey(from - UTC_CANDIDATE_PADDING) : '',
      Number.isFinite(to) ? getCandidateDateKey(to + UTC_CANDIDATE_PADDING) : undefined
    );
    for (const entry of candidates) {
      if (hasTimeZone(entry.value) || !isIncluded(entry.propertyName) || (entry.isReduced && !isDateProperty(entry.propertyName))) {
        continue;
      }
      const period = getInstantPeriod({ fallbackZone: zone, value: entry.value });
      if (!(period.end >= from && period.start <= to)) {
        continue;
      }

      if (query.missingTimeZone === 'fail') {
        throw new RangeError(`Missing time zone: ${entry.value} (${entry.path}, ${entry.propertyName})`);
      }
      entries.push({ ...entry, localValue: getInstantKey(period.start) });
    }
    return entries;
  }
}

/**
 * Reads the local part of a date-shaped value: its date and time as written, without the zone. A
 * reduced-precision value is its own local part.
 *
 * @param value - The value.
 * @returns The local part, or `null` when the value does not count as a date of either precision.
 */
export function getLocalDateValue(value: string): null | string {
  if (isReducedPrecisionDateValue(value)) {
    return value;
  }

  const groups = DATE_VALUE_REGEXP.exec(value)?.groups;
  return groups?.['date'] === undefined ? null : `${groups['date']}${groups['time'] ?? ''}`;
}

/**
 * Whether a value is shaped as a date or a datetime, with or without a zone.
 *
 * @param value - The value.
 * @returns Whether the value counts as a date.
 */
export function isDateValue(value: string): boolean {
  return DATE_VALUE_REGEXP.test(value);
}

/**
 * Whether a value is a date of reduced precision: a year (`2019`) or a year and a month (`2019-05`).
 *
 * @param value - The value.
 * @returns Whether the value counts as a date in a date property.
 */
export function isReducedPrecisionDateValue(value: string): boolean {
  return REDUCED_DATE_VALUE_REGEXP.test(value);
}

/**
 * Ordinal comparison: ISO dates compare correctly character by character, and a locale would not keep `T`
 * after the digits everywhere.
 *
 * @param string1 - The first string.
 * @param string2 - The second string.
 * @returns A negative number, zero or a positive number.
 */
function compareStrings(string1: string, string2: string): number {
  if (string1 === string2) {
    return 0;
  }

  return string1 < string2 ? -1 : 1;
}

function getCandidateDateKey(instant: number): string {
  const clamped = Math.max(MIN_CALENDAR_INSTANT, Math.min(MAX_CALENDAR_INSTANT, instant));
  return new Date(clamped).toISOString().slice(0, CALENDAR_DATE_LENGTH);
}

function getInstantKey(instant: number): string {
  return String(INSTANT_KEY_OFFSET + instant).padStart(INSTANT_KEY_LENGTH, '0');
}

function getMonthDayKey(entry: LocalDatedValue): string {
  return entry.localValue.slice(YEAR_LENGTH);
}

function getValueKey(entry: LocalDatedValue): string {
  return entry.localValue;
}

function toInstantEntry(entry: LocalDatedValue): LocalDatedValue | null {
  try {
    return { ...entry, localValue: getInstantKey(getInstantPeriod({ fallbackZone: 'UTC', value: entry.value }).start) };
  } catch (error) {
    // Wall-clock indexing has always accepted date SHAPES. An unknown zone or an impossible calendar
    // date must not break that index or a metadata-change listener; it simply supplies no UTC instant.
    if (error instanceof RangeError) {
      return null;
    }
    throw error;
  }
}

function toLocalDatedValue(entry: DatedValue): LocalDatedValue | null {
  const localValue = getLocalDateValue(entry.value);
  return localValue === null ? null : { ...entry, isReduced: isReducedPrecisionDateValue(entry.value), localValue };
}
