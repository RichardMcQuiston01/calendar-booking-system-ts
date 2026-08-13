import {
  inheritsBlocks,
  parentCalendarId,
} from './hierarchy.js';
import { normalizeUuid } from './ids.js';
import { expandRecurrence } from './recurrence.js';
import { err, ok } from './result.js';
import { overlaps } from './time.js';
import type {
  Calendar,
  CalendarSnapshot,
  Occurrence,
  Result,
  TimeRange,
  TimeZone,
  Uuid,
} from './types.js';
import { validateSnapshot } from './validate.js';

function rangeError(): Result<never> {
  return err( {
    code: 'range',
    message: 'range start must be before range end',
  } );
}

function calendarOf(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
): Calendar | undefined {
  const key = normalizeUuid( calendarId );
  return snapshot.calendars.find(
    ( row ) => normalizeUuid( row.id ) === key,
  );
}

function sortOccurrences( occurrences: Occurrence[] ): Occurrence[] {
  return occurrences.sort( ( a, b ) => {
    const start = a.start.localeCompare( b.start );
    return start !== 0 ? start : a.end.localeCompare( b.end );
  } );
}

function expandEventsOn(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
  timeZone: TimeZone,
): Result<Occurrence[]> {
  const key = normalizeUuid( calendarId );
  const occurrences: Occurrence[] = [];
  for ( const event of snapshot.events ) {
    if ( normalizeUuid( event.calendarId ) !== key ) {
      continue;
    }
    const expanded = expandRecurrence( event, range, timeZone );
    if ( !expanded.ok ) {
      return expanded;
    }
    occurrences.push( ...expanded.value );
  }
  return ok( occurrences );
}

function adHocOn(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
): Occurrence[] {
  const key = normalizeUuid( calendarId );
  const occurrences: Occurrence[] = [];
  for ( const booking of snapshot.bookings ) {
    if ( normalizeUuid( booking.calendarId ) !== key ) {
      continue;
    }
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
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
): Occurrence[] {
  const key = normalizeUuid( calendarId );
  const occurrences: Occurrence[] = [];
  for ( const slot of snapshot.slots ) {
    if ( normalizeUuid( slot.calendarId ) !== key ) {
      continue;
    }
    const occ = { start: slot.start, end: slot.end };
    if ( overlaps( occ, range ) ) {
      occurrences.push( occ );
    }
  }
  return occurrences;
}

function eventsAndAdHoc(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
): Result<Occurrence[]> {
  const calendar = calendarOf( snapshot, calendarId );
  const timeZone = calendar?.timeZone ?? 'UTC';
  const events = expandEventsOn(
    snapshot,
    calendarId,
    range,
    timeZone,
  );
  if ( !events.ok ) {
    return events;
  }
  return ok( [ ...events.value, ...adHocOn( snapshot, calendarId, range ) ] );
}

function ownBusyUnchecked(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
): Result<Occurrence[]> {
  const own = eventsAndAdHoc( snapshot, calendarId, range );
  if ( !own.ok ) {
    return own;
  }
  return ok( [
    ...own.value,
    ...slotsOn( snapshot, calendarId, range ),
  ] );
}

function inheritedUnchecked(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
): Result<Occurrence[]> {
  if ( !inheritsBlocks( snapshot, calendarId ) ) {
    return ok( [] );
  }
  const parent = parentCalendarId( snapshot, calendarId );
  if ( parent === undefined ) {
    return ok( [] );
  }
  const parentOwn = eventsAndAdHoc( snapshot, parent, range );
  if ( !parentOwn.ok ) {
    return parentOwn;
  }
  const parentInherited = inheritedUnchecked( snapshot, parent, range );
  if ( !parentInherited.ok ) {
    return parentInherited;
  }
  return ok( [ ...parentOwn.value, ...parentInherited.value ] );
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
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  if ( range.start >= range.end ) {
    return rangeError();
  }
  const own = ownBusyUnchecked( snapshot, calendarId, range );
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
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  if ( range.start >= range.end ) {
    return rangeError();
  }
  const inherited = inheritedUnchecked( snapshot, calendarId, range );
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
  const own = ownExclusiveBusy( snapshot, calendarId, range );
  if ( !own.ok ) {
    return own;
  }
  const inherited = inheritedBlocks( snapshot, calendarId, range );
  if ( !inherited.ok ) {
    return inherited;
  }
  return ok( sortOccurrences( [ ...own.value, ...inherited.value ] ) );
}
