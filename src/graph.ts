import { isUuid, normalizeUuid } from './ids.js';
import { err, ok } from './result.js';
import { cloneSnapshot, stamp } from './snapshot.js';
import { nowInstant } from './time.js';
import type {
  ApplyOptions,
  ApplySuccess,
  Calendar,
  CalendarInput,
  CalendarSnapshot,
  Entity,
  EntityCalendar,
  EntityCalendarInput,
  EntityInput,
  Result,
  Uuid,
} from './types.js';
import { validateSnapshot } from './validate.js';

function notFound( kind: string, id: Uuid ): Result<never> {
  return err( {
    code: 'not_found',
    message: `${ kind } not found`,
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

/**
 * Insert or replace an entity. Validates the resulting snapshot.
 */
export function putEntity(
  snapshot: CalendarSnapshot,
  input: EntityInput,
  opts?: ApplyOptions,
): Result<ApplySuccess<Entity>> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  const index = isUuid( input.id )
    ? findIndex( snapshot.entities, input.id )
    : -1;
  const existing = index >= 0 ? snapshot.entities[ index ] : undefined;
  const record: Entity = {
    ...input,
    ...stamp( existing, nowOf( opts ) ),
  };
  const next = cloneSnapshot( snapshot );
  if ( index >= 0 ) {
    next.entities[ index ] = record;
  } else {
    next.entities.push( record );
  }
  const result = validateSnapshot( next );
  if ( !result.ok ) {
    return result;
  }
  return ok( { snapshot: next, record } );
}

/**
 * Insert or replace a calendar. Validates the resulting snapshot.
 */
export function putCalendar(
  snapshot: CalendarSnapshot,
  input: CalendarInput,
  opts?: ApplyOptions,
): Result<ApplySuccess<Calendar>> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  const index = isUuid( input.id )
    ? findIndex( snapshot.calendars, input.id )
    : -1;
  const existing = index >= 0 ? snapshot.calendars[ index ] : undefined;
  const record: Calendar = {
    ...input,
    ...stamp( existing, nowOf( opts ) ),
  };
  const next = cloneSnapshot( snapshot );
  if ( index >= 0 ) {
    next.calendars[ index ] = record;
  } else {
    next.calendars.push( record );
  }
  const result = validateSnapshot( next );
  if ( !result.ok ) {
    return result;
  }
  return ok( { snapshot: next, record } );
}

/**
 * Insert or replace an entity–calendar link. Validates the result.
 */
export function putEntityCalendar(
  snapshot: CalendarSnapshot,
  input: EntityCalendarInput,
  opts?: ApplyOptions,
): Result<ApplySuccess<EntityCalendar>> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  const index = isUuid( input.id )
    ? findIndex( snapshot.entityCalendars, input.id )
    : -1;
  const existing = index >= 0
    ? snapshot.entityCalendars[ index ]
    : undefined;
  const record: EntityCalendar = {
    ...input,
    ...stamp( existing, nowOf( opts ) ),
  };
  const next = cloneSnapshot( snapshot );
  if ( index >= 0 ) {
    next.entityCalendars[ index ] = record;
  } else {
    next.entityCalendars.push( record );
  }
  const result = validateSnapshot( next );
  if ( !result.ok ) {
    return result;
  }
  return ok( { snapshot: next, record } );
}

/**
 * Remove an entity. Fails if children or a calendar link exist.
 */
export function removeEntity(
  snapshot: CalendarSnapshot,
  id: Uuid,
): Result<CalendarSnapshot> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  if ( !isUuid( id ) ) {
    return err( {
      code: 'validation',
      message: 'entity id is not a UUID',
      details: { id },
    } );
  }
  const index = findIndex( snapshot.entities, id );
  if ( index < 0 ) {
    return notFound( 'entity', id );
  }
  const key = normalizeUuid( id );
  const hasChildren = snapshot.entities.some(
    ( row ) =>
      row.parentId !== undefined &&
      normalizeUuid( row.parentId ) === key,
  );
  if ( hasChildren ) {
    return err( {
      code: 'integrity',
      message: 'entity has children',
      details: { id },
    } );
  }
  const hasLink = snapshot.entityCalendars.some(
    ( row ) => normalizeUuid( row.entityId ) === key,
  );
  if ( hasLink ) {
    return err( {
      code: 'integrity',
      message: 'entity has a calendar link',
      details: { id },
    } );
  }
  const next = cloneSnapshot( snapshot );
  next.entities.splice( index, 1 );
  const result = validateSnapshot( next );
  if ( !result.ok ) {
    return result;
  }
  return ok( next );
}

/**
 * Remove a calendar, its link, and rows that belong to it.
 */
export function removeCalendar(
  snapshot: CalendarSnapshot,
  id: Uuid,
): Result<CalendarSnapshot> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  if ( !isUuid( id ) ) {
    return err( {
      code: 'validation',
      message: 'calendar id is not a UUID',
      details: { id },
    } );
  }
  const index = findIndex( snapshot.calendars, id );
  if ( index < 0 ) {
    return notFound( 'calendar', id );
  }
  const key = normalizeUuid( id );
  const next = cloneSnapshot( snapshot );
  next.calendars.splice( index, 1 );
  next.entityCalendars = next.entityCalendars.filter(
    ( row ) => normalizeUuid( row.calendarId ) !== key,
  );
  next.events = next.events.filter(
    ( row ) => normalizeUuid( row.calendarId ) !== key,
  );
  next.availabilityRules = next.availabilityRules.filter(
    ( row ) => normalizeUuid( row.calendarId ) !== key,
  );
  next.slots = next.slots.filter(
    ( row ) => normalizeUuid( row.calendarId ) !== key,
  );
  next.bookings = next.bookings.filter(
    ( row ) => normalizeUuid( row.calendarId ) !== key,
  );
  const result = validateSnapshot( next );
  if ( !result.ok ) {
    return result;
  }
  return ok( next );
}

/**
 * Unlink an entity from its calendar. Rows themselves remain.
 */
export function removeEntityCalendar(
  snapshot: CalendarSnapshot,
  id: Uuid,
): Result<CalendarSnapshot> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }
  if ( !isUuid( id ) ) {
    return err( {
      code: 'validation',
      message: 'entityCalendar id is not a UUID',
      details: { id },
    } );
  }
  const index = findIndex( snapshot.entityCalendars, id );
  if ( index < 0 ) {
    return notFound( 'entityCalendar', id );
  }
  const next = cloneSnapshot( snapshot );
  next.entityCalendars.splice( index, 1 );
  const result = validateSnapshot( next );
  if ( !result.ok ) {
    return result;
  }
  return ok( next );
}
