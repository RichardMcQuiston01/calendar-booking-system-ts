import { openAvailability } from './availability.js';
import {
  inheritsBlocks,
  parentCalendarId,
} from './hierarchy.js';
import { isUuid, normalizeUuid } from './ids.js';
import {
  inheritedBlocks,
  ownExclusiveBusy,
} from './occupancy.js';
import { expandRecurrence } from './recurrence.js';
import { err, ok } from './result.js';
import { overlaps, parseInstant, toInstant } from './time.js';
import type {
  BookableSlot,
  Booking,
  BookingInput,
  CalendarEvent,
  CalendarSnapshot,
  CheckReport,
  Conflict,
  EventInput,
  Instant,
  Occupancy,
  Occurrence,
  Result,
  SlotInput,
  TimeRange,
  Uuid,
} from './types.js';
import { validateSnapshot } from './validate.js';

const COMMAND_STAMP = '1970-01-01T00:00:00.000Z';

const DEFAULT_OCCUPANCY: Occupancy = { kind: 'exclusive' };

function notFound( kind: string, id: Uuid ): Result<never> {
  return err( {
    code: 'not_found',
    message: `${ kind } not found`,
    details: { id },
  } );
}

function findById<T extends { id: Uuid }>(
  rows: T[],
  id: Uuid,
): T | undefined {
  const key = normalizeUuid( id );
  return rows.find( ( row ) => normalizeUuid( row.id ) === key );
}

function calendarOf(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
) {
  return findById( snapshot.calendars, calendarId );
}

function paddedRange( start: Instant, end: Instant ): TimeRange {
  const startAt = parseInstant( start );
  const endAt = parseInstant( end );
  const day = 24 * 60 * 60 * 1000;
  return {
    start: toInstant(
      new Date( ( startAt ?? new Date( 0 ) ).getTime() - day ),
    ),
    end: toInstant(
      new Date( ( endAt ?? new Date( 0 ) ).getTime() + day ),
    ),
  };
}

function contains(
  outer: Occurrence,
  inner: Occurrence,
): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

function sameInterval( a: Occurrence, b: Occurrence ): boolean {
  return a.start === b.start && a.end === b.end;
}

interface ExcludeIds {
  eventId?: Uuid;
  slotId?: Uuid;
  bookingId?: Uuid;
}

function snapshotExcluding(
  snapshot: CalendarSnapshot,
  exclude: ExcludeIds,
): CalendarSnapshot {
  const eventKey = exclude.eventId
    ? normalizeUuid( exclude.eventId )
    : undefined;
  const slotKey = exclude.slotId
    ? normalizeUuid( exclude.slotId )
    : undefined;
  const bookingKey = exclude.bookingId
    ? normalizeUuid( exclude.bookingId )
    : undefined;
  if (
    eventKey === undefined &&
    slotKey === undefined &&
    bookingKey === undefined
  ) {
    return snapshot;
  }
  return {
    ...snapshot,
    events: eventKey === undefined
      ? snapshot.events
      : snapshot.events.filter(
        ( row ) => normalizeUuid( row.id ) !== eventKey,
      ),
    slots: slotKey === undefined
      ? snapshot.slots
      : snapshot.slots.filter(
        ( row ) => normalizeUuid( row.id ) !== slotKey,
      ),
    bookings: snapshot.bookings.filter( ( row ) => {
      if (
        bookingKey !== undefined &&
        normalizeUuid( row.id ) === bookingKey
      ) {
        return false;
      }
      if (
        eventKey !== undefined &&
        row.eventId !== undefined &&
        normalizeUuid( row.eventId ) === eventKey
      ) {
        return false;
      }
      if (
        slotKey !== undefined &&
        row.slotId !== undefined &&
        normalizeUuid( row.slotId ) === slotKey
      ) {
        return false;
      }
      return true;
    } ),
  };
}

function eventFromInput(
  input: EventInput,
  createdAt: Instant,
  updatedAt: Instant,
): CalendarEvent {
  return {
    ...input,
    occupancy: input.occupancy ?? DEFAULT_OCCUPANCY,
    createdAt,
    updatedAt,
  };
}

