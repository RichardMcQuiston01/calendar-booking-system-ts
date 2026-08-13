import { describe, expect, test } from 'bun:test';
import {
  putCalendar,
  putEntity,
  putEntityCalendar,
  removeCalendar,
  removeEntity,
  removeEntityCalendar,
} from './graph.ts';
import {
  emptySnapshot,
  IDS,
  NOW,
  schoolTreeSnapshot,
} from './test/fixtures.ts';
import type { CalendarEvent } from './types.ts';
import { validateSnapshot } from './validate.ts';

const CAL_B = 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0';
const LINK_B = 'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0';

function stampedEvent(
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  return {
    id: IDS.event,
    calendarId: IDS.schoolCal,
    title: 'Holiday',
    start: '2026-09-08T13:00:00.000Z',
    end: '2026-09-08T14:00:00.000Z',
    occupancy: { kind: 'exclusive' },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe( 'put graph', () => {
  test( 'put entity, calendar, and link stamps now', () => {
    const empty = emptySnapshot();
    const entity = putEntity(
      empty,
      { id: IDS.school, entityType: 'school', name: 'School' },
      { now: NOW },
    );
    expect( entity.ok ).toBe( true );
    if ( !entity.ok ) {
      return;
    }
    expect( entity.value.record.createdAt ).toBe( NOW );
    expect( entity.value.record.updatedAt ).toBe( NOW );
    expect( empty.entities ).toEqual( [] );

    const calendar = putCalendar(
      entity.value.snapshot,
      {
        id: IDS.schoolCal,
        timeZone: 'America/New_York',
        inheritance: 'none',
      },
      { now: NOW },
    );
    expect( calendar.ok ).toBe( true );
    if ( !calendar.ok ) {
      return;
    }
    expect( calendar.value.record.createdAt ).toBe( NOW );
    expect( calendar.value.record.updatedAt ).toBe( NOW );

    const link = putEntityCalendar(
      calendar.value.snapshot,
      {
        id: IDS.linkSchool,
        entityId: IDS.school,
        calendarId: IDS.schoolCal,
      },
      { now: NOW },
    );
    expect( link.ok ).toBe( true );
    if ( !link.ok ) {
      return;
    }
    expect( link.value.record.createdAt ).toBe( NOW );
    expect( link.value.record.updatedAt ).toBe( NOW );
    expect( validateSnapshot( link.value.snapshot ).ok ).toBe( true );
  } );

  test( 'second link with the same entityId is integrity', () => {
    const base = schoolTreeSnapshot();
    const extra = putCalendar(
      base,
      {
        id: CAL_B,
        timeZone: 'America/New_York',
        inheritance: 'none',
      },
      { now: NOW },
    );
    expect( extra.ok ).toBe( true );
    if ( !extra.ok ) {
      return;
    }
    const input = extra.value.snapshot;
    const result = putEntityCalendar(
      input,
      {
        id: LINK_B,
        entityId: IDS.school,
        calendarId: CAL_B,
      },
      { now: NOW },
    );
    expect( result.ok ).toBe( false );
    if ( result.ok ) {
      return;
    }
    expect( result.error.code ).toBe( 'integrity' );
    expect( input.entityCalendars ).toHaveLength( 5 );
  } );

  test( 'cycle via parent pointers is integrity', () => {
    const first = putEntity(
      emptySnapshot(),
      { id: IDS.school, entityType: 'school', name: 'School' },
      { now: NOW },
    );
    expect( first.ok ).toBe( true );
    if ( !first.ok ) {
      return;
    }
    const child = putEntity(
      first.value.snapshot,
      {
        id: IDS.term,
        entityType: 'term',
        name: 'Term',
        parentId: IDS.school,
      },
      { now: NOW },
    );
    expect( child.ok ).toBe( true );
    if ( !child.ok ) {
      return;
    }
    const cycle = putEntity(
      child.value.snapshot,
      {
        id: IDS.school,
        entityType: 'school',
        name: 'School',
        parentId: IDS.term,
      },
      { now: NOW },
    );
    expect( cycle.ok ).toBe( false );
    if ( cycle.ok ) {
      return;
    }
    expect( cycle.error.code ).toBe( 'integrity' );
    expect( child.value.snapshot.entities ).toHaveLength( 2 );
    expect(
      child.value.snapshot.entities.find(
        ( row ) => row.id === IDS.school,
      )?.parentId,
    ).toBeUndefined();
  } );

  test( 'failed put returns the original snapshot reference', () => {
    const snapshot = emptySnapshot();
    const result = putEntity(
      snapshot,
      { id: 'nope', entityType: 'school', name: 'School' },
      { now: NOW },
    );
    expect( result.ok === false && result.error ).toBeTruthy();
    if ( result.ok ) {
      return;
    }
    expect( result.error.code ).toBe( 'validation' );
    expect( snapshot.entities ).toEqual( [] );
  } );
} );

describe( 'remove graph', () => {
  test( 'removeEntity with a link is integrity', () => {
    const snapshot = schoolTreeSnapshot();
    const result = removeEntity( snapshot, IDS.teacher );
    expect( result.ok ).toBe( false );
    if ( result.ok ) {
      return;
    }
    expect( result.error.code ).toBe( 'integrity' );
    expect( snapshot.entities ).toHaveLength( 5 );
  } );

  test( 'unlink then remove calendar then entity succeeds', () => {
    const snapshot = schoolTreeSnapshot();
    const unlinked = removeEntityCalendar( snapshot, IDS.linkTeacher );
    expect( unlinked.ok ).toBe( true );
    if ( !unlinked.ok ) {
      return;
    }
    expect( snapshot.entityCalendars ).toHaveLength( 5 );

    const noCalendar = removeCalendar(
      unlinked.value,
      IDS.teacherCal,
    );
    expect( noCalendar.ok ).toBe( true );
    if ( !noCalendar.ok ) {
      return;
    }

    const noEntity = removeEntity( noCalendar.value, IDS.teacher );
    expect( noEntity.ok ).toBe( true );
    if ( !noEntity.ok ) {
      return;
    }
    expect( validateSnapshot( noEntity.value ).ok ).toBe( true );
    expect(
      noEntity.value.entities.some( ( row ) => row.id === IDS.teacher ),
    ).toBe( false );
    expect(
      noEntity.value.calendars.some(
        ( row ) => row.id === IDS.teacherCal,
      ),
    ).toBe( false );
  } );

  test( 'removeCalendar drops events on that calendar', () => {
    const snapshot = schoolTreeSnapshot();
    snapshot.events.push( stampedEvent() );
    const result = removeCalendar( snapshot, IDS.schoolCal );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value.events ).toEqual( [] );
    expect(
      result.value.calendars.some( ( row ) => row.id === IDS.schoolCal ),
    ).toBe( false );
    expect(
      result.value.entityCalendars.some(
        ( row ) => row.id === IDS.linkSchool,
      ),
    ).toBe( false );
    expect( snapshot.events ).toHaveLength( 1 );
  } );

  test( 'removeEntity missing id is not_found', () => {
    const snapshot = emptySnapshot();
    const result = removeEntity(
      snapshot,
      '00000000-0000-4000-8000-000000000000',
    );
    expect( result.ok ).toBe( false );
    if ( result.ok ) {
      return;
    }
    expect( result.error.code ).toBe( 'not_found' );
  } );
} );
