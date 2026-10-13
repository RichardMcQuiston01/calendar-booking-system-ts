import type {
  ClockTime,
  DateOnly,
  Instant,
  TimeRange,
  TimeZone,
  Weekday,
} from './types.js';

const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

const WEEKDAY_FROM_SHORT: Record<string, Weekday> = {
  Sun: 'SU',
  Mon: 'MO',
  Tue: 'TU',
  Wed: 'WE',
  Thu: 'TH',
  Fri: 'FR',
  Sat: 'SA',
};

type TemporalZoned = {
  epochMilliseconds: number;
};

type TemporalApi = {
  ZonedDateTime: {
    from: (
      fields: {
        timeZone: string;
        year: number;
        month: number;
        day: number;
        hour: number;
        minute: number;
        second: number;
        millisecond: number;
      },
      options?: { overflow?: 'constrain' | 'reject' },
    ) => TemporalZoned;
  };
};

/**
 * True when `zone` is a recognized IANA time zone.
 */
export function isValidTimeZone( zone: TimeZone ): boolean {
  const supported = (
    Intl as { supportedValuesOf?: ( key: string ) => string[] }
  ).supportedValuesOf;
  if ( typeof supported === 'function' ) {
    return supported.call( Intl, 'timeZone' ).includes( zone );
  }
  try {
    new Intl.DateTimeFormat( 'en-US', { timeZone: zone } );
    return true;
  } catch {
    return false;
  }
}

/** True when `value` is 24-hour `HH:mm` and not `24:00`. */
export function isValidClockTime( value: string ): boolean {
  return CLOCK_RE.test( value );
}

/**
 * True when `value` is a real `YYYY-MM-DD` civil date.
 */
export function isValidDateOnly( value: string ): boolean {
  if ( !DATE_ONLY_RE.test( value ) ) {
    return false;
  }
  const parsed = Date.parse( `${ value }T00:00:00Z` );
  if ( Number.isNaN( parsed ) ) {
    return false;
  }
  const date = new Date( parsed );
  const [ year, month, day ] = value.split( '-' ).map( Number );
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

/** Format a `Date` as a normalized UTC instant. */
export function toInstant( date: Date ): Instant {
  return date.toISOString();
}

const CANONICAL_INSTANT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * True when `value` is the canonical `YYYY-MM-DDTHH:mm:ss.sssZ` UTC
 * form of a real instant. Offsets, missing milliseconds, date-only,
 * and zoneless strings are rejected so string and epoch comparisons
 * always agree.
 */
export function isCanonicalInstant( value: string ): boolean {
  if ( typeof value !== 'string' || !CANONICAL_INSTANT_RE.test( value ) ) {
    return false;
  }
  const ms = Date.parse( value );
  return !Number.isNaN( ms ) && new Date( ms ).toISOString() === value;
}

/**
 * Describes why `range` is unusable, or `undefined` when both ends are
 * canonical instants and start is strictly before end.
 */
export function rangeProblem( range: TimeRange ): string | undefined {
  if (
    !isCanonicalInstant( range.start ) ||
    !isCanonicalInstant( range.end )
  ) {
    return 'range start and end must be canonical UTC instants ' +
      '(YYYY-MM-DDTHH:mm:ss.sssZ)';
  }
  if ( Date.parse( range.start ) >= Date.parse( range.end ) ) {
    return 'range start must be before range end';
  }
  return undefined;
}

/** Parse an instant string; `undefined` when `Date.parse` is `NaN`. */
export function parseInstant( value: string ): Date | undefined {
  const ms = Date.parse( value );
  if ( Number.isNaN( ms ) ) {
    return undefined;
  }
  return new Date( ms );
}

/**
 * Half-open overlap: `[a.start, a.end)` intersects `[b.start, b.end)`.
 * Touching endpoints do not overlap. Instants are compared by epoch
 * milliseconds after a successful parse.
 */
export function overlaps( a: TimeRange, b: TimeRange ): boolean {
  const aStart = parseInstant( a.start );
  const aEnd = parseInstant( a.end );
  const bStart = parseInstant( b.start );
  const bEnd = parseInstant( b.end );
  if (
    aStart === undefined ||
    aEnd === undefined ||
    bStart === undefined ||
    bEnd === undefined
  ) {
    return false;
  }
  return (
    aStart.getTime() < bEnd.getTime() &&
    bStart.getTime() < aEnd.getTime()
  );
}

type CivilParts = {
  year: string;
  month: string;
  day: string;
  weekday: string;
  hour: string;
  minute: string;
};

const civilFormatters = new Map<TimeZone, Intl.DateTimeFormat>();

/** Cached `Intl.DateTimeFormat`; construction dominates expansion cost. */
export function civilFormatter( timeZone: TimeZone ): Intl.DateTimeFormat {
  let fmt = civilFormatters.get( timeZone );
  if ( fmt === undefined ) {
    fmt = new Intl.DateTimeFormat( 'en-US', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    } );
    civilFormatters.set( timeZone, fmt );
  }
  return fmt;
}

