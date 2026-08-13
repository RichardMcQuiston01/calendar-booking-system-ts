import { describe, expect, test } from 'bun:test';
import {
  applyAvailabilityRule,
  applyBooking,
  applyEvent,
  cancelBooking,
  deleteAvailabilityRule,
  deleteEvent,
  deleteSlot,
  excludeOccurrence,
  updateAvailabilityRule,
  updateBooking,
  updateEvent,
  updateSlot,
} from './apply.ts';
import { checkEvent } from './conflicts.ts';
import { IDS, NOW, schoolTreeSnapshot } from './test/fixtures.ts';
import type {
  AvailabilityRule,
  BookableSlot,
  Booking,
  CalendarEvent,
  EventInput,
  Occupancy,
} from './types.ts';

const exclusive: Occupancy = { kind: 'exclusive' };

const EVENT_B = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0';
const BOOKING_B = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
const BOOKING_C = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
const SLOT_B = 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0';
const RULE_B = '81818181-8181-4818-8818-818181818181';
const MISSING = '00000000-0000-4000-8000-000000000000';

const AT_13_14 = {
  start: '2026-09-08T13:00:00.000Z',
  end: '2026-09-08T14:00:00.000Z',
};

function eventOn(
  calendarId: string,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  return {
    id: IDS.event,
    calendarId,
    title: 'Class',
    start: AT_13_14.start,
    end: AT_13_14.end,
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

function weekdayRule(
  overrides: Partial<AvailabilityRule> = {},
): AvailabilityRule {
  return {
    id: IDS.rule,
    calendarId: IDS.teacherCal,
    startTime: '08:00',
    endTime: '15:00',
    recurrence: {
      freq: 'weekly',
      byDay: [ 'MO', 'TU', 'WE', 'TH', 'FR' ],
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function teacherSnapshot(
  extras: {
    events?: CalendarEvent[];
    slots?: BookableSlot[];
    bookings?: Booking[];
    rules?: AvailabilityRule[];
  } = {},
): ReturnType<typeof schoolTreeSnapshot> {
  const snapshot = schoolTreeSnapshot();
  snapshot.events.push( ...( extras.events ?? [] ) );
  snapshot.slots.push( ...( extras.slots ?? [] ) );
  snapshot.bookings.push( ...( extras.bookings ?? [] ) );
  snapshot.availabilityRules.push( ...( extras.rules ?? [] ) );
  return snapshot;
}

function eventInput(
  overrides: Partial<EventInput> = {},
): EventInput {
  return {
    id: EVENT_B,
    calendarId: IDS.teacherCal,
    title: 'Overlap',
    start: AT_13_14.start,
    end: AT_13_14.end,
    ...overrides,
  };
}

describe( 'applyEvent', () => {
  test( 'overlapping exclusive event is conflict and same ref', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.teacherCal ) ],
    } );
    const result = applyEvent( snapshot, eventInput(), { now: NOW } );
    expect( result.ok ).toBe( false );
    if ( result.ok ) {
      return;
    }
    expect( result.error.code ).toBe( 'conflict' );
    expect( result.error.conflicts ).toHaveLength( 1 );
    expect( snapshot.events ).toHaveLength( 1 );
  } );

  test( 'allowConflicts commits a new snapshot', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.teacherCal ) ],
    } );
    const result = applyEvent(
      snapshot,
      eventInput(),
      { allowConflicts: true, now: NOW },
    );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value.snapshot.events ).toHaveLength( 2 );
    expect( result.value.record.createdAt ).toBe( NOW );
    expect( result.value.record.updatedAt ).toBe( NOW );
    expect( result.value.record.occupancy ).toEqual( exclusive );
    expect( snapshot.events ).toHaveLength( 1 );
    expect( result.value.snapshot ).not.toBe( snapshot );
  } );

  test( 'allowConflicts with a bad UUID is still validation', () => {
    const snapshot = teacherSnapshot();
    const result = applyEvent(
      snapshot,
      eventInput( { id: 'nope' } ),
      { allowConflicts: true, now: NOW },
    );
    expect( result.ok ).toBe( false );
    if ( result.ok ) {
      return;
    }
    expect( result.error.code ).toBe( 'validation' );
    expect( snapshot.events ).toHaveLength( 0 );
  } );

  test( 'duplicate id is validation', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.teacherCal ) ],
    } );
    const result = applyEvent(
      snapshot,
      eventInput( { id: IDS.event } ),
      { now: NOW },
    );
    expect( result.ok ).toBe( false );
    if ( result.ok ) {
      return;
    }
    expect( result.error.code ).toBe( 'validation' );
  } );
} );

