import {
  checkBooking,
  checkEvent,
  checkSlot,
} from './conflicts.js';
import { isUuid, normalizeUuid } from './ids.js';
import { err, ok } from './result.js';
import { cloneSnapshot, stamp } from './snapshot.js';
import { isValidDateOnly, nowInstant } from './time.js';
import type {
  ApplyOptions,
  ApplySuccess,
  AvailabilityRule,
  BookableSlot,
  Booking,
  BookingInput,
  CalendarEvent,
  CalendarSnapshot,
  CheckReport,
  DateOnly,
  EventInput,
  Occupancy,
  Result,
  RuleInput,
  SlotInput,
  Uuid,
} from './types.js';
import { validateSnapshot } from './validate.js';

const DEFAULT_OCCUPANCY: Occupancy = { kind: 'exclusive' };

function notFound( kind: string, id: Uuid ): Result<never> {
  return err( {
    code: 'not_found',
    message: `${ kind } not found`,
    details: { id },
  } );
}

function alreadyExists( kind: string, id: Uuid ): Result<never> {
  return err( {
    code: 'validation',
    message: `${ kind } already exists`,
    details: { id },
  } );
}

function findIndex(
  rows: { id: Uuid }[],
  id: Uuid,
): number {
  const key = normalizeUuid( id );
  return rows.findIndex( ( row ) => normalizeUuid( row.id ) === key );
}

function nowOf( opts?: ApplyOptions ): string {
  return opts?.now ?? nowInstant();
}

function refuseConflicts(
  report: CheckReport,
  allow?: boolean,
): Result<true> {
  if ( report.conflicts.length > 0 && allow !== true ) {
    return err( {
      code: 'conflict',
      message: 'scheduling conflict',
      conflicts: report.conflicts,
    } );
  }
  return ok( true );
}

function commitRecord<T>(
  snapshot: CalendarSnapshot,
  write: ( next: CalendarSnapshot ) => T,
): Result<ApplySuccess<T>> {
  const next = cloneSnapshot( snapshot );
  const record = write( next );
  const result = validateSnapshot( next );
  if ( !result.ok ) {
    return result;
  }
  return ok( { snapshot: next, record } );
}

function commitSnapshot(
  snapshot: CalendarSnapshot,
  write: ( next: CalendarSnapshot ) => void,
): Result<CalendarSnapshot> {
  const next = cloneSnapshot( snapshot );
  write( next );
  const result = validateSnapshot( next );
  if ( !result.ok ) {
    return result;
  }
  return ok( next );
}

function toEvent(
  input: EventInput,
  existing: CalendarEvent | undefined,
  now: string,
): CalendarEvent {
  return {
    ...input,
    occupancy: input.occupancy ?? DEFAULT_OCCUPANCY,
    ...stamp( existing, now ),
  };
}

function toSlot(
  input: SlotInput,
  existing: BookableSlot | undefined,
  now: string,
): BookableSlot {
  return {
    ...input,
    occupancy: input.occupancy ?? DEFAULT_OCCUPANCY,
    ...stamp( existing, now ),
  };
}

function toBooking(
  input: BookingInput,
  existing: Booking | undefined,
  now: string,
): Booking {
  return { ...input, ...stamp( existing, now ) };
}

function toRule(
  input: RuleInput,
  existing: AvailabilityRule | undefined,
  now: string,
): AvailabilityRule {
  return { ...input, ...stamp( existing, now ) };
}

function requireId(
  id: Uuid,
  kind: string,
): Result<true> {
  if ( !isUuid( id ) ) {
    return err( {
      code: 'validation',
      message: `${ kind } id is not a UUID`,
      details: { id },
    } );
  }
  return ok( true );
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
  const key = normalizeUuid( calendarId );
  const found = snapshot.calendars.some(
    ( row ) => normalizeUuid( row.id ) === key,
  );
  if ( !found ) {
    return notFound( 'calendar', calendarId );
  }
  return ok( true );
}

/**
 * Insert an event. Existing ids are rejected; use `updateEvent`.
 */
export function applyEvent(
  snapshot: CalendarSnapshot,
  input: EventInput,
  opts?: ApplyOptions,
): Result<ApplySuccess<CalendarEvent>> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  if ( isUuid( input.id ) && findIndex( snapshot.events, input.id ) >= 0 ) {
    return alreadyExists( 'event', input.id );
  }
  const checked = checkEvent( snapshot, input );
  if ( !checked.ok ) {
    return checked;
  }
  const allowed = refuseConflicts(
    checked.value,
    opts?.allowConflicts,
  );
  if ( !allowed.ok ) {
    return allowed;
  }
  const record = toEvent( input, undefined, nowOf( opts ) );
  return commitRecord( snapshot, ( next ) => {
    next.events.push( record );
    return record;
  } );
}

/**
 * Replace an existing event series.
 */
