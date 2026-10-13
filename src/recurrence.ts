import { err, ok } from './result.js';
import {
  civilDateInZone,
  civilFormatter,
  isValidDateOnly,
  isValidTimeZone,
  overlaps,
  parseInstant,
  rangeProblem,
  toInstant,
  weekdayInZone,
  zonedInstant,
} from './time.js';
import type {
  AvailabilityRule,
  CalendarEvent,
  ClockTime,
  DateOnly,
  Instant,
  Occurrence,
  RecurrenceRule,
  Result,
  TimeRange,
  TimeZone,
  Weekday,
} from './types.js';

const WEEKDAY_FROM_UTC: Weekday[] = [
  'SU',
  'MO',
  'TU',
  'WE',
  'TH',
  'FR',
  'SA',
];

const DAYS_FROM_MONDAY: Record<Weekday, number> = {
  MO: 0,
  TU: 1,
  WE: 2,
  TH: 3,
  FR: 4,
  SA: 5,
  SU: 6,
};

/** Largest `interval` a recurrence rule may declare. */
export const MAX_RECURRENCE_INTERVAL = 1000;

/** Largest `count` a recurrence rule may declare. */
export const MAX_RECURRENCE_COUNT = 10000;

/** Most civil dates one expansion will walk before giving up. */
export const MAX_EXPANDED_DATES = 20000;

/**
 * True when a rule's phase depends on a fixed start: a stride greater
 * than 1 or a `count`. Such rules must carry `startDate`.
 */
export function ruleNeedsStartDate( rule: AvailabilityRule ): boolean {
  return (
    ( rule.recurrence.interval ?? 1 ) > 1 ||
    rule.recurrence.count !== undefined
  );
}

function isCalendarEvent(
  source: CalendarEvent | AvailabilityRule,
): source is CalendarEvent {
  return 'start' in source;
}

function addDays( dateOnly: DateOnly, days: number ): DateOnly {
  const [ year, month, day ] = dateOnly.split( '-' ).map( Number );
  const utc = new Date( Date.UTC( year, month - 1, day + days ) );
  const yyyy = String( utc.getUTCFullYear() ).padStart( 4, '0' );
  const mm = String( utc.getUTCMonth() + 1 ).padStart( 2, '0' );
  const dd = String( utc.getUTCDate() ).padStart( 2, '0' );
  return `${ yyyy }-${ mm }-${ dd }`;
}

function weekdayOf( dateOnly: DateOnly ): Weekday {
  const [ year, month, day ] = dateOnly.split( '-' ).map( Number );
  const utc = new Date( Date.UTC( year, month - 1, day ) );
  return WEEKDAY_FROM_UTC[ utc.getUTCDay() ] ?? 'MO';
}

function mondayOf( dateOnly: DateOnly ): DateOnly {
  return addDays( dateOnly, -DAYS_FROM_MONDAY[ weekdayOf( dateOnly ) ] );
}

function withYear( dateOnly: DateOnly, year: number ): DateOnly {
  return `${ String( year ).padStart( 4, '0' ) }-${ dateOnly.slice( 5 ) }`;
}

function clockInZone( instant: Instant, timeZone: TimeZone ): ClockTime {
  const parts: { hour?: string; minute?: string } = {};
  for (
    const part of civilFormatter( timeZone ).formatToParts(
      new Date( instant ),
    )
  ) {
    if ( part.type === 'hour' || part.type === 'minute' ) {
      parts[ part.type ] = part.value;
    }
  }
  return `${ parts.hour ?? '00' }:${ parts.minute ?? '00' }`;
}

function* iterateCivilDates(
  recurrence: RecurrenceRule,
  dtStart: DateOnly,
  stopDate: DateOnly,
  interval: number,
): Generator<DateOnly> {
  const { freq, byDay } = recurrence;
  if ( freq === 'daily' ) {
    let cursor = dtStart;
    while ( cursor <= stopDate ) {
      yield cursor;
      cursor = addDays( cursor, interval );
    }
    return;
  }
  if ( freq === 'weekly' ) {
    const days =
      byDay && byDay.length > 0
        ? [ ...new Set( byDay ) ]
        : [ weekdayOf( dtStart ) ];
    let weekStart = mondayOf( dtStart );
    while ( weekStart <= stopDate ) {
      const inWeek: DateOnly[] = [];
      for ( const day of days ) {
        const date = addDays( weekStart, DAYS_FROM_MONDAY[ day ] );
        if ( date >= dtStart && date <= stopDate ) {
          inWeek.push( date );
        }
      }
      inWeek.sort();
      for ( const date of inWeek ) {
        yield date;
      }
      weekStart = addDays( weekStart, 7 * interval );
    }
    return;
  }
  const startYear = Number( dtStart.slice( 0, 4 ) );
  const stopYear = Number( stopDate.slice( 0, 4 ) );
  for (
    let year = startYear;
    year <= stopYear + 1;
    year += interval
  ) {
    yield withYear( dtStart, year );
  }
}

function occurrenceForEvent(
  source: CalendarEvent,
  zone: TimeZone,
  date: DateOnly,
): Occurrence | undefined {
  const startAt = parseInstant( source.start );
  const endAt = parseInstant( source.end );
  if ( startAt === undefined || endAt === undefined ) {
    return undefined;
  }
  const start = zonedInstant( date, clockInZone( source.start, zone ), zone );
  if ( start === undefined ) {
    return undefined;
  }
  const startMs = Date.parse( start );
  return {
    start,
    end: toInstant( new Date( startMs + ( endAt.getTime() - startAt.getTime() ) ) ),
  };
}