describe( 'updateEvent and excludeOccurrence', () => {
  test( 'updateEvent missing id is not_found', () => {
    const snapshot = teacherSnapshot();
    const result = updateEvent(
      snapshot,
      eventInput( { id: MISSING } ),
      { now: NOW },
    );
    expect( result.ok ).toBe( false );
    if ( result.ok ) {
      return;
    }
    expect( result.error.code ).toBe( 'not_found' );
  } );

  test( 'updateEvent replaces the series', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.teacherCal ) ],
    } );
    const result = updateEvent(
      snapshot,
      eventInput( {
        id: IDS.event,
        title: 'Moved',
        start: '2026-09-08T15:00:00.000Z',
        end: '2026-09-08T16:00:00.000Z',
      } ),
      { now: NOW },
    );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value.record.title ).toBe( 'Moved' );
    expect( result.value.snapshot.events ).toHaveLength( 1 );
    expect( snapshot.events[ 0 ]?.title ).toBe( 'Class' );
  } );

  test( 'excludeOccurrence adds the date; that day is free', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.teacherCal, {
        recurrence: { freq: 'daily', count: 5 },
      } ) ],
    } );
    const nextDay = eventInput( {
      start: '2026-09-09T13:00:00.000Z',
      end: '2026-09-09T14:00:00.000Z',
    } );
    const blocked = checkEvent( snapshot, nextDay );
    expect( blocked.ok ).toBe( true );
    if ( !blocked.ok ) {
      return;
    }
    expect( blocked.value.conflicts ).toHaveLength( 1 );

    const excluded = excludeOccurrence(
      snapshot,
      IDS.event,
      '2026-09-09',
      { now: NOW },
    );
    expect( excluded.ok ).toBe( true );
    if ( !excluded.ok ) {
      return;
    }
    expect( excluded.value.record.excludedDates ).toEqual( [
      '2026-09-09',
    ] );

    const open = checkEvent( excluded.value.snapshot, nextDay );
    expect( open.ok ).toBe( true );
    if ( !open.ok ) {
      return;
    }
    expect( open.value.conflicts ).toEqual( [] );
  } );
} );

describe( 'bookings apply', () => {
  test( 'two seats apply; third is capacity-full', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.teacherCal, {
        occupancy: { kind: 'capacity', max: 2 },
      } ) ],
    } );
    const first = applyBooking( snapshot, {
      id: IDS.booking,
      calendarId: IDS.teacherCal,
      start: '2026-09-08T13:00:00.000Z',
      end: '2026-09-08T13:30:00.000Z',
      eventId: IDS.event,
    }, { now: NOW } );
    expect( first.ok ).toBe( true );
    if ( !first.ok ) {
      return;
    }
    const second = applyBooking( first.value.snapshot, {
      id: BOOKING_B,
      calendarId: IDS.teacherCal,
      start: '2026-09-08T13:15:00.000Z',
      end: '2026-09-08T13:45:00.000Z',
      eventId: IDS.event,
    }, { now: NOW } );
    expect( second.ok ).toBe( true );
    if ( !second.ok ) {
      return;
    }
    const third = applyBooking( second.value.snapshot, {
      id: BOOKING_C,
      calendarId: IDS.teacherCal,
      start: '2026-09-08T13:20:00.000Z',
      end: '2026-09-08T13:50:00.000Z',
      eventId: IDS.event,
    }, { now: NOW } );
    expect( third.ok ).toBe( false );
    if ( third.ok ) {
      return;
    }
    expect( third.error.code ).toBe( 'conflict' );
    expect( third.error.conflicts?.some(
      ( row ) => row.kind === 'capacity-full',
    ) ).toBe( true );
    expect( second.value.snapshot.bookings ).toHaveLength( 2 );
  } );

  test( 'ad-hoc inside working hours with no busy applies', () => {
    const snapshot = teacherSnapshot( {
      rules: [ weekdayRule() ],
    } );
    const result = applyBooking( snapshot, {
      id: IDS.booking,
      calendarId: IDS.teacherCal,
      start: '2026-09-08T13:00:00.000Z',
      end: '2026-09-08T13:30:00.000Z',
    }, { now: NOW } );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value.snapshot.bookings ).toHaveLength( 1 );
  } );

  test( 'updateBooking onto a full slot is capacity-full', () => {
    const snapshot = teacherSnapshot( {
      slots: [
        slotOn( IDS.teacherCal ),
        slotOn( IDS.teacherCal, {
          id: SLOT_B,
          start: '2026-09-08T16:00:00.000Z',
          end: '2026-09-08T17:00:00.000Z',
        } ),
      ],
      bookings: [ {
        id: IDS.booking,
        calendarId: IDS.teacherCal,
        start: '2026-09-08T15:00:00.000Z',
        end: '2026-09-08T15:30:00.000Z',
        slotId: IDS.slot,
        createdAt: NOW,
        updatedAt: NOW,
      } ],
    } );
    const placed = applyBooking( snapshot, {
      id: BOOKING_B,
      calendarId: IDS.teacherCal,
      start: '2026-09-08T16:00:00.000Z',
      end: '2026-09-08T16:30:00.000Z',
      slotId: SLOT_B,
    }, { now: NOW } );
    expect( placed.ok ).toBe( true );
    if ( !placed.ok ) {
      return;
    }
    const moved = updateBooking( placed.value.snapshot, {
      id: BOOKING_B,
      calendarId: IDS.teacherCal,
      start: '2026-09-08T15:00:00.000Z',
      end: '2026-09-08T15:30:00.000Z',
      slotId: IDS.slot,
    }, { now: NOW } );
    expect( moved.ok ).toBe( false );
    if ( moved.ok ) {
      return;
    }
    expect( moved.error.code ).toBe( 'conflict' );
    expect( moved.error.conflicts?.some(
      ( row ) => row.kind === 'capacity-full',
    ) ).toBe( true );
  } );

  test( 'cancelBooking removes only that booking', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.teacherCal, {
        occupancy: { kind: 'capacity', max: 2 },
      } ) ],
      bookings: [
        {
          id: IDS.booking,
          calendarId: IDS.teacherCal,
          start: '2026-09-08T13:00:00.000Z',
          end: '2026-09-08T13:30:00.000Z',
          eventId: IDS.event,
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: BOOKING_B,
          calendarId: IDS.teacherCal,
          start: '2026-09-08T13:15:00.000Z',
          end: '2026-09-08T13:45:00.000Z',
          eventId: IDS.event,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    } );
    const result = cancelBooking( snapshot, IDS.booking, { now: NOW } );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value.bookings ).toHaveLength( 1 );
    expect( result.value.bookings[ 0 ]?.id ).toBe( BOOKING_B );
    expect( snapshot.bookings ).toHaveLength( 2 );
  } );
} );

