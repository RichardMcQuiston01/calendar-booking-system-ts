import { normalizeUuid } from './ids.js';
import { err, ok } from './result.js';
import type {
  Calendar,
  CalendarSnapshot,
  Entity,
  Result,
  Uuid,
} from './types.js';
import { validateSnapshot } from './validate.js';

interface HierarchyIndex {
  calendars: Map<string, Calendar>;
  entities: Map<string, Entity>;
  calendarIdByEntity: Map<string, Uuid>;
  entityIdByCalendar: Map<string, string>;
  childrenByEntity: Map<string, string[]>;
}

function indexSnapshot( snapshot: CalendarSnapshot ): HierarchyIndex {
  const calendars = new Map<string, Calendar>();
  const entities = new Map<string, Entity>();
  const calendarIdByEntity = new Map<string, Uuid>();
  const entityIdByCalendar = new Map<string, string>();
  const childrenByEntity = new Map<string, string[]>();

  for ( const calendar of snapshot.calendars ) {
    calendars.set( normalizeUuid( calendar.id ), calendar );
  }
  for ( const entity of snapshot.entities ) {
    entities.set( normalizeUuid( entity.id ), entity );
  }
  for ( const link of snapshot.entityCalendars ) {
    const entityId = normalizeUuid( link.entityId );
    const calendarKey = normalizeUuid( link.calendarId );
    const storedId = calendars.get( calendarKey )?.id ?? link.calendarId;
    calendarIdByEntity.set( entityId, storedId );
    entityIdByCalendar.set( calendarKey, entityId );
  }
  for ( const entity of snapshot.entities ) {
    if ( entity.parentId === undefined ) {
      continue;
    }
    const parentId = normalizeUuid( entity.parentId );
    const childId = normalizeUuid( entity.id );
    const siblings = childrenByEntity.get( parentId );
    if ( siblings ) {
      siblings.push( childId );
    } else {
      childrenByEntity.set( parentId, [ childId ] );
    }
  }

  return {
    calendars,
    entities,
    calendarIdByEntity,
    entityIdByCalendar,
    childrenByEntity,
  };
}

function parentFromEntity(
  index: HierarchyIndex,
  entityId: string,
): Uuid | undefined {
  const visited = new Set<string>();
  let current = index.entities.get( entityId )?.parentId;
  while ( current !== undefined ) {
    const id = normalizeUuid( current );
    if ( visited.has( id ) ) {
      return undefined;
    }
    visited.add( id );
    const calendarId = index.calendarIdByEntity.get( id );
    if ( calendarId !== undefined ) {
      return calendarId;
    }
    current = index.entities.get( id )?.parentId;
  }
  return undefined;
}

function parentOf(
  index: HierarchyIndex,
  calendarId: Uuid,
): Uuid | undefined {
  const entityId = index.entityIdByCalendar.get(
    normalizeUuid( calendarId ),
  );
  if ( entityId === undefined ) {
    return undefined;
  }
  return parentFromEntity( index, entityId );
}

function ancestorsOf(
  index: HierarchyIndex,
  calendarId: Uuid,
): Uuid[] {
  const ancestors: Uuid[] = [];
  const visited = new Set<string>();
  let current: Uuid | undefined = calendarId;
  while ( current !== undefined ) {
    const key = normalizeUuid( current );
    if ( visited.has( key ) ) {
      break;
    }
    visited.add( key );
    const parent = parentOf( index, current );
    if ( parent === undefined ) {
      break;
    }
    ancestors.push( parent );
    current = parent;
  }
  return ancestors;
}

