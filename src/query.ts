import { openAvailability } from './availability.js';
import {
  descendantCalendarIds,
  inheritsBlocks,
  parentCalendarId,
  rollsUpTo,
} from './hierarchy.js';
import { normalizeUuid } from './ids.js';
import { expandRecurrence } from './recurrence.js';
import { err, ok } from './result.js';
import { overlaps } from './time.js';
import type {
  AvailabilityReport,
  Calendar,
  CalendarSnapshot,
  CalendarView,
  Result,
  TimeRange,
  Uuid,
  ViewItem,
} from './types.js';
import { validateSnapshot } from './validate.js';

function rangeError(): Result<never> {
  return err( {
    code: 'range',
    message: 'range start must be before range end',
  } );
}

function notFound( calendarId: Uuid ): Result<never> {
  return err( {
    code: 'not_found',
    message: 'calendar not found',
    details: { calendarId },
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

function sortItems( items: ViewItem[] ): ViewItem[] {
  return items.sort( ( a, b ) => {
    const start = a.start.localeCompare( b.start );
    return start !== 0 ? start : a.id.localeCompare( b.id );
  } );
}

function eventItems(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
  source: ViewItem['source'],
): Result<ViewItem[]> {
  const calendar = calendarOf( snapshot, calendarId );
  const timeZone = calendar?.timeZone ?? 'UTC';
  const key = normalizeUuid( calendarId );
  const items: ViewItem[] = [];
  for ( const event of snapshot.events ) {
    if ( normalizeUuid( event.calendarId ) !== key ) {
      continue;
    }
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
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
): ViewItem[] {
  const key = normalizeUuid( calendarId );
  const items: ViewItem[] = [];
  for ( const slot of snapshot.slots ) {
    if ( normalizeUuid( slot.calendarId ) !== key ) {
      continue;
    }
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
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
  source: ViewItem['source'],
  adHocOnly: boolean,
): ViewItem[] {
  const key = normalizeUuid( calendarId );
  const items: ViewItem[] = [];
  for ( const booking of snapshot.bookings ) {
    if ( normalizeUuid( booking.calendarId ) !== key ) {
      continue;
    }
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
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
): Result<ViewItem[]> {
  if ( !inheritsBlocks( snapshot, calendarId ) ) {
    return ok( [] );
  }
  const parent = parentCalendarId( snapshot, calendarId );
  if ( parent === undefined ) {
    return ok( [] );
  }
  const events = eventItems( snapshot, parent, range, 'inherited' );
  if ( !events.ok ) {
    return events;
  }
  const further = inheritedItems( snapshot, parent, range );
  if ( !further.ok ) {
    return further;
  }
  return ok( [
    ...events.value,
    ...bookingItems( snapshot, parent, range, 'inherited', true ),
    ...further.value,
  ] );
}

function rolledUpItems(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
): Result<ViewItem[]> {
  const items: ViewItem[] = [];
  for ( const descendant of descendantCalendarIds(
    snapshot,
    calendarId,
  ) ) {
    if ( !rollsUpTo( snapshot, descendant, calendarId ) ) {
      continue;
    }
    const events = eventItems(
      snapshot,
      descendant,
      range,
      'rolled-up',
    );
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
  const calendar = calendarOf( snapshot, calendarId );
  if ( calendar === undefined ) {
    return notFound( calendarId );
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
  if ( range.start >= range.end ) {
    return rangeError();
  }
  const calendar = calendarOf( snapshot, calendarId );
  if ( calendar === undefined ) {
    return notFound( calendarId );
  }

  const ownEvents = eventItems(
    snapshot,
    calendar.id,
    range,
    'own',
  );
  if ( !ownEvents.ok ) {
    return ownEvents;
  }
  const inherited = inheritedItems( snapshot, calendar.id, range );
  if ( !inherited.ok ) {
    return inherited;
  }
  const rolledUp = rolledUpItems( snapshot, calendar.id, range );
  if ( !rolledUp.ok ) {
    return rolledUp;
  }

  return ok( {
    calendarId: calendar.id,
    range: { start: range.start, end: range.end },
    items: sortItems( [
      ...ownEvents.value,
      ...slotItems( snapshot, calendar.id, range ),
      ...bookingItems( snapshot, calendar.id, range, 'own', false ),
      ...inherited.value,
      ...rolledUp.value,
    ] ),
  } );
}
