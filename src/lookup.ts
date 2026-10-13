import {
  buildHierarchyIndex,
  type HierarchyIndex,
} from './hierarchy.js';
import { isUuid, normalizeUuid } from './ids.js';
import { err, ok } from './result.js';
import { nowInstant } from './time.js';
import type {
  ApplyOptions,
  BookableSlot,
  Booking,
  Calendar,
  CalendarEvent,
  CalendarSnapshot,
  Instant,
  Result,
  Uuid,
} from './types.js';

/** `not_found` error for a row of `kind`, with `details.id`. */
export function notFound( kind: string, id: Uuid ): Result<never> {
  return err( {
    code: 'not_found',
    message: `${ kind } not found`,
    details: { id },
  } );
}

/** `not_found` error for a calendar, with `details.calendarId`. */
export function calendarNotFound( calendarId: Uuid ): Result<never> {
  return err( {
    code: 'not_found',
    message: 'calendar not found',
    details: { calendarId },
  } );
}

/** `range` error with a descriptive message. */
export function rangeError( message: string ): Result<never> {
  return err( { code: 'range', message } );
}

/** Row whose id matches `id` ignoring UUID case. */
export function findById<T extends { id: Uuid }>(
  rows: T[],
  id: Uuid,
): T | undefined {
  const key = normalizeUuid( id );
  return rows.find( ( row ) => normalizeUuid( row.id ) === key );
}

/** Index of the row whose id matches `id`, or `-1`. */
export function findIndexById(
  rows: { id: Uuid }[],
  id: Uuid,
): number {
  const key = normalizeUuid( id );
  return rows.findIndex( ( row ) => normalizeUuid( row.id ) === key );
}

/** Command stamp: `opts.now` or the current instant. */
export function nowOf( opts?: ApplyOptions ): Instant {
  return opts?.now ?? nowInstant();
}

/**
 * Validates `calendarId` is a UUID that resolves in `snapshot`.
 * Does not validate the snapshot itself.
 */
export function requireCalendar(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
): Result<true> {
  if ( !isUuid( calendarId ) ) {
    return err( {
      code: 'validation',
      message: 'calendarId is not a UUID',
      details: { calendarId },
    } );
  }
  if ( findById( snapshot.calendars, calendarId ) === undefined ) {
    return notFound( 'calendar', calendarId );
  }
  return ok( true );
}

/**
 * Copy of `rows` sorted by `compare`. Sorting the copy keeps the
 * immutability rule: arrays handed back never alias the input.
 */
export function sortedCopy<T>(
  rows: readonly T[],
  compare: ( a: T, b: T ) => number,
): T[] {
  return [ ...rows ].sort( compare );
}

/**
 * Per-call lookup tables over one snapshot. Build once at the top of
 * a public function and pass it down; never rebuild it per hop.
 * Treat the snapshot it wraps as read-only.
 */
export interface SnapshotIndex {
  snapshot: CalendarSnapshot;
  hierarchy: HierarchyIndex;
  calendarsById: Map<string, Calendar>;
  eventsById: Map<string, CalendarEvent>;
  slotsById: Map<string, BookableSlot>;
  eventsByCalendar: Map<string, CalendarEvent[]>;
  slotsByCalendar: Map<string, BookableSlot[]>;
  bookingsByCalendar: Map<string, Booking[]>;
}

function groupByCalendar<T extends { calendarId: Uuid }>(
  rows: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for ( const row of rows ) {
    const key = normalizeUuid( row.calendarId );
    const group = groups.get( key );
    if ( group ) {
      group.push( row );
    } else {
      groups.set( key, [ row ] );
    }
  }
  return groups;
}

function mapById<T extends { id: Uuid }>( rows: T[] ): Map<string, T> {
  return new Map( rows.map( ( row ) => [ normalizeUuid( row.id ), row ] ) );
}

/** Build the lookup tables for `snapshot` (internal). */
export function buildSnapshotIndex(
  snapshot: CalendarSnapshot,
): SnapshotIndex {
  const hierarchy = buildHierarchyIndex( snapshot );
  return {
    snapshot,
    hierarchy,
    calendarsById: hierarchy.calendars,
    eventsById: mapById( snapshot.events ),
    slotsById: mapById( snapshot.slots ),
    eventsByCalendar: groupByCalendar( snapshot.events ),
    slotsByCalendar: groupByCalendar( snapshot.slots ),
    bookingsByCalendar: groupByCalendar( snapshot.bookings ),
  };
}

const NO_ROWS: readonly never[] = [];

/** Events on `calendarId` in snapshot order. */
export function eventsOn(
  index: SnapshotIndex,
  calendarId: Uuid,
): readonly CalendarEvent[] {
  return index.eventsByCalendar.get( normalizeUuid( calendarId ) ) ?? NO_ROWS;
}

/** Slots on `calendarId` in snapshot order. */
export function slotsOf(
  index: SnapshotIndex,
  calendarId: Uuid,
): readonly BookableSlot[] {
  return index.slotsByCalendar.get( normalizeUuid( calendarId ) ) ?? NO_ROWS;
}

/** Bookings on `calendarId` in snapshot order. */
export function bookingsOn(
  index: SnapshotIndex,
  calendarId: Uuid,
): readonly Booking[] {
  return (
    index.bookingsByCalendar.get( normalizeUuid( calendarId ) ) ?? NO_ROWS
  );
}

/** Calendar row for `calendarId`, if any. */
export function calendarIn(
  index: SnapshotIndex,
  calendarId: Uuid,
): Calendar | undefined {
  return index.calendarsById.get( normalizeUuid( calendarId ) );
}
