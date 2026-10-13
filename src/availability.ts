import {
  buildSnapshotIndex,
  calendarIn,
  rangeError,
  type SnapshotIndex,
} from './lookup.js';
import { normalizeUuid } from './ids.js';
import { effectiveBusyIn } from './occupancy.js';
import { expandRecurrence } from './recurrence.js';
import { ok } from './result.js';
import { overlaps, rangeProblem } from './time.js';
import type {
  CalendarSnapshot,
  Occurrence,
  Result,
  TimeRange,
  Uuid,
} from './types.js';
import { validateSnapshot } from './validate.js';

function splitAround(
  open: Occurrence,
  busy: Occurrence,
): Occurrence[] {
  if ( !overlaps( open, busy ) ) {
    return [ open ];
  }
  const pieces: Occurrence[] = [];
  if ( Date.parse( open.start ) < Date.parse( busy.start ) ) {
    pieces.push( { start: open.start, end: busy.start } );
  }
  if ( Date.parse( busy.end ) < Date.parse( open.end ) ) {
    pieces.push( { start: busy.end, end: open.end } );
  }
  return pieces;
}

function mergeIntervals( intervals: Occurrence[] ): Occurrence[] {
  if ( intervals.length === 0 ) {
    return [];
  }
  const sorted = [ ...intervals ].sort( ( a, b ) => {
    const start = Date.parse( a.start ) - Date.parse( b.start );
    return start !== 0 ? start : Date.parse( a.end ) - Date.parse( b.end );
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
    if ( Date.parse( last.end ) >= Date.parse( current.start ) ) {
      if ( Date.parse( current.end ) > Date.parse( last.end ) ) {
        last.end = current.end;
      }
    } else {
      merged.push( { ...current } );
    }
  }
  return merged;
}

/**
 * Open intervals for an already validated snapshot and checked range.
 * Internal: callers validate once and share `index`.
 */
export function openAvailabilityIn(
  index: SnapshotIndex,
  calendarId: Uuid,
  range: TimeRange,
): Result<Occurrence[]> {
  const calendar = calendarIn( index, calendarId );
  if ( calendar === undefined ) {
    return ok( [] );
  }

  const key = normalizeUuid( calendarId );
  const opens: Occurrence[] = [];
  for ( const rule of index.snapshot.availabilityRules ) {
    if ( normalizeUuid( rule.calendarId ) !== key ) {
      continue;
    }
    const expanded = expandRecurrence( rule, range, calendar.timeZone );
    if ( !expanded.ok ) {
      return expanded;
    }
    opens.push( ...expanded.value );
  }

  const busy = effectiveBusyIn( index, calendarId, range );
  if ( !busy.ok ) {
    return busy;
  }

  let remaining = opens;
  for ( const block of busy.value ) {
    remaining = remaining.flatMap( ( open ) => splitAround( open, block ) );
  }
  return ok( mergeIntervals( remaining ) );
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
  const problem = rangeProblem( range );
  if ( problem !== undefined ) {
    return rangeError( problem );
  }
  return openAvailabilityIn(
    buildSnapshotIndex( snapshot ),
    calendarId,
    range,
  );
}
