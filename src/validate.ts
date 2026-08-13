import { isUuid, normalizeUuid } from './ids.js';
import { err, ok } from './result.js';
import {
  isValidClockTime,
  isValidDateOnly,
  isValidTimeZone,
  parseInstant,
} from './time.js';
import type {
  AvailabilityRule,
  BookableSlot,
  Booking,
  Calendar,
  CalendarEvent,
  CalendarSnapshot,
  EngineError,
  Entity,
  EntityCalendar,
  Occupancy,
  RecurrenceRule,
  Result,
} from './types.js';

const INHERITANCE = new Set( [
  'none',
  'inherit-blocks',
  'roll-up',
  'both',
] );

const FREQS = new Set( [ 'daily', 'weekly', 'yearly' ] );

const WEEKDAYS = new Set( [
  'MO',
  'TU',
  'WE',
  'TH',
  'FR',
  'SA',
  'SU',
] );

function fail(
  code: EngineError['code'],
  message: string,
  details?: Record<string, unknown>,
): Result<never> {
  return err( details ? { code, message, details } : { code, message } );
}

function nonEmpty( value: unknown ): value is string {
  return typeof value === 'string' && value.length > 0;
}

function occupancyMessage( occupancy: Occupancy | undefined ): string | undefined {
  if ( occupancy === undefined || occupancy === null ) {
    return 'occupancy is required';
  }
  if ( typeof occupancy !== 'object' ) {
    return 'occupancy is invalid';
  }
  if ( occupancy.kind === 'exclusive' ) {
    if ( 'max' in occupancy && occupancy.max !== undefined ) {
      return 'exclusive occupancy must not have max';
    }
    return undefined;
  }
  if ( occupancy.kind === 'capacity' ) {
    if ( !Number.isInteger( occupancy.max ) || occupancy.max < 1 ) {
      return 'capacity.max must be an integer >= 1';
    }
    return undefined;
  }
  return 'occupancy.kind is invalid';
}

function recurrenceMessage(
  rule: RecurrenceRule | undefined,
  required: boolean,
): string | undefined {
  if ( rule === undefined ) {
    return required ? 'recurrence is required' : undefined;
  }
  if ( !FREQS.has( rule.freq ) ) {
    return 'recurrence.freq is invalid';
  }
  if ( rule.interval !== undefined ) {
    if ( !Number.isInteger( rule.interval ) || rule.interval < 1 ) {
      return 'recurrence.interval must be an integer >= 1';
    }
  }
  if ( rule.until !== undefined && rule.count !== undefined ) {
    return 'recurrence cannot set both until and count';
  }
  if ( rule.count !== undefined ) {
    if ( !Number.isInteger( rule.count ) || rule.count < 1 ) {
      return 'recurrence.count must be an integer >= 1';
    }
  }
  if (
    rule.until !== undefined &&
    parseInstant( rule.until ) === undefined
  ) {
    return 'recurrence.until is not an instant';
  }
  if ( rule.byDay !== undefined ) {
    if (
      !Array.isArray( rule.byDay ) ||
      rule.byDay.some( ( day ) => !WEEKDAYS.has( day ) )
    ) {
      return 'recurrence.byDay has an invalid weekday';
    }
  }
  return undefined;
}

function excludedDatesMessage(
  dates: string[] | undefined,
): string | undefined {
  if ( dates === undefined ) {
    return undefined;
  }
  if ( !Array.isArray( dates ) ) {
    return 'excludedDates must be an array';
  }
  for ( const date of dates ) {
    if ( !isValidDateOnly( date ) ) {
      return 'excludedDates contains an invalid DateOnly';
    }
  }
  return undefined;
}

function rangeMessage( start: string, end: string ): string | undefined {
  if ( parseInstant( start ) === undefined ) {
    return 'start is not an instant';
  }
  if ( parseInstant( end ) === undefined ) {
    return 'end is not an instant';
  }
  if ( start >= end ) {
    return 'start must be before end';
  }
  return undefined;
}

function uniqueIds(
  rows: { id: string }[],
  label: string,
): Result<true> {
  const seen = new Set<string>();
  for ( const row of rows ) {
    const key = normalizeUuid( row.id );
    if ( seen.has( key ) ) {
      return fail( 'validation', `duplicate ${ label } id`, { id: row.id } );
    }
    seen.add( key );
  }
  return ok( true );
}

function uniqueLinkField(
  rows: EntityCalendar[],
  field: 'entityId' | 'calendarId',
): Result<true> {
  const seen = new Set<string>();
  for ( const row of rows ) {
    const key = normalizeUuid( row[ field ] );
    if ( seen.has( key ) ) {
      return fail(
        'integrity',
        `duplicate entity_calendar ${ field }`,
        { [ field ]: row[ field ] },
      );
    }
    seen.add( key );
  }
  return ok( true );
}