export function updateEvent(
  snapshot: CalendarSnapshot,
  input: EventInput,
  opts?: ApplyOptions,
): Result<ApplySuccess<CalendarEvent>> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  const idOk = requireId( input.id, 'event' );
  if ( !idOk.ok ) {
    return idOk;
  }
  const index = findIndex( snapshot.events, input.id );
  if ( index < 0 ) {
    return notFound( 'event', input.id );
  }
  const checked = checkEvent( snapshot, input );
  if ( !checked.ok ) {
    return checked;
  }
  const allowed = refuseConflicts(
    checked.value,
    opts?.allowConflicts,
  );
  if ( !allowed.ok ) {
    return allowed;
  }
  const existing = snapshot.events[ index ];
  const record = toEvent( input, existing, nowOf( opts ) );
  return commitRecord( snapshot, ( next ) => {
    next.events[ index ] = record;
    return record;
  } );
}

/**
 * Remove an event and bookings that target it.
 */
export function deleteEvent(
  snapshot: CalendarSnapshot,
  id: Uuid,
  opts?: ApplyOptions,
): Result<CalendarSnapshot> {
  void opts;
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  const idOk = requireId( id, 'event' );
  if ( !idOk.ok ) {
    return idOk;
  }
  const index = findIndex( snapshot.events, id );
  if ( index < 0 ) {
    return notFound( 'event', id );
  }
  const key = normalizeUuid( id );
  return commitSnapshot( snapshot, ( next ) => {
    next.events.splice( index, 1 );
    next.bookings = next.bookings.filter(
      ( row ) =>
        row.eventId === undefined ||
        normalizeUuid( row.eventId ) !== key,
    );
  } );
}

/**
 * Append a civil date to an event’s `excludedDates`.
 */
export function excludeOccurrence(
  snapshot: CalendarSnapshot,
  eventId: Uuid,
  date: DateOnly,
  opts?: ApplyOptions,
): Result<ApplySuccess<CalendarEvent>> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  const idOk = requireId( eventId, 'event' );
  if ( !idOk.ok ) {
    return idOk;
  }
  if ( !isValidDateOnly( date ) ) {
    return err( {
      code: 'validation',
      message: 'date is not a DateOnly',
      details: { date },
    } );
  }
  const index = findIndex( snapshot.events, eventId );
  if ( index < 0 ) {
    return notFound( 'event', eventId );
  }
  const existing = snapshot.events[ index ];
  if ( existing === undefined ) {
    return notFound( 'event', eventId );
  }
  const dates = existing.excludedDates ?? [];
  const excludedDates = dates.includes( date )
    ? dates
    : [ ...dates, date ];
  const record: CalendarEvent = {
    ...existing,
    excludedDates,
    ...stamp( existing, nowOf( opts ) ),
  };
  return commitRecord( snapshot, ( next ) => {
    next.events[ index ] = record;
    return record;
  } );
}

/**
 * Insert an availability rule. Existing ids are rejected.
 */
export function applyAvailabilityRule(
  snapshot: CalendarSnapshot,
  input: RuleInput,
  opts?: ApplyOptions,
): Result<ApplySuccess<AvailabilityRule>> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  if (
    isUuid( input.id ) &&
    findIndex( snapshot.availabilityRules, input.id ) >= 0
  ) {
    return alreadyExists( 'availability rule', input.id );
  }
  const calendar = requireCalendar( snapshot, input.calendarId );
  if ( !calendar.ok ) {
    return calendar;
  }
  const record = toRule( input, undefined, nowOf( opts ) );
  return commitRecord( snapshot, ( next ) => {
    next.availabilityRules.push( record );
    return record;
  } );
}

/**
 * Replace an existing availability rule.
 */
export function updateAvailabilityRule(
  snapshot: CalendarSnapshot,
  input: RuleInput,
  opts?: ApplyOptions,
): Result<ApplySuccess<AvailabilityRule>> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  const idOk = requireId( input.id, 'availability rule' );
  if ( !idOk.ok ) {
    return idOk;
  }
  const index = findIndex( snapshot.availabilityRules, input.id );
  if ( index < 0 ) {
    return notFound( 'availability rule', input.id );
  }
  const calendar = requireCalendar( snapshot, input.calendarId );
  if ( !calendar.ok ) {
    return calendar;
  }
  const existing = snapshot.availabilityRules[ index ];
  const record = toRule( input, existing, nowOf( opts ) );
  return commitRecord( snapshot, ( next ) => {
    next.availabilityRules[ index ] = record;
    return record;
  } );
}

/**
 * Remove an availability rule. Bookings are left in place.
 */
export function deleteAvailabilityRule(
  snapshot: CalendarSnapshot,
  id: Uuid,
  opts?: ApplyOptions,
): Result<CalendarSnapshot> {
  void opts;
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  const idOk = requireId( id, 'availability rule' );
  if ( !idOk.ok ) {
    return idOk;
  }
  const index = findIndex( snapshot.availabilityRules, id );
  if ( index < 0 ) {
    return notFound( 'availability rule', id );
  }
  return commitSnapshot( snapshot, ( next ) => {
    next.availabilityRules.splice( index, 1 );
  } );
}

