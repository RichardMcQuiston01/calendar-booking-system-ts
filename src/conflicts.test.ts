import { describe, expect, test } from 'bun:test';
import {
  applyEvent,
  applySlot,
} from './apply.ts';
import {
  checkBooking,
  checkEvent,
  checkSlot,
} from './conflicts.ts';
import { IDS, NOW, schoolTreeSnapshot } from './test/fixtures.ts';
import type {
  AvailabilityRule,
  BookableSlot,
  Booking,
  CalendarEvent,
  EventInput,
  InheritanceMode,
  Occupancy,
  SlotInput,
} from './types.ts';

const exclusive: Occupancy = { kind: 'exclusive' };

const EVENT_B = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0';
const EVENT_C = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1';
const BOOKING_B = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
const BOOKING_C = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
const SLOT_B = 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0';

const AT_13_14 = {
  start: '2026-09-08T13:00:00.000Z',
  end: '2026-09-08T14:00:00.000Z',
};

function setInheritance(
  snapshot: ReturnType<typeof schoolTreeSnapshot>,
  calendarId: string,
  inheritance: InheritanceMode,
): void {
  const calendar = snapshot.calendars.find(
    ( row ) => row.id === calendarId,
  );
  if ( calendar ) {
    calendar.inheritance = inheritance;
  }
}

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

function slotInput(
  overrides: Partial<SlotInput> = {},
): SlotInput {
  return {
    id: SLOT_B,
    calendarId: IDS.teacherCal,
    start: AT_13_14.start,
    end: AT_13_14.end,
    ...overrides,
  };
}

describe( 'checkEvent', () => {
  test( 'overlapping exclusive event is exclusive-overlap', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.teacherCal ) ],
    } );
    const result = checkEvent( snapshot, eventInput() );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value.conflicts ).toHaveLength( 1 );
    expect( result.value.conflicts[ 0 ]?.kind )
      .toBe( 'exclusive-overlap' );
    expect( result.value.conflicts[ 0 ]?.source ).toEqual( {
      type: 'event',
      id: IDS.event,
    } );
  } );

  test( 'seat bookings do not add extra event conflicts', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.teacherCal, {
        occupancy: { kind: 'capacity', max: 2 },
      } ) ],
      bookings: [ {
        id: IDS.booking,
        calendarId: IDS.teacherCal,
        start: '2026-09-08T13:00:00.000Z',
        end: '2026-09-08T13:30:00.000Z',
        eventId: IDS.event,
        createdAt: NOW,
        updatedAt: NOW,
      } ],
    } );
    const result = checkEvent( snapshot, eventInput( {
      id: EVENT_C,
      start: '2026-09-08T15:00:00.000Z',
      end: '2026-09-08T16:00:00.000Z',
    } ) );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value.conflicts ).toEqual( [] );
  } );

  test( 'inherited school holiday is inherited-block', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.schoolCal ) ],
    } );
    const blocked = checkEvent( snapshot, eventInput() );
    expect( blocked.ok ).toBe( true );
    if ( !blocked.ok ) {
      return;
    }
    expect( blocked.value.conflicts ).toHaveLength( 1 );
    expect( blocked.value.conflicts[ 0 ]?.kind )
      .toBe( 'inherited-block' );

    setInheritance( snapshot, IDS.teacherCal, 'none' );
    const open = checkEvent( snapshot, eventInput() );
    expect( open.ok ).toBe( true );
    if ( !open.ok ) {
      return;
    }
    expect( open.value.conflicts ).toEqual( [] );
  } );

  test( 'weekly from Sep 8 conflicts with exclusive on Sep 22', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.teacherCal, {
        start: '2026-09-22T13:00:00.000Z',
        end: '2026-09-22T14:00:00.000Z',
      } ) ],
    } );
    const result = checkEvent( snapshot, eventInput( {
      start: '2026-09-08T13:00:00.000Z',
      end: '2026-09-08T14:00:00.000Z',
      recurrence: { freq: 'weekly' },
    } ) );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value.conflicts.some(
      ( row ) =>
        row.kind === 'exclusive-overlap' &&
        row.source.type === 'event' &&
        row.source.id === IDS.event,
    ) ).toBe( true );
  } );
} );

describe( 'checkSlot', () => {
  test( 'slot overlapping an event is exclusive-overlap', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.teacherCal ) ],
    } );
    const result = checkSlot( snapshot, slotInput() );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value.conflicts ).toHaveLength( 1 );
    expect( result.value.conflicts[ 0 ]?.kind )
      .toBe( 'exclusive-overlap' );
    expect( result.value.conflicts[ 0 ]?.source ).toEqual( {
      type: 'event',
      id: IDS.event,
    } );
  } );
} );

