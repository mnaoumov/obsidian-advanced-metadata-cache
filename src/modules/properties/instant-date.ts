/**
 * Calendar-to-instant conversion using the host's time zone database. Offset-bearing values use
 * their written offset; named-zone-only values use compatible disambiguation (earlier in an overlap,
 * forward in a gap). No dependency on the device zone enters explicit-zone conversions.
 */
const DAY_MILLISECONDS = 86_400_000;
const ZONE_SUFFIX = /\[!?(?<zone>[^\]]+)\]$/;
const OFFSET_SUFFIX = /(?:[Zz]|[+-]\d{2}:?\d{2})$/;
const YEAR_PRECISION = 4;
const MONTH_PRECISION = 7;
const MAX_FORMATTERS = 32;
const SECOND_MILLISECONDS = 1000;
const DATE_LENGTH = 10;
const OFFSET_SAMPLE_DAY_RADIUS = 2;
const OFFSET_SAMPLE_DAYS = [-OFFSET_SAMPLE_DAY_RADIUS, -1, 0, 1, OFFSET_SAMPLE_DAY_RADIUS];
const formatters = new Map<string, Intl.DateTimeFormat>();

interface GetInstantPeriodParams {
  readonly fallbackZone: string;
  readonly value: string;
}

interface InstantPeriod {
  readonly end: number;
  readonly start: number;
}

/**
 * Converts a date value to an instant or a whole calendar period in the requested zone.
 */
export function getInstantPeriod(params: GetInstantPeriodParams): InstantPeriod {
  const { fallbackZone, value } = params;
  const annotation = ZONE_SUFFIX.exec(value);
  const datetime = value.replace(ZONE_SUFFIX, '');
  const zone = annotation?.groups?.['zone'] ?? fallbackZone;
  if (datetime.includes('T') && OFFSET_SUFFIX.test(datetime)) {
    const instant = readInstantBound(datetime);
    return { end: instant, start: instant };
  }
  const local = new Date(`${datetime}${datetime.length === YEAR_PRECISION ? '-01-01' : (datetime.length === MONTH_PRECISION ? '-01' : '')}${datetime.includes('T') ? '' : 'T00:00'}Z`);
  const localEpoch = local.getTime();
  if (!Number.isFinite(localEpoch) || !local.toISOString().startsWith(datetime)) {
    throw new RangeError(`Invalid calendar value: ${value}`);
  }
  const start = resolveLocal(localEpoch, zone);
  if (datetime.includes('T')) {
    return { end: start, start };
  }
  if (datetime.length === YEAR_PRECISION) {
    local.setUTCFullYear(local.getUTCFullYear() + 1);
  } else if (datetime.length === MONTH_PRECISION) {
    local.setUTCMonth(local.getUTCMonth() + 1);
  } else {
    local.setUTCDate(local.getUTCDate() + 1);
  }
  return { end: resolveLocal(local.getTime(), zone) - 1, start };
}

/**
 * Whether a datetime supplies its own offset or zone.
 */
export function hasTimeZone(value: string): boolean {
  return value.includes('T') && (ZONE_SUFFIX.test(value) || OFFSET_SUFFIX.test(value));
}

/**
 * Reads a complete offset-bearing query bound, rejecting locale-dependent date parsing.
 */
export function readInstantBound(value: string): number {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:[Zz]|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/.test(value)) {
    throw new RangeError(`Expected a complete datetime with an offset: ${value}`);
  }
  const instant = Date.parse(value);
  const date = value.slice(0, DATE_LENGTH);
  if (!Number.isFinite(instant) || !new Date(`${date}T00:00Z`).toISOString().startsWith(date)) {
    throw new RangeError(`Invalid instant: ${value}`);
  }
  return instant;
}

/**
 * Validates a query's zone even when the index is empty.
 */
export function validateTimeZone(zone: string): void {
  getFormatter(zone);
}

function getFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      era: 'short',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      second: '2-digit',
      timeZone: zone,
      year: 'numeric'
    });
    // Bound the cache: caller-supplied zones must not accumulate for the plugin's whole lifetime.
    if (formatters.size >= MAX_FORMATTERS) {
      formatters.clear();
    }
    formatters.set(zone, formatter);
  }
  return formatter;
}

function getOffset(epoch: number, zone: string): number {
  const fields = new Map(getFormatter(zone).formatToParts(epoch).map((part) => [part.type, part.value]));
  const wallClock = new Date(0);
  const year = Number(fields.get('year'));
  wallClock.setUTCFullYear(fields.get('era') === 'BC' ? 1 - year : year, Number(fields.get('month')) - 1, Number(fields.get('day')));
  wallClock.setUTCHours(Number(fields.get('hour')), Number(fields.get('minute')), Number(fields.get('second')), 0);
  return wallClock.getTime() - Math.floor(epoch / SECOND_MILLISECONDS) * SECOND_MILLISECONDS;
}

function resolveLocal(localEpoch: number, zone: string): number {
  if (zone === 'UTC') {
    return localEpoch;
  }
  if (/^[+-]\d{2}:\d{2}$/.test(zone)) {
    return localEpoch + Date.parse(`2000-01-01T00:00${zone}`) - Date.parse('2000-01-01T00:00Z');
  }
  const offsets = new Set(OFFSET_SAMPLE_DAYS.map((days) => getOffset(localEpoch + days * DAY_MILLISECONDS, zone)));
  const candidates = [...offsets].map((offset) => localEpoch - offset);
  const exact = candidates.filter((instant) => instant + getOffset(instant, zone) === localEpoch);
  return exact.length > 0 ? Math.min(...exact) : Math.max(...candidates);
}