function slotFromInput(
  input: SlotInput,
  createdAt: Instant,
  updatedAt: Instant,
): BookableSlot {
  return {
    ...input,
    occupancy: input.occupancy ?? DEFAULT_OCCUPANCY,
    createdAt,
    updatedAt,
  };
}

function bookingFromInput(
  input: BookingInput,
  createdAt: Instant,
  updatedAt: Instant,
): Booking {
  return { ...input, createdAt, updatedAt };
}

function previewOk(
  snapshot: CalendarSnapshot,
): Result<true> {
  const result = validateSnapshot( snapshot );
  if ( !result.ok ) {
    return result;
  }
  return ok( true );
}

function matchEventSource(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  interval: Occurrence,
  range: TimeRange,
): Conflict['source'] | undefined {
  const key = normalizeUuid( calendarId );
  const calendar = calendarOf( snapshot, calendarId );
  const zone = calendar?.timeZone ?? 'UTC';
  for ( const event of snapshot.events ) {
    if ( normalizeUuid( event.calendarId ) !== key ) {
      continue;
    }
    const expanded = expandRecurrence(
      event,
      range,
      event.timeZone ?? zone,
    );
    if ( !expanded.ok ) {
      continue;
    }
    if (
      expanded.value.some(
        ( occ ) =>
          sameInterval( occ, interval ) || overlaps( occ, interval ),
      )
    ) {
      return { type: 'event', id: event.id };
    }
  }
  return undefined;
}

function matchOwnSource(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  interval: Occurrence,
  range: TimeRange,
): Conflict['source'] {
  const event = matchEventSource(
    snapshot,
    calendarId,
    interval,
    range,
  );
  if ( event ) {
    return event;
  }
  const key = normalizeUuid( calendarId );
  for ( const slot of snapshot.slots ) {
    if ( normalizeUuid( slot.calendarId ) !== key ) {
      continue;
    }
    const occ = { start: slot.start, end: slot.end };
    if ( sameInterval( occ, interval ) || overlaps( occ, interval ) ) {
      return { type: 'slot', id: slot.id };
    }
  }
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
    if ( sameInterval( occ, interval ) || overlaps( occ, interval ) ) {
      return { type: 'booking', id: booking.id };
    }
  }
  return { type: 'availability' };
}

function matchInheritedSource(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  interval: Occurrence,
  range: TimeRange,
): Conflict['source'] {
  let current = calendarId;
  while ( inheritsBlocks( snapshot, current ) ) {
    const parent = parentCalendarId( snapshot, current );
    if ( parent === undefined ) {
      break;
    }
    const event = matchEventSource(
      snapshot,
      parent,
      interval,
      range,
    );
    if ( event ) {
      return event;
    }
    const key = normalizeUuid( parent );
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
      if (
        sameInterval( occ, interval ) ||
        overlaps( occ, interval )
      ) {
        return { type: 'booking', id: booking.id };
      }
    }
    current = parent;
  }
  return { type: 'availability' };
}

function pushBusyConflicts(
  conflicts: Conflict[],
  calendarId: Uuid,
  occ: Occurrence,
  inherited: Occurrence[],
  own: Occurrence[],
  snapshot: CalendarSnapshot,
  range: TimeRange,
): void {
  for ( const block of inherited ) {
    if ( !overlaps( occ, block ) ) {
      continue;
    }
    conflicts.push( {
      kind: 'inherited-block',
      calendarId,
      start: block.start,
      end: block.end,
      source: matchInheritedSource(
        snapshot,
        calendarId,
        block,
        range,
      ),
    } );
  }
  for ( const busy of own ) {
    if ( !overlaps( occ, busy ) ) {
      continue;
    }
    conflicts.push( {
      kind: 'exclusive-overlap',
      calendarId,
      start: busy.start,
      end: busy.end,
      source: matchOwnSource( snapshot, calendarId, busy, range ),
    } );
  }
}

