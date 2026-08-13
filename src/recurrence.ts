import { err, ok } from './result.js';
import {
  civilDateInZone,
  isValidTimeZone,
  overlaps,
  parseInstant,
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
  const fmt = new Intl.DateTimeFormat( 'en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  } );
  const parts: { hour?: string; minute?: string } = {};
  for ( const part of fmt.formatToParts( new Date( instant ) ) ) {
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
    const days = byDay && byDay.length > 0 ? byDay : [ weekdayOf( dtStart ) ];
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
  if ( range.start >= range.end ) {
    return err( {
      code: 'range',
      message: 'range start must be before range end',
    } );
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

  const rangeStartDate = civilDateInZone( range.start, zone );
  const dtStart = isCalendarEvent( source )
    ? civilDateInZone( source.start, zone )
    : rangeStartDate;
  const stopDate = addDays( civilDateInZone( range.end, zone ), 1 );
  const interval = recurrence.interval ?? 1;
  const excluded = new Set( source.excludedDates ?? [] );
  const byDay = recurrence.byDay;
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
    if ( recurrence.until !== undefined && occ.start > recurrence.until ) {
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

  if ( !isCalendarEvent( source ) ) {
    consider( addDays( rangeStartDate, -1 ), false );
  }

  for ( const date of iterateCivilDates(
    recurrence,
    dtStart,
    stopDate,
    interval,
  ) ) {
    if ( !consider( date, true ) ) {
      break;
    }
  }

  occurrences.sort( ( a, b ) => a.start.localeCompare( b.start ) );
  return ok( occurrences );
}