function occurrenceForRule(
  source: AvailabilityRule,
  zone: TimeZone,
  date: DateOnly,
): Occurrence | undefined {
  const start = zonedInstant( date, source.startTime, zone );
  if ( start === undefined ) {
    return undefined;
  }
  const endDate =
    source.endTime <= source.startTime ? addDays( date, 1 ) : date;
  const end = zonedInstant( endDate, source.endTime, zone );
  if ( end === undefined ) {
    return undefined;
  }
  return { start, end };
}

function singleEventOccurrences(
  source: CalendarEvent,
  range: TimeRange,
  zone: TimeZone,
): Occurrence[] {
  const occ = { start: source.start, end: source.end };
  const localDate = civilDateInZone( source.start, zone );
  if ( ( source.excludedDates ?? [] ).includes( localDate ) ) {
    return [];
  }
  return overlaps( occ, range ) ? [ occ ] : [];
}

/**
 * Expand an event or availability rule into UTC occurrences that
 * intersect `range`. Civil clock time is preserved across DST.
 */
export function expandRecurrence(
  source: CalendarEvent | AvailabilityRule,
  range: TimeRange,
  timeZone: TimeZone,
): Result<Occurrence[]> {
  const problem = rangeProblem( range );
  if ( problem !== undefined ) {
    return err( { code: 'range', message: problem } );
  }

  const zone = isCalendarEvent( source )
    ? ( source.timeZone ?? timeZone )
    : timeZone;

  if ( !isValidTimeZone( zone ) ) {
    return err( {
      code: 'validation',
      message: 'time zone is invalid',
    } );
  }

  if ( isCalendarEvent( source ) && source.recurrence === undefined ) {
    return ok( singleEventOccurrences( source, range, zone ) );
  }

  const recurrence = source.recurrence;
  if ( recurrence === undefined ) {
    return ok( [] );
  }

  const interval = recurrence.interval ?? 1;
  if (
    !Number.isInteger( interval ) ||
    interval < 1 ||
    interval > MAX_RECURRENCE_INTERVAL
  ) {
    return err( {
      code: 'validation',
      message:
        `recurrence.interval must be an integer from 1 to ${ MAX_RECURRENCE_INTERVAL }`,
      details: { interval },
    } );
  }
  if (
    recurrence.count !== undefined &&
    ( !Number.isInteger( recurrence.count ) ||
      recurrence.count < 1 ||
      recurrence.count > MAX_RECURRENCE_COUNT )
  ) {
    return err( {
      code: 'validation',
      message:
        `recurrence.count must be an integer from 1 to ${ MAX_RECURRENCE_COUNT }`,
      details: { count: recurrence.count },
    } );
  }

  if (
    !isCalendarEvent( source ) &&
    ruleNeedsStartDate( source ) &&
    source.startDate === undefined
  ) {
    return err( {
      code: 'validation',
      message:
        'availability rule needs startDate when recurrence.interval ' +
        'is greater than 1 or recurrence.count is set',
      details: { id: source.id },
    } );
  }
  if (
    !isCalendarEvent( source ) &&
    source.startDate !== undefined &&
    !isValidDateOnly( source.startDate )
  ) {
    return err( {
      code: 'validation',
      message: 'availability rule startDate is not a DateOnly',
      details: { id: source.id },
    } );
  }

  const rangeStartDate = civilDateInZone( range.start, zone );
  let dtStart: DateOnly;
  if ( isCalendarEvent( source ) ) {
    dtStart = civilDateInZone( source.start, zone );
  } else if ( source.startDate !== undefined ) {
    dtStart = source.startDate;
  } else {
    // One day back so an overnight window that began yesterday and
    // runs into the range is still considered.
    dtStart = addDays( rangeStartDate, -1 );
  }
  const stopDate = addDays( civilDateInZone( range.end, zone ), 1 );
  const excluded = new Set( source.excludedDates ?? [] );
  const byDay = recurrence.byDay;
  const untilMs =
    recurrence.until === undefined
      ? undefined
      : Date.parse( recurrence.until );
  const occurrences: Occurrence[] = [];
  let produced = 0;

  const consider = (
    date: DateOnly,
    countIfNoOverlap: boolean,
  ): boolean => {
    const occ = isCalendarEvent( source )
      ? occurrenceForEvent( source, zone, date )
      : occurrenceForRule( source, zone, date );
    if ( occ === undefined ) {
      return true;
    }
    if (
      byDay !== undefined &&
      byDay.length > 0 &&
      !byDay.includes( weekdayInZone( occ.start, zone ) )
    ) {
      return true;
    }
    if (
      untilMs !== undefined &&
      Date.parse( occ.start ) > untilMs
    ) {
      return false;
    }
    const hits = overlaps( occ, range );
    if ( !hits && !countIfNoOverlap ) {
      return true;
    }
    produced += 1;
    if (
      recurrence.count !== undefined &&
      produced > recurrence.count
    ) {
      return false;
    }
    if ( excluded.has( civilDateInZone( occ.start, zone ) ) ) {
      return true;
    }
    if ( hits ) {
      occurrences.push( occ );
    }
    return true;
  };

  let walked = 0;
  for ( const date of iterateCivilDates(
    recurrence,
    dtStart,
    stopDate,
    interval,
  ) ) {
    walked += 1;
    if ( walked > MAX_EXPANDED_DATES ) {
      return err( {
        code: 'range',
        message:
          `recurrence expands past ${ MAX_EXPANDED_DATES } dates; ` +
          'narrow the range or set until/count',
      } );
    }
    if ( !consider( date, true ) ) {
      break;
    }
  }

  occurrences.sort( ( a, b ) => a.start.localeCompare( b.start ) );
  return ok( occurrences );
}