function civilPartsInZone(
  date: Date,
  timeZone: TimeZone,
): CivilParts {
  const fmt = civilFormatter( timeZone );
  const parts: Partial<CivilParts> = {};
  for ( const part of fmt.formatToParts( date ) ) {
    if (
      part.type === 'year' ||
      part.type === 'month' ||
      part.type === 'day' ||
      part.type === 'weekday' ||
      part.type === 'hour' ||
      part.type === 'minute'
    ) {
      parts[ part.type ] = part.value;
    }
  }
  return parts as CivilParts;
}

/** Civil `YYYY-MM-DD` of `instant` in `timeZone`. */
export function civilDateInZone(
  instant: Instant,
  timeZone: TimeZone,
): DateOnly {
  const parts = civilPartsInZone( new Date( instant ), timeZone );
  return `${ parts.year }-${ parts.month }-${ parts.day }`;
}

/** ISO weekday of `instant` in `timeZone`. */
export function weekdayInZone(
  instant: Instant,
  timeZone: TimeZone,
): Weekday {
  const parts = civilPartsInZone( new Date( instant ), timeZone );
  return WEEKDAY_FROM_SHORT[ parts.weekday ] ?? 'MO';
}

function temporalApi(): TemporalApi | undefined {
  return ( globalThis as { Temporal?: TemporalApi } ).Temporal;
}

function zonedInstantFromTemporal(
  temporal: TemporalApi,
  dateOnly: DateOnly,
  clockTime: ClockTime,
  timeZone: TimeZone,
): Instant | undefined {
  const [ year, month, day ] = dateOnly.split( '-' ).map( Number );
  const [ hour, minute ] = clockTime.split( ':' ).map( Number );
  try {
    // `reject` keeps Feb 29 in a non-leap year unrepresentable
    // instead of silently constraining it to Feb 28.
    const zoned = temporal.ZonedDateTime.from(
      {
        timeZone,
        year,
        month,
        day,
        hour,
        minute,
        second: 0,
        millisecond: 0,
      },
      { overflow: 'reject' },
    );
    return toInstant( new Date( zoned.epochMilliseconds ) );
  } catch {
    return undefined;
  }
}

function zonedInstantByIteration(
  dateOnly: DateOnly,
  clockTime: ClockTime,
  timeZone: TimeZone,
): Instant | undefined {
  try {
    const guess = Date.parse( `${ dateOnly }T${ clockTime }:00.000Z` );
    if ( Number.isNaN( guess ) ) {
      return undefined;
    }
    const [ year, month, day ] = dateOnly.split( '-' ).map( Number );
    const [ hour, minute ] = clockTime.split( ':' ).map( Number );
    const want = Date.UTC( year, month - 1, day, hour, minute, 0, 0 );
    let utc = guess;
    for ( let i = 0; i < 8; i += 1 ) {
      const parts = civilPartsInZone( new Date( utc ), timeZone );
      const got = Date.UTC(
        Number( parts.year ),
        Number( parts.month ) - 1,
        Number( parts.day ),
        Number( parts.hour ),
        Number( parts.minute ),
        0,
        0,
      );
      const delta = want - got;
      if ( delta === 0 ) {
        if (
          `${ parts.year }-${ parts.month }-${ parts.day }` === dateOnly &&
          `${ parts.hour }:${ parts.minute }` === clockTime
        ) {
          return toInstant( new Date( utc ) );
        }
        return undefined;
      }
      utc += delta;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * UTC instant for a civil date and clock time in `timeZone`.
 * Returns `undefined` when that local time cannot be represented.
 */
export function zonedInstant(
  dateOnly: DateOnly,
  clockTime: ClockTime,
  timeZone: TimeZone,
): Instant | undefined {
  const temporal = temporalApi();
  if ( temporal ) {
    return zonedInstantFromTemporal(
      temporal,
      dateOnly,
      clockTime,
      timeZone,
    );
  }
  return zonedInstantByIteration( dateOnly, clockTime, timeZone );
}

/** Current time as a normalized UTC instant. */
export function nowInstant(): Instant {
  return toInstant( new Date() );
}