/**
 * Insert a bookable slot. Existing ids are rejected.
 */
export function applySlot(
  snapshot: CalendarSnapshot,
  input: SlotInput,
  opts?: ApplyOptions,
): Result<ApplySuccess<BookableSlot>> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  if ( isUuid( input.id ) && findIndex( snapshot.slots, input.id ) >= 0 ) {
    return alreadyExists( 'slot', input.id );
  }
  const checked = checkSlot( snapshot, input );
  if ( !checked.ok ) {
    return checked;
  }
  const allowed = refuseConflicts(
    checked.value,
    opts?.allowConflicts,
  );
  if ( !allowed.ok ) {
    return allowed;
  }
  const record = toSlot( input, undefined, nowOf( opts ) );
  return commitRecord( snapshot, ( next ) => {
    next.slots.push( record );
    return record;
  } );
}

/**
 * Replace an existing bookable slot.
 */
export function updateSlot(
  snapshot: CalendarSnapshot,
  input: SlotInput,
  opts?: ApplyOptions,
): Result<ApplySuccess<BookableSlot>> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  const idOk = requireId( input.id, 'slot' );
  if ( !idOk.ok ) {
    return idOk;
  }
  const index = findIndex( snapshot.slots, input.id );
  if ( index < 0 ) {
    return notFound( 'slot', input.id );
  }
  const checked = checkSlot( snapshot, input );
  if ( !checked.ok ) {
    return checked;
  }
  const allowed = refuseConflicts(
    checked.value,
    opts?.allowConflicts,
  );
  if ( !allowed.ok ) {
    return allowed;
  }
  const existing = snapshot.slots[ index ];
  const record = toSlot( input, existing, nowOf( opts ) );
  return commitRecord( snapshot, ( next ) => {
    next.slots[ index ] = record;
    return record;
  } );
}

/**
 * Remove a slot and bookings that target it.
 */
export function deleteSlot(
  snapshot: CalendarSnapshot,
  id: Uuid,
  opts?: ApplyOptions,
): Result<CalendarSnapshot> {
  void opts;
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  const idOk = requireId( id, 'slot' );
  if ( !idOk.ok ) {
    return idOk;
  }
  const index = findIndex( snapshot.slots, id );
  if ( index < 0 ) {
    return notFound( 'slot', id );
  }
  const key = normalizeUuid( id );
  return commitSnapshot( snapshot, ( next ) => {
    next.slots.splice( index, 1 );
    next.bookings = next.bookings.filter(
      ( row ) =>
        row.slotId === undefined ||
        normalizeUuid( row.slotId ) !== key,
    );
  } );
}

/**
 * Insert a booking. Existing ids are rejected.
 */
export function applyBooking(
  snapshot: CalendarSnapshot,
  input: BookingInput,
  opts?: ApplyOptions,
): Result<ApplySuccess<Booking>> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  if (
    isUuid( input.id ) &&
    findIndex( snapshot.bookings, input.id ) >= 0
  ) {
    return alreadyExists( 'booking', input.id );
  }
  const checked = checkBooking( snapshot, input );
  if ( !checked.ok ) {
    return checked;
  }
  const allowed = refuseConflicts(
    checked.value,
    opts?.allowConflicts,
  );
  if ( !allowed.ok ) {
    return allowed;
  }
  const record = toBooking( input, undefined, nowOf( opts ) );
  return commitRecord( snapshot, ( next ) => {
    next.bookings.push( record );
    return record;
  } );
}

/**
 * Replace an existing booking.
 */
export function updateBooking(
  snapshot: CalendarSnapshot,
  input: BookingInput,
  opts?: ApplyOptions,
): Result<ApplySuccess<Booking>> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  const idOk = requireId( input.id, 'booking' );
  if ( !idOk.ok ) {
    return idOk;
  }
  const index = findIndex( snapshot.bookings, input.id );
  if ( index < 0 ) {
    return notFound( 'booking', input.id );
  }
  const checked = checkBooking( snapshot, input );
  if ( !checked.ok ) {
    return checked;
  }
  const allowed = refuseConflicts(
    checked.value,
    opts?.allowConflicts,
  );
  if ( !allowed.ok ) {
    return allowed;
  }
  const existing = snapshot.bookings[ index ];
  const record = toBooking( input, existing, nowOf( opts ) );
  return commitRecord( snapshot, ( next ) => {
    next.bookings[ index ] = record;
    return record;
  } );
}

/**
 * Remove a single booking.
 */
export function cancelBooking(
  snapshot: CalendarSnapshot,
  id: Uuid,
  opts?: ApplyOptions,
): Result<CalendarSnapshot> {
  void opts;
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  const idOk = requireId( id, 'booking' );
  if ( !idOk.ok ) {
    return idOk;
  }
  const index = findIndex( snapshot.bookings, id );
  if ( index < 0 ) {
    return notFound( 'booking', id );
  }
  return commitSnapshot( snapshot, ( next ) => {
    next.bookings.splice( index, 1 );
  } );
}
