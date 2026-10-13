import { openAvailability } from './availability.js';
import {
  descendantsOf,
  inheritsBlocksIn,
  parentOf,
  rollsUpToIn,
} from './hierarchy.js';
import { normalizeUuid } from './ids.js';
import {
  bookingsOn,
  buildSnapshotIndex,
  calendarIn,
  calendarNotFound,
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
  AvailabilityReport,
  CalendarSnapshot,
  CalendarView,
  Result,
  TimeRange,
  Uuid,
  ViewItem,
} from './types.js';
import { validateSnapshot } from './validate.js';

function sortItems( items: ViewItem[] ): ViewItem[] {
  return sortedCopy( items, ( a, b ) => {
    const start = a.start.localeCompare( b.start );
    return start !== 0 ? start : a.id.localeCompare( b.id );
  } );
}

function eventItems(
  index: SnapshotIndex,
  calendarId: Uuid,
  range: TimeRange,
  source: ViewItem['source'],
): Result<ViewItem[]> {
  const timeZone = calendarIn( index, calendarId )?.timeZone ?? 'UTC';
  const items: ViewItem[] = [];
  for ( const event of eventsOn( index, calendarId ) ) {
    const expanded = expandRecurrence( event, range, timeZone );
    if ( !expanded.ok ) {
      return expanded;
    }
    for ( const occ of expanded.value ) {
      items.push( {
        source,
        type: 'event',
        id: event.id,
        calendarId: event.calendarId,
        title: event.title,
        start: occ.start,
        end: occ.end,
        occupancy: event.occupancy,
      } );
    }
  }
  return ok( items );
}

function slotItems(
  index: SnapshotIndex,
  calendarId: Uuid,
  range: TimeRange,
): ViewItem[] {
  const items: ViewItem[] = [];
  for ( const slot of slotsOf( index, calendarId ) ) {
    const occ = { start: slot.start, end: slot.end };
    if ( !overlaps( occ, range ) ) {
      continue;
    }
    items.push( {
      source: 'own',
      type: 'slot',
      id: slot.id,
      calendarId: slot.calendarId,
      start: slot.start,
      end: slot.end,
      occupancy: slot.occupancy,
    } );
  }
  return items;
}

function bookingItems(
  index: SnapshotIndex,
  calendarId: Uuid,
  range: TimeRange,
  source: ViewItem['source'],
  adHocOnly: boolean,
): ViewItem[] {
  const items: ViewItem[] = [];
  for ( const booking of bookingsOn( index, calendarId ) ) {
    if (
      adHocOnly &&
      ( booking.eventId !== undefined || booking.slotId !== undefined )
    ) {
      continue;
    }
    const occ = { start: booking.start, end: booking.end };
    if ( !overlaps( occ, range ) ) {
      continue;
    }
    items.push( {
      source,
      type: 'booking',
      id: booking.id,
      calendarId: booking.calendarId,
      start: booking.start,
      end: booking.end,
    } );
  }
  return items;
}

function inheritedItems(
  index: SnapshotIndex,
  calendarId: Uuid,
  range: TimeRange,
): Result<ViewItem[]> {
  const items: ViewItem[] = [];
  const seen = new Set<string>();
  let current = calendarId;
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
    const events = eventItems( index, parent, range, 'inherited' );
    if ( !events.ok ) {
      return events;
    }
    items.push(
      ...events.value,
      ...bookingItems( index, parent, range, 'inherited', true ),
    );
    current = parent;
  }
  return ok( items );
}

function rolledUpItems(
  index: SnapshotIndex,
  calendarId: Uuid,
  range: TimeRange,
): Result<ViewItem[]> {
  const items: ViewItem[] = [];
  for ( const descendant of descendantsOf( index.hierarchy, calendarId ) ) {
    if ( !rollsUpToIn( index.hierarchy, descendant, calendarId ) ) {
      continue;
    }
    const events = eventItems( index, descendant, range, 'rolled-up' );
    if ( !events.ok ) {
      return events;
    }
    items.push( ...events.value );
  }
  return ok( items );
}

/**
 * Open ad-hoc intervals for `calendarId` in `range`.
 * Unknown calendar → `not_found`; bad range → `range`.
 */
export function queryAvailability(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
): Result<AvailabilityReport> {
  const open = openAvailability( snapshot, calendarId, range );
  if ( !open.ok ) {
    return open;
  }
  const calendar = snapshot.calendars.find(
    ( row ) => normalizeUuid( row.id ) === normalizeUuid( calendarId ),
  );
  if ( calendar === undefined ) {
    return calendarNotFound( calendarId );
  }
  return ok( {
    calendarId: calendar.id,
    intervals: open.value,
  } );
}

/**
 * Tagged items that intersect `range` on `calendarId`: own events,
 * slots, and bookings; inherited ancestor events and ad-hoc
 * bookings; rolled-up descendant events.
 */
export function queryView(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
): Result<CalendarView> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  const problem = rangeProblem( range );
  if ( problem !== undefined ) {
    return rangeError( problem );
  }
  const index = buildSnapshotIndex( snapshot );
  const calendar = calendarIn( index, calendarId );
  if ( calendar === undefined ) {
    return calendarNotFound( calendarId );
  }

  const ownEvents = eventItems( index, calendar.id, range, 'own' );
  if ( !ownEvents.ok ) {
    return ownEvents;
  }
  const inherited = inheritedItems( index, calendar.id, range );
  if ( !inherited.ok ) {
    return inherited;
  }
  const rolledUp = rolledUpItems( index, calendar.id, range );
  if ( !rolledUp.ok ) {
    return rolledUp;
  }

  return ok( {
    calendarId: calendar.id,
    range: { start: range.start, end: range.end },
    items: sortItems( [
      ...ownEvents.value,
      ...slotItems( index, calendar.id, range ),
      ...bookingItems( index, calendar.id, range, 'own', false ),
      ...inherited.value,
      ...rolledUp.value,
    ] ),
  } );
}