function descendantsOf(
  index: HierarchyIndex,
  calendarId: Uuid,
): Uuid[] {
  const entityId = index.entityIdByCalendar.get(
    normalizeUuid( calendarId ),
  );
  if ( entityId === undefined ) {
    return [];
  }

  const descendants: Uuid[] = [];
  const visited = new Set<string>();
  const queue = [ ...( index.childrenByEntity.get( entityId ) ?? [] ) ];

  while ( queue.length > 0 ) {
    const id = queue.shift();
    if ( id === undefined || visited.has( id ) ) {
      continue;
    }
    visited.add( id );
    const linked = index.calendarIdByEntity.get( id );
    if ( linked !== undefined ) {
      descendants.push( linked );
    }
    const children = index.childrenByEntity.get( id );
    if ( children ) {
      queue.push( ...children );
    }
  }

  return descendants;
}

function canRollUp( inheritance: Calendar['inheritance'] ): boolean {
  return inheritance === 'roll-up' || inheritance === 'both';
}

/**
 * Resolved parent calendar of `calendarId`, walking the entity tree.
 * Entities with no calendar link are skipped.
 */
export function parentCalendarId(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
): Uuid | undefined {
  return parentOf( indexSnapshot( snapshot ), calendarId );
}

/**
 * Parent calendars of `calendarId` from nearest ancestor to the root.
 */
export function ancestorCalendarIds(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
): Uuid[] {
  return ancestorsOf( indexSnapshot( snapshot ), calendarId );
}

/**
 * Calendars on descendant entities of `calendarId`'s linked entity.
 */
export function descendantCalendarIds(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
): Uuid[] {
  return descendantsOf( indexSnapshot( snapshot ), calendarId );
}

/**
 * Unique set `{ calendarId } ∪ ancestors ∪ descendants`.
 * Validates the snapshot first. Unknown calendar → `not_found`.
 */
export function requiredCalendarIds(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
): Result<Uuid[]> {
  const validated = validateSnapshot( snapshot );
  if ( !validated.ok ) {
    return validated;
  }

  const key = normalizeUuid( calendarId );
  const calendar = snapshot.calendars.find(
    ( row ) => normalizeUuid( row.id ) === key,
  );
  if ( calendar === undefined ) {
    return err( {
      code: 'not_found',
      message: 'calendar not found',
      details: { calendarId },
    } );
  }

  const ancestors = ancestorCalendarIds( snapshot, calendar.id );
  const descendants = descendantCalendarIds( snapshot, calendar.id );
  const seen = new Set<string>();
  const ids: Uuid[] = [];
  for ( const id of [ calendar.id, ...ancestors, ...descendants ] ) {
    const normalized = normalizeUuid( id );
    if ( seen.has( normalized ) ) {
      continue;
    }
    seen.add( normalized );
    ids.push( id );
  }
  return ok( ids );
}

/**
 * True when this calendar inherits exclusive blocks from its parent.
 */
export function inheritsBlocks(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
): boolean {
  const calendar = indexSnapshot( snapshot ).calendars.get(
    normalizeUuid( calendarId ),
  );
  return (
    calendar?.inheritance === 'inherit-blocks' ||
    calendar?.inheritance === 'both'
  );
}

/**
 * True when every calendar from D up to but not including A has
 * inheritance `roll-up` or `both`.
 */
export function rollsUpTo(
  snapshot: CalendarSnapshot,
  descendantCalendarId: Uuid,
  ancestorCalendarId: Uuid,
): boolean {
  const index = indexSnapshot( snapshot );
  const ancestorKey = normalizeUuid( ancestorCalendarId );
  const descendantKey = normalizeUuid( descendantCalendarId );
  if ( descendantKey === ancestorKey ) {
    return false;
  }
  if ( index.calendars.get( descendantKey ) === undefined ) {
    return false;
  }
  if ( index.calendars.get( ancestorKey ) === undefined ) {
    return false;
  }

  const path = [
    descendantCalendarId,
    ...ancestorsOf( index, descendantCalendarId ),
  ];
  const stop = path.findIndex(
    ( id ) => normalizeUuid( id ) === ancestorKey,
  );
  if ( stop === -1 ) {
    return false;
  }
  return path.slice( 0, stop ).every( ( id ) => {
    const calendar = index.calendars.get( normalizeUuid( id ) );
    return calendar !== undefined && canRollUp( calendar.inheritance );
  } );
}