function idSet( rows: { id: string }[] ): Set<string> {
  return new Set( rows.map( ( row ) => normalizeUuid( row.id ) ) );
}

function hasParentCycle( entities: Entity[] ): boolean {
  const byId = new Map(
    entities.map( ( entity ) => [ normalizeUuid( entity.id ), entity ] ),
  );
  const color = new Map<string, 0 | 1 | 2>();

  const visit = ( id: string ): boolean => {
    const state = color.get( id ) ?? 0;
    if ( state === 1 ) {
      return true;
    }
    if ( state === 2 ) {
      return false;
    }
    color.set( id, 1 );
    const entity = byId.get( id );
    if ( entity?.parentId !== undefined ) {
      if ( visit( normalizeUuid( entity.parentId ) ) ) {
        return true;
      }
    }
    color.set( id, 2 );
    return false;
  };

  for ( const entity of entities ) {
    if ( visit( normalizeUuid( entity.id ) ) ) {
      return true;
    }
  }
  return false;
}

function validateEntity( entity: Entity ): Result<true> {
  if ( !isUuid( entity.id ) ) {
    return fail( 'validation', 'entity id is not a UUID', { id: entity.id } );
  }
  if ( !nonEmpty( entity.entityType ) ) {
    return fail( 'validation', 'entityType must be non-empty', {
      id: entity.id,
    } );
  }
  if ( !nonEmpty( entity.name ) ) {
    return fail( 'validation', 'entity name must be non-empty', {
      id: entity.id,
    } );
  }
  if ( entity.parentId !== undefined && !isUuid( entity.parentId ) ) {
    return fail( 'validation', 'parentId is not a UUID', { id: entity.id } );
  }
  return ok( true );
}

function validateCalendar( calendar: Calendar ): Result<true> {
  if ( !isUuid( calendar.id ) ) {
    return fail( 'validation', 'calendar id is not a UUID', {
      id: calendar.id,
    } );
  }
  if ( !isValidTimeZone( calendar.timeZone ) ) {
    return fail( 'validation', 'calendar timeZone is invalid', {
      id: calendar.id,
    } );
  }
  if ( !INHERITANCE.has( calendar.inheritance ) ) {
    return fail( 'validation', 'calendar inheritance is invalid', {
      id: calendar.id,
    } );
  }
  return ok( true );
}

function validateLink( link: EntityCalendar ): Result<true> {
  if ( !isUuid( link.id ) ) {
    return fail( 'validation', 'entityCalendar id is not a UUID', {
      id: link.id,
    } );
  }
  if ( !isUuid( link.entityId ) ) {
    return fail( 'validation', 'entityId is not a UUID', { id: link.id } );
  }
  if ( !isUuid( link.calendarId ) ) {
    return fail( 'validation', 'calendarId is not a UUID', { id: link.id } );
  }
  return ok( true );
}

function validateEvent( event: CalendarEvent ): Result<true> {
  if ( !isUuid( event.id ) ) {
    return fail( 'validation', 'event id is not a UUID', { id: event.id } );
  }
  if ( !isUuid( event.calendarId ) ) {
    return fail( 'validation', 'event calendarId is not a UUID', {
      id: event.id,
    } );
  }
  if ( !nonEmpty( event.title ) ) {
    return fail( 'validation', 'event title must be non-empty', {
      id: event.id,
    } );
  }
  const range = rangeMessage( event.start, event.end );
  if ( range ) {
    return fail( 'validation', range, { id: event.id } );
  }
  if ( event.timeZone !== undefined && !isValidTimeZone( event.timeZone ) ) {
    return fail( 'validation', 'event timeZone is invalid', {
      id: event.id,
    } );
  }
  const occupancy = occupancyMessage( event.occupancy );
  if ( occupancy ) {
    return fail( 'validation', occupancy, { id: event.id } );
  }
  const recurrence = recurrenceMessage( event.recurrence, false );
  if ( recurrence ) {
    return fail( 'validation', recurrence, { id: event.id } );
  }
  const excluded = excludedDatesMessage( event.excludedDates );
  if ( excluded ) {
    return fail( 'validation', excluded, { id: event.id } );
  }
  return ok( true );
}