function collectEventConflicts(
  snapshot: CalendarSnapshot,
  record: CalendarEvent,
): Result<Conflict[]> {
  const calendar = calendarOf( snapshot, record.calendarId );
  if ( calendar === undefined ) {
    return notFound( 'calendar', record.calendarId );
  }
  const range = paddedRange( record.start, record.end );
  const expanded = expandRecurrence(
    record,
    range,
    record.timeZone ?? calendar.timeZone,
  );
  if ( !expanded.ok ) {
    return expanded;
  }
  const filtered = snapshotExcluding( snapshot, {
    eventId: record.id,
  } );
  const own = ownExclusiveBusy( filtered, record.calendarId, range );
  if ( !own.ok ) {
    return own;
  }
  const inherited = inheritedBlocks(
    filtered,
    record.calendarId,
    range,
  );
  if ( !inherited.ok ) {
    return inherited;
  }
  const conflicts: Conflict[] = [];
  for ( const occ of expanded.value ) {
    pushBusyConflicts(
      conflicts,
      record.calendarId,
      occ,
      inherited.value,
      own.value,
      filtered,
      range,
    );
  }
  return ok( conflicts );
}

function collectSlotConflicts(
  snapshot: CalendarSnapshot,
  record: BookableSlot,
): Result<Conflict[]> {
  if ( calendarOf( snapshot, record.calendarId ) === undefined ) {
    return notFound( 'calendar', record.calendarId );
  }
  const range = paddedRange( record.start, record.end );
  const filtered = snapshotExcluding( snapshot, {
    slotId: record.id,
  } );
  const own = ownExclusiveBusy( filtered, record.calendarId, range );
  if ( !own.ok ) {
    return own;
  }
  const inherited = inheritedBlocks(
    filtered,
    record.calendarId,
    range,
  );
  if ( !inherited.ok ) {
    return inherited;
  }
  const conflicts: Conflict[] = [];
  pushBusyConflicts(
    conflicts,
    record.calendarId,
    { start: record.start, end: record.end },
    inherited.value,
    own.value,
    filtered,
    range,
  );
  return ok( conflicts );
}

function occupancyMax( occupancy: Occupancy ): number {
  return occupancy.kind === 'capacity' ? occupancy.max : 1;
}

function collectEventSeat(
  snapshot: CalendarSnapshot,
  record: Booking,
  eventId: Uuid,
): Result<CheckReport> {
  const event = findById( snapshot.events, eventId );
  if ( event === undefined ) {
    return notFound( 'event', eventId );
  }
  if (
    normalizeUuid( event.calendarId ) !==
    normalizeUuid( record.calendarId )
  ) {
    return err( {
      code: 'integrity',
      message: 'booking eventId is on a different calendar',
      details: { id: record.id },
    } );
  }
  const calendar = calendarOf( snapshot, record.calendarId );
  const zone = event.timeZone ?? calendar?.timeZone ?? 'UTC';
  const range = paddedRange( record.start, record.end );
  const expanded = expandRecurrence( event, range, zone );
  if ( !expanded.ok ) {
    return expanded;
  }
  const bookingOcc = { start: record.start, end: record.end };
  const occ = expanded.value.find( ( row ) => contains( row, bookingOcc ) );
  if ( occ === undefined ) {
    return ok( {
      conflicts: [ {
        kind: 'outside-target',
        calendarId: record.calendarId,
        start: record.start,
        end: record.end,
        source: { type: 'event', id: event.id },
      } ],
    } );
  }
  const key = normalizeUuid( event.id );
  const self = normalizeUuid( record.id );
  const current = snapshot.bookings.filter( ( row ) => {
    if ( row.eventId === undefined ) {
      return false;
    }
    if ( normalizeUuid( row.eventId ) !== key ) {
      return false;
    }
    if ( normalizeUuid( row.id ) === self ) {
      return false;
    }
    return overlaps( { start: row.start, end: row.end }, occ );
  } ).length;
  const max = occupancyMax( event.occupancy );
  const conflicts: Conflict[] = [];
  if ( current + 1 > max ) {
    conflicts.push( {
      kind: 'capacity-full',
      calendarId: record.calendarId,
      start: occ.start,
      end: occ.end,
      source: { type: 'event', id: event.id },
    } );
  }
  return ok( {
    conflicts,
    remainingCapacity: Math.max( 0, max - current - 1 ),
  } );
}

