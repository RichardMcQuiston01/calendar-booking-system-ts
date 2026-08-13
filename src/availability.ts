import { normalizeUuid } from './ids.js';
import { effectiveExclusiveBusy } from './occupancy.js';
import { expandRecurrence } from './recurrence.js';
import { err, ok } from './result.js';
import type {
  CalendarSnapshot,
  Occurrence,
  Result,
  TimeRange,
  Uuid,
} from './types.js';
import { validateSnapshot } from './validate.js';

function rangeError(): Result<never> {
  return err( {
    code: 'range',
    message: 'range start must be before range end',
  } );
}

function splitAround(
  open: Occurrence,
  busy: Occurrence,
): Occurrence[] {
  if ( busy.end <= open.start || busy.start >= open.end ) {
    return [ open ];
  }
  const pieces: Occurrence[] = [];
  if ( open.start < busy.start ) {
    pieces.push( { start: open.start, end: busy.start } );
  }
  if ( busy.end < open.end ) {
    pieces.push( { start: busy.end, end: open.end } );
  }
  return pieces;
}

function mergeIntervals( intervals: Occurrence[] ): Occurrence[] {
  if ( intervals.length === 0 ) {
    return [];
  }
  const sorted = [ ...intervals ].sort( ( a, b ) => {
    const start = a.start.localeCompare( b.start );
    return start !== 0 ? start : a.end.localeCompare( b.end );
  } );
  const first = sorted[ 0 ];
  if ( first === undefined ) {
    return [];
  }
  const merged: Occurrence[] = [ { ...first } ];
  for ( let i = 1; i < sorted.length; i += 1 ) {
    const current = sorted[ i ];
    const last = merged[ merged.length - 1 ];
    if ( current === undefined || last === undefined ) {
      continue;
    }
    if ( last.end >= current.start ) {
      if ( current.end > last.end ) {
        last.end = current.end;
      }
    } else {
      merged.push( { ...current } );
    }
  }
  return merged;
}

/**
 * Working-hour rule occurrences minus effective exclusive busy.
 * Adjacent and overlapping remnants are merged (`a.end >= b.start`).
 */
export function openAvailability(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
): Result<Occurrence[]> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  if ( range.start >= range.end ) {
    return rangeError();
  }

  const key = normalizeUuid( calendarId );
  const calendar = snapshot.calendars.find(
    ( row ) => normalizeUuid( row.id ) === key,
  );
  if ( calendar === undefined ) {
    return ok( [] );
  }

  const opens: Occurrence[] = [];
  for ( const rule of snapshot.availabilityRules ) {
    if ( normalizeUuid( rule.calendarId ) !== key ) {
      continue;
    }
    const expanded = expandRecurrence( rule, range, calendar.timeZone );
    if ( !expanded.ok ) {
      return expanded;
    }
    opens.push( ...expanded.value );
  }

  const busy = effectiveExclusiveBusy( snapshot, calendarId, range );
  if ( !busy.ok ) {
    return busy;
  }

  let remaining = opens;
  for ( const block of busy.value ) {
    remaining = remaining.flatMap( ( open ) => splitAround( open, block ) );
  }
  return ok( mergeIntervals( remaining ) );
}