function validateRule( rule: AvailabilityRule ): Result<true> {
  if ( !isUuid( rule.id ) ) {
    return fail( 'validation', 'availability rule id is not a UUID', {
      id: rule.id,
    } );
  }
  if ( !isUuid( rule.calendarId ) ) {
    return fail( 'validation', 'availability rule calendarId is not a UUID', {
      id: rule.id,
    } );
  }
  if ( !isValidClockTime( rule.startTime ) ) {
    return fail( 'validation', 'startTime is not HH:mm', { id: rule.id } );
  }
  if ( !isValidClockTime( rule.endTime ) ) {
    return fail( 'validation', 'endTime is not HH:mm', { id: rule.id } );
  }
  const recurrence = recurrenceMessage( rule.recurrence, true );
  if ( recurrence ) {
    return fail( 'validation', recurrence, { id: rule.id } );
  }
  const excluded = excludedDatesMessage( rule.excludedDates );
  if ( excluded ) {
    return fail( 'validation', excluded, { id: rule.id } );
  }
  return ok( true );
}

function validateSlot( slot: BookableSlot ): Result<true> {
  if ( !isUuid( slot.id ) ) {
    return fail( 'validation', 'slot id is not a UUID', { id: slot.id } );
  }
  if ( !isUuid( slot.calendarId ) ) {
    return fail( 'validation', 'slot calendarId is not a UUID', {
      id: slot.id,
    } );
  }
  const range = rangeMessage( slot.start, slot.end );
  if ( range ) {
    return fail( 'validation', range, { id: slot.id } );
  }
  const occupancy = occupancyMessage( slot.occupancy );
  if ( occupancy ) {
    return fail( 'validation', occupancy, { id: slot.id } );
  }
  return ok( true );
}

function validateBooking( booking: Booking ): Result<true> {
  if ( !isUuid( booking.id ) ) {
    return fail( 'validation', 'booking id is not a UUID', {
      id: booking.id,
    } );
  }
  if ( !isUuid( booking.calendarId ) ) {
    return fail( 'validation', 'booking calendarId is not a UUID', {
      id: booking.id,
    } );
  }
  const range = rangeMessage( booking.start, booking.end );
  if ( range ) {
    return fail( 'validation', range, { id: booking.id } );
  }
  if ( booking.eventId !== undefined && !isUuid( booking.eventId ) ) {
    return fail( 'validation', 'eventId is not a UUID', { id: booking.id } );
  }
  if ( booking.slotId !== undefined && !isUuid( booking.slotId ) ) {
    return fail( 'validation', 'slotId is not a UUID', { id: booking.id } );
  }
  if ( booking.attendeeId !== undefined && !isUuid( booking.attendeeId ) ) {
    return fail( 'validation', 'attendeeId is not a UUID', {
      id: booking.id,
    } );
  }
  if ( booking.eventId !== undefined && booking.slotId !== undefined ) {
    return fail(
      'validation',
      'booking cannot set both eventId and slotId',
      { id: booking.id },
    );
  }
  return ok( true );
}

/**
 * Validate snapshot shape, field rules, and referential integrity.
 * Does not mutate `snapshot`.
 */