function collectSlotSeat(
  snapshot: CalendarSnapshot,
  record: Booking,
  slotId: Uuid,
): Result<CheckReport> {
  const slot = findById( snapshot.slots, slotId );
  if ( slot === undefined ) {
    return notFound( 'slot', slotId );
  }
  if (
    normalizeUuid( slot.calendarId ) !==
    normalizeUuid( record.calendarId )
  ) {
    return err( {
      code: 'integrity',
      message: 'booking slotId is on a different calendar',
      details: { id: record.id },
    } );
  }
  const bookingOcc = { start: record.start, end: record.end };
  const slotOcc = { start: slot.start, end: slot.end };
  if ( !contains( slotOcc, bookingOcc ) ) {
    return ok( {
      conflicts: [ {
        kind: 'outside-target',
        calendarId: record.calendarId,
        start: record.start,
        end: record.end,
        source: { type: 'slot', id: slot.id },
      } ],
    } );
  }
  const key = normalizeUuid( slot.id );
  const self = normalizeUuid( record.id );
  const current = snapshot.bookings.filter( ( row ) => {
    if ( row.slotId === undefined ) {
      return false;
    }
    if ( normalizeUuid( row.slotId ) !== key ) {
      return false;
    }
    if ( normalizeUuid( row.id ) === self ) {
      return false;
    }
    return true;
  } ).length;
  const max = occupancyMax( slot.occupancy );
  const conflicts: Conflict[] = [];
  if ( current + 1 > max ) {
    conflicts.push( {
      kind: 'capacity-full',
      calendarId: record.calendarId,
      start: slot.start,
      end: slot.end,
      source: { type: 'slot', id: slot.id },
    } );
  }
  return ok( {
    conflicts,
    remainingCapacity: Math.max( 0, max - current - 1 ),
  } );
}

function collectAdHoc(
  snapshot: CalendarSnapshot,
  record: Booking,
): Result<CheckReport> {
  const range = paddedRange( record.start, record.end );
  const filtered = snapshotExcluding( snapshot, {
    bookingId: record.id,
  } );
  const open = openAvailability( filtered, record.calendarId, range );
  if ( !open.ok ) {
    return open;
  }
  const bookingOcc = { start: record.start, end: record.end };
  const conflicts: Conflict[] = [];
  if ( !open.value.some( ( row ) => contains( row, bookingOcc ) ) ) {
    conflicts.push( {
      kind: 'outside-availability',
      calendarId: record.calendarId,
      start: record.start,
      end: record.end,
      source: { type: 'availability' },
    } );
  }
  const own = ownExclusiveBusy( filtered, record.calendarId, range );
  if ( !own.ok ) {
    return own;
  }
  const inherited = inheritedBlocks(
    filtered,
    record.calendarId,
    range,
  );
  if ( !inherited.ok ) {
    return inherited;
  }
  pushBusyConflicts(
    conflicts,
    record.calendarId,
    bookingOcc,
    inherited.value,
    own.value,
    filtered,
    range,
  );
  return ok( { conflicts } );
}

function collectBookingConflicts(
  snapshot: CalendarSnapshot,
  record: Booking,
): Result<CheckReport> {
  if ( calendarOf( snapshot, record.calendarId ) === undefined ) {
    return notFound( 'calendar', record.calendarId );
  }
  if ( record.eventId !== undefined ) {
    return collectEventSeat( snapshot, record, record.eventId );
  }
  if ( record.slotId !== undefined ) {
    return collectSlotSeat( snapshot, record, record.slotId );
  }
  return collectAdHoc( snapshot, record );
}

function requireCalendar(
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
  if ( calendarOf( snapshot, calendarId ) === undefined ) {
    return notFound( 'calendar', calendarId );
  }
  return ok( true );
}

/**
 * Preview occupancy conflicts for an event command.
 * Succeeds after validation even when `conflicts` is non-empty.
 */
