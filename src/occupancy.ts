import { inheritsBlocksIn, parentOf } from './hierarchy.js';
import { normalizeUuid } from './ids.js';
import {
  bookingsOn,
  buildSnapshotIndex,
  calendarIn,
  eventsOn,
  rangeError,
  slotsOf,
  sortedCopy,
  type SnapshotIndex,
} from './lookup.js';
import { expandRecurrence } from './recurrence.js';
import { ok } from './result.js';
import { overlaps, rangeProblem } from './time.js';
import type {
  CalendarSnapshot,
  Occurrence,
  Result,
  TimeRange,
  TimeZone,
  Uuid,
} from './types.js';
import { validateSnapshot } from './validate.js';

/** Copy of `occurrences` sorted by start then end. */
export function sortOccurrences( occurrences: Occurrence[] ): Occurrence[] {
  return sortedCopy( occurrences, ( a, b ) => {
    const start = a.start.localeCompare( b.start );
    return start !== 0 ? start : a.end.localeCompare( b.end );
  } );
}

function expandEventsOn(
  index: SnapshotIndex,
  calendarId: Uuid,
  range: TimeRange,
  timeZone: TimeZone,
): Result<Occurrence[]> {
  const occurrences: Occurrence[] = [];
  for ( const event of eventsOn( index, calendarId ) ) {
    const expanded = expandRecurrence( event, range, timeZone );
    if ( !expanded.ok ) {
      return expanded;
    }
    occurrences.push( ...expanded.value );
  }
  return ok( occurrences );
}

function adHocOn(
  index: SnapshotIndex,
  calendarId: Uuid,
  range: TimeRange,
): Occurrence[] {
  const occurrences: Occurrence[] = [];
  for ( const booking of bookingsOn( index, calendarId ) ) {
    if (
      booking.eventId !== undefined ||
      booking.slotId !== undefined
    ) {
      continue;
    }
    const occ = { start: booking.start, end: booking.end };
    if ( overlaps( occ, range ) ) {
      occurrences.push( occ );
    }
  }
  return occurrences;
}

function slotsOn(
  index: SnapshotIndex,
  calendarId: Uuid,
  range: TimeRange,
): Occurrence[] {
  const occurrences: Occurrence[] = [];
  for ( const slot of slotsOf( index, calendarId ) ) {
    const occ = { start: slot.start, end: slot.end };
    if ( overlaps( occ, range ) ) {
      occurrences.push( occ );
    }
  }
  return occurrences;
}

function eventsAndAdHoc(
  index: SnapshotIndex,
  calendarId: Uuid,
  range: TimeRange,
): Result<Occurrence[]> {
  const timeZone = calendarIn( index, calendarId )?.timeZone ?? 'UTC';
  const events = expandEventsOn( index, calendarId, range, timeZone );
  if ( !events.ok ) {
    return events;
  }
  return ok( [ ...events.value, ...adHocOn( index, calendarId, range ) ] );
}

/**
 * Own exclusive busy, unsorted. Internal: the snapshot behind `index`
 * must already be validated and `range` checked.
 */
export function ownBusyIn(
  index: SnapshotIndex,
  calendarId: Uuid,
  range: TimeRange,
): Result<Occurrence[]> {
  const own = eventsAndAdHoc( index, calendarId, range );
  if ( !own.ok ) {
    return own;
  }
  return ok( [
    ...own.value,
    ...slotsOn( index, calendarId, range ),
  ] );
}

/**
 * Inherited ancestor blocks, unsorted. Internal: the snapshot behind
 * `index` must already be validated and `range` checked.
 */
export function inheritedIn(
  index: SnapshotIndex,
  calendarId: Uuid,
  range: TimeRange,
): Result<Occurrence[]> {
  const blocks: Occurrence[] = [];
  let current = calendarId;
  const seen = new Set<string>();
  while ( inheritsBlocksIn( index.hierarchy, current ) ) {
    const parent = parentOf( index.hierarchy, current );
    if ( parent === undefined ) {
      break;
    }
    const key = normalizeUuid( parent );
    if ( seen.has( key ) ) {
      break;
    }
    seen.add( key );
    const parentOwn = eventsAndAdHoc( index, parent, range );
    if ( !parentOwn.ok ) {
      return parentOwn;
    }
    blocks.push( ...parentOwn.value );
    current = parent;
  }
  return ok( blocks );
}

/**
 * Own busy union inherited blocks, sorted. Internal: the snapshot
 * behind `index` must already be validated and `range` checked.
 */
export function effectiveBusyIn(
  index: SnapshotIndex,
  calendarId: Uuid,
  range: TimeRange,
): Result<Occurrence[]> {
  const own = ownBusyIn( index, calendarId, range );
  if ( !own.ok ) {
    return own;
  }
  const inherited = inheritedIn( index, calendarId, range );
  if ( !inherited.ok ) {
    return inherited;
  }
  return ok( sortOccurrences( [ ...own.value, ...inherited.value ] ) );
}

/** Validates the snapshot and range once; returns the index. */
function prepare(
  snapshot: CalendarSnapshot,
  range: TimeRange,
): Result<SnapshotIndex> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  const problem = rangeProblem( range );
  if ( problem !== undefined ) {
    return rangeError( problem );
  }
  return ok( buildSnapshotIndex( snapshot ) );
}

/**
 * Exclusive busy on this calendar: expanded events (all occupancies),
 * slots, and ad-hoc bookings that intersect `range`.
 * Unknown `calendarId` yields `[]` (queries use `not_found`).
 */
export function ownExclusiveBusy(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
): Result<Occurrence[]> {
  const index = prepare( snapshot, range );
  if ( !index.ok ) {
    return index;
  }
  const own = ownBusyIn( index.value, calendarId, range );
  if ( !own.ok ) {
    return own;
  }
  return ok( sortOccurrences( own.value ) );
}

/**
 * Ancestor events and ad-hoc bookings inherited by this calendar.
 * Parent slots are never inherited. The chain stops when a calendar
 * does not inherit blocks or has no parent calendar.
 * Unknown `calendarId` yields `[]` (queries use `not_found`).
 */
export function inheritedBlocks(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
): Result<Occurrence[]> {
  const index = prepare( snapshot, range );
  if ( !index.ok ) {
    return index;
  }
  const inherited = inheritedIn( index.value, calendarId, range );
  if ( !inherited.ok ) {
    return inherited;
  }
  return ok( sortOccurrences( inherited.value ) );
}

/**
 * Own exclusive busy union inherited ancestor blocks.
 * Unknown `calendarId` yields `[]` (queries use `not_found`).
 */
export function effectiveExclusiveBusy(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
): Result<Occurrence[]> {
  const index = prepare( snapshot, range );
  if ( !index.ok ) {
    return index;
  }
  return effectiveBusyIn( index.value, calendarId, range );
}
