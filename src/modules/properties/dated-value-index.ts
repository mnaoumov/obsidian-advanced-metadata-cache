/**
 * @file
 *
 * The ordered half of the `Properties` module: every date-shaped value of every indexed property, kept
 * sorted twice — by the full value, and by its month and day — so a range of dates, and a range of a
 * recurring date such as a birthday, is a binary search and a slice rather than a walk.
 *
 * A value counts as a date when it is shaped `YYYY-MM-DD`, optionally followed by `THH:mm`, `THH:mm:ss` or
 * `THH:mm:ss.sss`, with no time zone: the forms Obsidian's own `date` and `datetime` properties write. Such
 * values are local wall-clock times, so they compare correctly as plain strings, which is what lets both
 * orderings be sorted arrays of strings. A value with a zone would sort wrong against one without, so it is not
 * a date here.
 *
 * Kept current entry by entry from `PropertyValues.set` and `delete`: an insertion or a removal is a binary
 * search and one `splice`.
 */

import type {
  DatedValue,
  DatedValuesQuery
} from '../../plugin-api.ts';

type DatedEntryComparer = (entry1: DatedValue, entry2: DatedValue) => number;

interface EntryLocation {
  readonly index: number;
  readonly isFound: boolean;
}

type KeySelector = (entry: DatedValue) => string;

const DATE_VALUE_REGEXP = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?)?$/;
const HALVING_DIVISOR = 2;
const YEAR_LENGTH = 'YYYY-'.length;

/**
 * Entries sorted by a key, then by property name, then by path, so each entry has exactly one place.
 */
class SortedDatedEntries {
  private readonly compare: DatedEntryComparer;
  private entries: DatedValue[] = [];
  private readonly getKey: KeySelector;

  public constructor(getKey: KeySelector) {
    this.getKey = getKey;
    this.compare = (entry1, entry2): number =>
      compareStrings(getKey(entry1), getKey(entry2))
      || compareStrings(entry1.value, entry2.value)
      || compareStrings(entry1.propertyName, entry2.propertyName)
      || compareStrings(entry1.path, entry2.path);
  }

  public add(entry: DatedValue): void {
    const { index, isFound } = this.locate(entry);

    if (!isFound) {
      this.entries.splice(index, 0, entry);
    }
  }

  public clear(): void {
    this.entries = [];
  }

  /**
   * Lists the entries whose key is at least `from` and, compared over `to`'s length, at most `to`.
   *
   * @param from - The inclusive lower bound.
   * @param to - The inclusive upper bound, as a prefix; no bound when `undefined`.
   * @returns The entries, in order.
   */
  public getRange(from: string, to: string | undefined): DatedValue[] {
    const start = this.findFirst((entry) => compareStrings(this.getKey(entry), from) >= 0);
    const end = to === undefined
      ? this.entries.length
      : this.findFirst((entry) => compareStrings(this.getKey(entry).slice(0, to.length), to) > 0);

    return this.entries.slice(start, Math.max(start, end));
  }

  public remove(entry: DatedValue): void {
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
  private findFirst(isAtOrAfter: (entry: DatedValue) => boolean): number {
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
  private locate(entry: DatedValue): EntryLocation {
    const index = this.findFirst((existing) => this.compare(existing, entry) >= 0);
    const existing = this.entries.at(index);
    return { index, isFound: existing !== undefined && this.compare(existing, entry) === 0 };
  }
}

/**
 * Two sorted views of the same entries.
 */
export class DatedValueIndex {
  private readonly byMonthDay = new SortedDatedEntries(getMonthDayKey);
  private readonly byValue = new SortedDatedEntries(getValueKey);

  /**
   * Records one value, when it is a date.
   *
   * @param entry - The note, the property and the value.
   */
  public add(entry: DatedValue): void {
    if (!isDateValue(entry.value)) {
      return;
    }

    this.byValue.add(entry);
    this.byMonthDay.add(entry);
  }

  /**
   * Forgets every entry.
   */
  public clear(): void {
    this.byValue.clear();
    this.byMonthDay.clear();
  }

  /**
   * Lists the dated values a query matches, in order.
   *
   * @param query - The query.
   * @param isIncluded - Whether an entry's property is among those asked about.
   * @returns The entries, ordered by value — by month and day first when the query is recurring — then by
   *   property name, then by path.
   */
  public getDatedValues(query: DatedValuesQuery, isIncluded: (propertyName: string) => boolean): DatedValue[] {
    const entries = query.isRecurring ? this.byMonthDay : this.byValue;
    const from = query.from ?? '';
    const to = query.to;
    // Only a recurring range wraps; `from` is compared over `to`'s length, so `10-26` to `10` does not.
    const isWrapping = query.isRecurring === true && to !== undefined && compareStrings(from.slice(0, to.length), to) > 0;
    const slices = isWrapping
      ? [entries.getRange(from, undefined), entries.getRange('', to)]
      : [entries.getRange(from, to)];

    return slices.flat().filter((entry) => isIncluded(entry.propertyName)).map((entry) => ({ ...entry }));
  }

  /**
   * Forgets one value.
   *
   * @param entry - The note, the property and the value.
   */
  public remove(entry: DatedValue): void {
    if (!isDateValue(entry.value)) {
      return;
    }

    this.byValue.remove(entry);
    this.byMonthDay.remove(entry);
  }
}

/**
 * Whether a value is shaped as a date or a datetime with no time zone.
 *
 * @param value - The value.
 * @returns Whether the value counts as a date.
 */
export function isDateValue(value: string): boolean {
  return DATE_VALUE_REGEXP.test(value);
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

function getMonthDayKey(entry: DatedValue): string {
  return entry.value.slice(YEAR_LENGTH);
}

function getValueKey(entry: DatedValue): string {
  return entry.value;
}