export function checkEvent(
  snapshot: CalendarSnapshot,
  input: EventInput,
): Result<CheckReport> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  if ( !isUuid( input.id ) ) {
    return err( {
      code: 'validation',
      message: 'event id is not a UUID',
      details: { id: input.id },
    } );
  }
  const calendar = requireCalendar( snapshot, input.calendarId );
  if ( !calendar.ok ) {
    return calendar;
  }
  const record = eventFromInput(
    input,
    COMMAND_STAMP,
    COMMAND_STAMP,
  );
  const filtered = snapshotExcluding( snapshot, {
    eventId: record.id,
  } );
  const preview = previewOk( {
    ...filtered,
    events: [ ...filtered.events, record ],
  } );
  if ( !preview.ok ) {
    return preview;
  }
  const conflicts = collectEventConflicts( snapshot, record );
  if ( !conflicts.ok ) {
    return conflicts;
  }
  return ok( { conflicts: conflicts.value } );
}

/**
 * Preview occupancy conflicts for a slot command.
 * Succeeds after validation even when `conflicts` is non-empty.
 */
export function checkSlot(
  snapshot: CalendarSnapshot,
  input: SlotInput,
): Result<CheckReport> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  if ( !isUuid( input.id ) ) {
    return err( {
      code: 'validation',
      message: 'slot id is not a UUID',
      details: { id: input.id },
    } );
  }
  const calendar = requireCalendar( snapshot, input.calendarId );
  if ( !calendar.ok ) {
    return calendar;
  }
  const record = slotFromInput( input, COMMAND_STAMP, COMMAND_STAMP );
  const filtered = snapshotExcluding( snapshot, { slotId: record.id } );
  const preview = previewOk( {
    ...filtered,
    slots: [ ...filtered.slots, record ],
  } );
  if ( !preview.ok ) {
    return preview;
  }
  const conflicts = collectSlotConflicts( snapshot, record );
  if ( !conflicts.ok ) {
    return conflicts;
  }
  return ok( { conflicts: conflicts.value } );
}

/**
 * Preview occupancy, capacity, and availability conflicts for a
 * booking command. Succeeds after validation even when conflicts
 * exist. `remainingCapacity` is set only for seat bookings.
 */
export function checkBooking(
  snapshot: CalendarSnapshot,
  input: BookingInput,
): Result<CheckReport> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  if ( !isUuid( input.id ) ) {
    return err( {
      code: 'validation',
      message: 'booking id is not a UUID',
      details: { id: input.id },
    } );
  }
  const calendar = requireCalendar( snapshot, input.calendarId );
  if ( !calendar.ok ) {
    return calendar;
  }
  if ( input.eventId !== undefined && !isUuid( input.eventId ) ) {
    return err( {
      code: 'validation',
      message: 'eventId is not a UUID',
      details: { id: input.id },
    } );
  }
  if ( input.slotId !== undefined && !isUuid( input.slotId ) ) {
    return err( {
      code: 'validation',
      message: 'slotId is not a UUID',
      details: { id: input.id },
    } );
  }
  if (
    input.eventId !== undefined &&
    findById( snapshot.events, input.eventId ) === undefined
  ) {
    return notFound( 'event', input.eventId );
  }
  if (
    input.slotId !== undefined &&
    findById( snapshot.slots, input.slotId ) === undefined
  ) {
    return notFound( 'slot', input.slotId );
  }
  if (
    input.attendeeId !== undefined &&
    !isUuid( input.attendeeId )
  ) {
    return err( {
      code: 'validation',
      message: 'attendeeId is not a UUID',
      details: { id: input.id },
    } );
  }
  if (
    input.attendeeId !== undefined &&
    findById( snapshot.entities, input.attendeeId ) === undefined
  ) {
    return notFound( 'entity', input.attendeeId );
  }
  const record = bookingFromInput(
    input,
    COMMAND_STAMP,
    COMMAND_STAMP,
  );
  const filtered = snapshotExcluding( snapshot, {
    bookingId: record.id,
  } );
  const preview = previewOk( {
    ...filtered,
    bookings: [ ...filtered.bookings, record ],
  } );
  if ( !preview.ok ) {
    return preview;
  }
  return collectBookingConflicts( snapshot, record );
}