describe( 'delete cascades and rules', () => {
  test( 'deleteEvent removes seat bookings on it', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.teacherCal ) ],
      bookings: [
        {
          id: IDS.booking,
          calendarId: IDS.teacherCal,
          start: '2026-09-08T13:00:00.000Z',
          end: '2026-09-08T13:30:00.000Z',
          eventId: IDS.event,
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: BOOKING_B,
          calendarId: IDS.teacherCal,
          start: '2026-09-08T17:00:00.000Z',
          end: '2026-09-08T17:30:00.000Z',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    } );
    const result = deleteEvent( snapshot, IDS.event, { now: NOW } );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value.events ).toEqual( [] );
    expect( result.value.bookings ).toHaveLength( 1 );
    expect( result.value.bookings[ 0 ]?.id ).toBe( BOOKING_B );
  } );

  test( 'deleteSlot removes seat bookings on it', () => {
    const snapshot = teacherSnapshot( {
      slots: [ slotOn( IDS.teacherCal ) ],
      bookings: [ {
        id: IDS.booking,
        calendarId: IDS.teacherCal,
        start: '2026-09-08T15:00:00.000Z',
        end: '2026-09-08T15:30:00.000Z',
        slotId: IDS.slot,
        createdAt: NOW,
        updatedAt: NOW,
      } ],
    } );
    const result = deleteSlot( snapshot, IDS.slot, { now: NOW } );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value.slots ).toEqual( [] );
    expect( result.value.bookings ).toEqual( [] );
  } );

  test( 'availability rule apply, update, and delete', () => {
    const snapshot = teacherSnapshot();
    const applied = applyAvailabilityRule( snapshot, {
      id: IDS.rule,
      calendarId: IDS.teacherCal,
      startTime: '08:00',
      endTime: '15:00',
      recurrence: {
        freq: 'weekly',
        byDay: [ 'MO', 'TU', 'WE', 'TH', 'FR' ],
      },
    }, { now: NOW } );
    expect( applied.ok ).toBe( true );
    if ( !applied.ok ) {
      return;
    }
    const updated = updateAvailabilityRule( applied.value.snapshot, {
      id: IDS.rule,
      calendarId: IDS.teacherCal,
      startTime: '09:00',
      endTime: '15:00',
      recurrence: {
        freq: 'weekly',
        byDay: [ 'MO', 'TU', 'WE', 'TH', 'FR' ],
      },
    }, { now: NOW } );
    expect( updated.ok ).toBe( true );
    if ( !updated.ok ) {
      return;
    }
    expect( updated.value.record.startTime ).toBe( '09:00' );
    const deleted = deleteAvailabilityRule(
      updated.value.snapshot,
      IDS.rule,
      { now: NOW },
    );
    expect( deleted.ok ).toBe( true );
    if ( !deleted.ok ) {
      return;
    }
    expect( deleted.value.availabilityRules ).toEqual( [] );
  } );

  test( 'updateSlot missing id is not_found', () => {
    const snapshot = teacherSnapshot();
    const result = updateSlot( snapshot, {
      id: MISSING,
      calendarId: IDS.teacherCal,
      start: '2026-09-08T15:00:00.000Z',
      end: '2026-09-08T16:00:00.000Z',
    }, { now: NOW } );
    expect( result.ok ).toBe( false );
    if ( result.ok ) {
      return;
    }
    expect( result.error.code ).toBe( 'not_found' );
  } );

  test( 'update rule missing id is not_found', () => {
    const snapshot = teacherSnapshot();
    const result = updateAvailabilityRule( snapshot, {
      id: RULE_B,
      calendarId: IDS.teacherCal,
      startTime: '08:00',
      endTime: '15:00',
      recurrence: { freq: 'weekly', byDay: [ 'MO' ] },
    }, { now: NOW } );
    expect( result.ok ).toBe( false );
    if ( result.ok ) {
      return;
    }
    expect( result.error.code ).toBe( 'not_found' );
  } );
} );