describe( 'checkBooking', () => {
  test( 'seat remainingCapacity is 1 after first check', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.teacherCal, {
        occupancy: { kind: 'capacity', max: 2 },
      } ) ],
    } );
    const result = checkBooking( snapshot, {
      id: IDS.booking,
      calendarId: IDS.teacherCal,
      start: '2026-09-08T13:00:00.000Z',
      end: '2026-09-08T13:30:00.000Z',
      eventId: IDS.event,
    } );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value.conflicts ).toEqual( [] );
    expect( result.value.remainingCapacity ).toBe( 1 );
  } );

  test( 'third seat on capacity 2 is capacity-full', () => {
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
    const result = checkBooking( snapshot, {
      id: BOOKING_C,
      calendarId: IDS.teacherCal,
      start: '2026-09-08T13:20:00.000Z',
      end: '2026-09-08T13:50:00.000Z',
      eventId: IDS.event,
    } );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value.conflicts.some(
      ( row ) => row.kind === 'capacity-full',
    ) ).toBe( true );
    expect( result.value.remainingCapacity ).toBe( 0 );
  } );

  test( 'ad-hoc during a slot is exclusive-overlap', () => {
    const snapshot = teacherSnapshot( {
      rules: [ weekdayRule() ],
      slots: [ slotOn( IDS.teacherCal ) ],
    } );
    const result = checkBooking( snapshot, {
      id: IDS.booking,
      calendarId: IDS.teacherCal,
      start: '2026-09-08T15:00:00.000Z',
      end: '2026-09-08T15:30:00.000Z',
    } );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value.conflicts.some(
      ( row ) =>
        row.kind === 'exclusive-overlap' &&
        row.source.type === 'slot' &&
        row.source.id === IDS.slot,
    ) ).toBe( true );
  } );

  test( 'ad-hoc outside rules is outside-availability', () => {
    const snapshot = teacherSnapshot( {
      rules: [ weekdayRule() ],
    } );
    const result = checkBooking( snapshot, {
      id: IDS.booking,
      calendarId: IDS.teacherCal,
      start: '2026-09-08T20:00:00.000Z',
      end: '2026-09-08T21:00:00.000Z',
    } );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value.conflicts.some(
      ( row ) => row.kind === 'outside-availability',
    ) ).toBe( true );
  } );

  test( 'slot seat inside is ok; sticking out is outside-target', () => {
    const snapshot = teacherSnapshot( {
      slots: [ slotOn( IDS.teacherCal ) ],
    } );
    const inside = checkBooking( snapshot, {
      id: IDS.booking,
      calendarId: IDS.teacherCal,
      start: '2026-09-08T15:00:00.000Z',
      end: '2026-09-08T15:30:00.000Z',
      slotId: IDS.slot,
    } );
    expect( inside.ok ).toBe( true );
    if ( !inside.ok ) {
      return;
    }
    expect( inside.value.conflicts ).toEqual( [] );

    const outside = checkBooking( snapshot, {
      id: BOOKING_B,
      calendarId: IDS.teacherCal,
      start: '2026-09-08T14:45:00.000Z',
      end: '2026-09-08T15:30:00.000Z',
      slotId: IDS.slot,
    } );
    expect( outside.ok ).toBe( true );
    if ( !outside.ok ) {
      return;
    }
    expect( outside.value.conflicts.some(
      ( row ) => row.kind === 'outside-target',
    ) ).toBe( true );
  } );
} );

describe( 'apply helpers used by check cases', () => {
  test( 'capacity event still blocks a second event', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.teacherCal, {
        occupancy: { kind: 'capacity', max: 2 },
      } ) ],
    } );
    const result = applyEvent( snapshot, eventInput(), { now: NOW } );
    expect( result.ok ).toBe( false );
    if ( result.ok ) {
      return;
    }
    expect( result.error.code ).toBe( 'conflict' );
  } );

  test( 'touching events apply cleanly', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.teacherCal, {
        start: '2026-09-08T11:00:00.000Z',
        end: '2026-09-08T12:00:00.000Z',
      } ) ],
    } );
    const result = applyEvent(
      snapshot,
      eventInput( {
        start: '2026-09-08T12:00:00.000Z',
        end: '2026-09-08T13:00:00.000Z',
      } ),
      { now: NOW },
    );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value.snapshot.events ).toHaveLength( 2 );
  } );

  test( 'slot apply is used by overlap coverage', () => {
    const snapshot = teacherSnapshot();
    const result = applySlot(
      snapshot,
      slotInput( {
        start: '2026-09-08T15:00:00.000Z',
        end: '2026-09-08T16:00:00.000Z',
      } ),
      { now: NOW },
    );
    expect( result.ok ).toBe( true );
  } );
} );
