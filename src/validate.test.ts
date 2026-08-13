import { describe, expect, test } from 'bun:test';
import { emptySnapshot, IDS, NOW, schoolTreeSnapshot } from './test/fixtures.ts';
import type {
  BookableSlot,
  Booking,
  CalendarEvent,
  Occupancy,
} from './types.ts';
import { validateSnapshot } from './validate.ts';

const exclusive: Occupancy = { kind: 'exclusive' };

function eventOn(
  calendarId: string,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  return {
    id: IDS.event,
    calendarId,
    title: 'Assembly',
    start: '2026-09-08T13:00:00.000Z',
    end: '2026-09-08T14:00:00.000Z',
    occupancy: exclusive,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function slotOn(
  calendarId: string,
  overrides: Partial<BookableSlot> = {},
): BookableSlot {
  return {
    id: IDS.slot,
    calendarId,
    start: '2026-09-08T15:00:00.000Z',
    end: '2026-09-08T16:00:00.000Z',
    occupancy: exclusive,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function bookingOn(
  calendarId: string,
  overrides: Partial<Booking> = {},
): Booking {
  return {
    id: IDS.booking,
    calendarId,
    start: '2026-09-08T13:00:00.000Z',
    end: '2026-09-08T13:30:00.000Z',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe( 'validateSnapshot', () => {
  test( 'emptySnapshot is ok', () => {
    const result = validateSnapshot( emptySnapshot() );
    expect( result.ok ).toBe( true );
  } );

  test( 'schoolTreeSnapshot is ok', () => {
    const result = validateSnapshot( schoolTreeSnapshot() );
    expect( result.ok ).toBe( true );
  } );

  test( 'rejects a non-UUID id', () => {
    const snapshot = emptySnapshot();
    snapshot.entities.push( {
      id: 'nope',
      entityType: 'school',
      name: 'School',
      createdAt: NOW,
      updatedAt: NOW,
    } );
    expect( validateSnapshot( snapshot ) ).toMatchObject( {
      ok: false,
      error: { code: 'validation' },
    } );
  } );

  test( 'rejects duplicate entity ids', () => {
    const snapshot = schoolTreeSnapshot();
    snapshot.entities.push( { ...snapshot.entities[ 0 ] } );
    expect( validateSnapshot( snapshot ) ).toMatchObject( {
      ok: false,
      error: { code: 'validation' },
    } );
  } );

  test( 'rejects two entityCalendars with the same entityId', () => {
    const snapshot = schoolTreeSnapshot();
    snapshot.calendars.push( {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      timeZone: 'America/New_York',
      inheritance: 'none',
      createdAt: NOW,
      updatedAt: NOW,
    } );
    snapshot.entityCalendars.push( {
      id: '06060606-0606-4606-8606-060606060606',
      entityId: IDS.school,
      calendarId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      createdAt: NOW,
      updatedAt: NOW,
    } );
    expect( validateSnapshot( snapshot ) ).toMatchObject( {
      ok: false,
      error: { code: 'integrity' },
    } );
  } );

  test( 'rejects a parentId that is not in entities', () => {
    const snapshot = emptySnapshot();
    snapshot.entities.push( {
      id: IDS.term,
      entityType: 'term',
      name: 'Term',
      parentId: IDS.school,
      createdAt: NOW,
      updatedAt: NOW,
    } );
    expect( validateSnapshot( snapshot ) ).toMatchObject( {
      ok: false,
      error: { code: 'integrity' },
    } );
  } );

  test( 'rejects a parent cycle', () => {
    const snapshot = schoolTreeSnapshot();
    const school = snapshot.entities.find(
      ( entity ) => entity.id === IDS.school,
    );
    if ( school ) {
      school.parentId = IDS.term;
    }
    expect( validateSnapshot( snapshot ) ).toMatchObject( {
      ok: false,
      error: { code: 'integrity' },
    } );
  } );

  test( 'rejects an event with start === end', () => {
    const snapshot = schoolTreeSnapshot();
    snapshot.events.push( eventOn( IDS.schoolCal, {
      start: '2026-09-08T13:00:00.000Z',
      end: '2026-09-08T13:00:00.000Z',
    } ) );
    expect( validateSnapshot( snapshot ) ).toMatchObject( {
      ok: false,
      error: { code: 'validation' },
    } );
  } );

  test( 'rejects recurrence with both until and count', () => {
    const snapshot = schoolTreeSnapshot();
    snapshot.events.push( eventOn( IDS.schoolCal, {
      recurrence: {
        freq: 'weekly',
        until: '2026-12-01T00:00:00.000Z',
        count: 4,
      },
    } ) );
    expect( validateSnapshot( snapshot ) ).toMatchObject( {
      ok: false,
      error: { code: 'validation' },
    } );
  } );

  test( 'rejects an empty entityType', () => {
    const snapshot = schoolTreeSnapshot();
    snapshot.entities[ 0 ].entityType = '';
    expect( validateSnapshot( snapshot ) ).toMatchObject( {
      ok: false,
      error: { code: 'validation' },
    } );
  } );

  test( 'rejects a booking with both eventId and slotId', () => {
    const snapshot = schoolTreeSnapshot();
    snapshot.events.push( eventOn( IDS.schoolCal ) );
    snapshot.slots.push( slotOn( IDS.schoolCal ) );
    snapshot.bookings.push( bookingOn( IDS.schoolCal, {
      eventId: IDS.event,
      slotId: IDS.slot,
    } ) );
    expect( validateSnapshot( snapshot ) ).toMatchObject( {
      ok: false,
      error: { code: 'validation' },
    } );
  } );

  test( 'rejects a booking eventId on another calendar', () => {
    const snapshot = schoolTreeSnapshot();
    snapshot.events.push( eventOn( IDS.schoolCal ) );
    snapshot.bookings.push( bookingOn( IDS.teacherCal, {
      eventId: IDS.event,
    } ) );
    expect( validateSnapshot( snapshot ) ).toMatchObject( {
      ok: false,
      error: { code: 'integrity' },
    } );
  } );

  test( 'accepts a custom entityType', () => {
    const snapshot = emptySnapshot();
    snapshot.entities.push( {
      id: IDS.school,
      entityType: 'department',
      name: 'Math',
      createdAt: NOW,
      updatedAt: NOW,
    } );
    expect( validateSnapshot( snapshot ).ok ).toBe( true );
  } );
} );