export function validateSnapshot(
  snapshot: CalendarSnapshot,
): Result<CalendarSnapshot> {
  if ( snapshot === null || typeof snapshot !== 'object' ) {
    return fail( 'validation', 'snapshot must be an object' );
  }

  const collections: [string, unknown][] = [
    [ 'entities', snapshot.entities ],
    [ 'calendars', snapshot.calendars ],
    [ 'entityCalendars', snapshot.entityCalendars ],
    [ 'events', snapshot.events ],
    [ 'availabilityRules', snapshot.availabilityRules ],
    [ 'slots', snapshot.slots ],
    [ 'bookings', snapshot.bookings ],
  ];
  for ( const [ name, rows ] of collections ) {
    if ( !Array.isArray( rows ) ) {
      return fail( 'validation', `${ name } must be an array` );
    }
  }

  for ( const entity of snapshot.entities ) {
    const result = validateEntity( entity );
    if ( !result.ok ) {
      return result;
    }
  }
  for ( const calendar of snapshot.calendars ) {
    const result = validateCalendar( calendar );
    if ( !result.ok ) {
      return result;
    }
  }
  for ( const link of snapshot.entityCalendars ) {
    const result = validateLink( link );
    if ( !result.ok ) {
      return result;
    }
  }
  for ( const event of snapshot.events ) {
    const result = validateEvent( event );
    if ( !result.ok ) {
      return result;
    }
  }
  for ( const rule of snapshot.availabilityRules ) {
    const result = validateRule( rule );
    if ( !result.ok ) {
      return result;
    }
  }
  for ( const slot of snapshot.slots ) {
    const result = validateSlot( slot );
    if ( !result.ok ) {
      return result;
    }
  }
  for ( const booking of snapshot.bookings ) {
    const result = validateBooking( booking );
    if ( !result.ok ) {
      return result;
    }
  }

  const uniqueChecks = [
    uniqueIds( snapshot.entities, 'entity' ),
    uniqueIds( snapshot.calendars, 'calendar' ),
    uniqueIds( snapshot.entityCalendars, 'entityCalendar' ),
    uniqueIds( snapshot.events, 'event' ),
    uniqueIds( snapshot.availabilityRules, 'availabilityRule' ),
    uniqueIds( snapshot.slots, 'slot' ),
    uniqueIds( snapshot.bookings, 'booking' ),
  ];
  for ( const check of uniqueChecks ) {
    if ( !check.ok ) {
      return check;
    }
  }

  const uniqueEntityId = uniqueLinkField(
    snapshot.entityCalendars,
    'entityId',
  );
  if ( !uniqueEntityId.ok ) {
    return uniqueEntityId;
  }
  const uniqueCalendarId = uniqueLinkField(
    snapshot.entityCalendars,
    'calendarId',
  );
  if ( !uniqueCalendarId.ok ) {
    return uniqueCalendarId;
  }

  const entityIds = idSet( snapshot.entities );
  const calendarIds = idSet( snapshot.calendars );
  const eventIds = idSet( snapshot.events );
  const slotIds = idSet( snapshot.slots );

  for ( const entity of snapshot.entities ) {
    if (
      entity.parentId !== undefined &&
      !entityIds.has( normalizeUuid( entity.parentId ) )
    ) {
      return fail( 'integrity', 'parentId does not resolve', {
        id: entity.id,
        parentId: entity.parentId,
      } );
    }
  }
  for ( const link of snapshot.entityCalendars ) {
    if ( !entityIds.has( normalizeUuid( link.entityId ) ) ) {
      return fail( 'integrity', 'entityId does not resolve', {
        id: link.id,
        entityId: link.entityId,
      } );
    }
    if ( !calendarIds.has( normalizeUuid( link.calendarId ) ) ) {
      return fail( 'integrity', 'calendarId does not resolve', {
        id: link.id,
        calendarId: link.calendarId,
      } );
    }
  }
  for ( const event of snapshot.events ) {
    if ( !calendarIds.has( normalizeUuid( event.calendarId ) ) ) {
      return fail( 'integrity', 'event calendarId does not resolve', {
        id: event.id,
      } );
    }
  }
  for ( const rule of snapshot.availabilityRules ) {
    if ( !calendarIds.has( normalizeUuid( rule.calendarId ) ) ) {
      return fail( 'integrity', 'availability rule calendarId does not resolve', {
        id: rule.id,
      } );
    }
  }
  for ( const slot of snapshot.slots ) {
    if ( !calendarIds.has( normalizeUuid( slot.calendarId ) ) ) {
      return fail( 'integrity', 'slot calendarId does not resolve', {
        id: slot.id,
      } );
    }
  }

  const eventsById = new Map(
    snapshot.events.map( ( event ) => [ normalizeUuid( event.id ), event ] ),
  );
  const slotsById = new Map(
    snapshot.slots.map( ( slot ) => [ normalizeUuid( slot.id ), slot ] ),
  );

  for ( const booking of snapshot.bookings ) {
    if ( !calendarIds.has( normalizeUuid( booking.calendarId ) ) ) {
      return fail( 'integrity', 'booking calendarId does not resolve', {
        id: booking.id,
      } );
    }
    if (
      booking.eventId !== undefined &&
      !eventIds.has( normalizeUuid( booking.eventId ) )
    ) {
      return fail( 'integrity', 'eventId does not resolve', {
        id: booking.id,
      } );
    }
    if (
      booking.slotId !== undefined &&
      !slotIds.has( normalizeUuid( booking.slotId ) )
    ) {
      return fail( 'integrity', 'slotId does not resolve', {
        id: booking.id,
      } );
    }
    if (
      booking.attendeeId !== undefined &&
      !entityIds.has( normalizeUuid( booking.attendeeId ) )
    ) {
      return fail( 'integrity', 'attendeeId does not resolve', {
        id: booking.id,
      } );
    }
    if ( booking.eventId !== undefined ) {
      const event = eventsById.get( normalizeUuid( booking.eventId ) );
      if (
        event &&
        normalizeUuid( event.calendarId ) !==
          normalizeUuid( booking.calendarId )
      ) {
        return fail(
          'integrity',
          'booking eventId is on a different calendar',
          { id: booking.id },
        );
      }
    }
    if ( booking.slotId !== undefined ) {
      const slot = slotsById.get( normalizeUuid( booking.slotId ) );
      if (
        slot &&
        normalizeUuid( slot.calendarId ) !==
          normalizeUuid( booking.calendarId )
      ) {
        return fail(
          'integrity',
          'booking slotId is on a different calendar',
          { id: booking.id },
        );
      }
    }
  }

  if ( hasParentCycle( snapshot.entities ) ) {
    return fail( 'integrity', 'entity parentId cycle' );
  }

  return ok( snapshot );
}
