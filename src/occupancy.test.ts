import { describe, expect, test } from 'bun:test';
import {
  effectiveExclusiveBusy,
  inheritedBlocks,
  ownExclusiveBusy,
} from './occupancy.ts';
import { IDS, NOW, schoolTreeSnapshot } from './test/fixtures.ts';
import type {
  BookableSlot,
  Booking,
  CalendarEvent,
  InheritanceMode,
  Occupancy,
  TimeRange,
} from './types.ts';

const exclusive: Occupancy = { kind: 'exclusive' };

/** Whole UTC day 2026-09-08. */
const RANGE: TimeRange = {
  start: '2026-09-08T00:00:00.000Z',
  end: '2026-09-09T00:00:00.000Z',
};

const SCHOOL_EVENT = '14141414-1414-4141-8141-141414141414';
const ADHOC = '13131313-1313-4131-8131-131313131313';
const SEAT = '12121212-1212-4121-8121-121212121212';
const PARENT_SLOT = '15151515-1515-4151-8151-151515151515';

const EVENT_13_14 = {
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
    start: EVENT_13_14.start,
    end: EVENT_13_14.end,
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
    start: '2026-09-08T17:00:00.000Z',
    end: '2026-09-08T17:30:00.000Z',
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
  } = {},
): ReturnType<typeof schoolTreeSnapshot> {
  const snapshot = schoolTreeSnapshot();
  snapshot.events.push( ...( extras.events ?? [] ) );
  snapshot.slots.push( ...( extras.slots ?? [] ) );
  snapshot.bookings.push( ...( extras.bookings ?? [] ) );
  return snapshot;
}

describe( 'ownExclusiveBusy', () => {
  test( 'exclusive event 13:00–14:00Z appears', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.teacherCal ) ],
    } );
    expect( ownExclusiveBusy( snapshot, IDS.teacherCal, RANGE ) )
      .toEqual( {
        ok: true,
        value: [ EVENT_13_14 ],
      } );
  } );

  test( 'slot 15:00–16:00Z appears', () => {
    const snapshot = teacherSnapshot( {
      slots: [ slotOn( IDS.teacherCal ) ],
    } );
    expect( ownExclusiveBusy( snapshot, IDS.teacherCal, RANGE ) )
      .toEqual( {
        ok: true,
        value: [ {
          start: '2026-09-08T15:00:00.000Z',
          end: '2026-09-08T16:00:00.000Z',
        } ],
      } );
  } );

  test( 'seat booking on an event does not appear', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.teacherCal ) ],
      bookings: [ bookingOn( IDS.teacherCal, {
        id: SEAT,
        start: '2026-09-08T13:15:00.000Z',
        end: '2026-09-08T13:45:00.000Z',
        eventId: IDS.event,
      } ) ],
    } );
    const result = ownExclusiveBusy( snapshot, IDS.teacherCal, RANGE );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value ).toEqual( [ EVENT_13_14 ] );
    expect( result.value ).not.toContainEqual( {
      start: '2026-09-08T13:15:00.000Z',
      end: '2026-09-08T13:45:00.000Z',
    } );
  } );

  test( 'ad-hoc booking 17:00–17:30Z appears', () => {
    const snapshot = teacherSnapshot( {
      bookings: [ bookingOn( IDS.teacherCal, { id: ADHOC } ) ],
    } );
    expect( ownExclusiveBusy( snapshot, IDS.teacherCal, RANGE ) )
      .toEqual( {
        ok: true,
        value: [ {
          start: '2026-09-08T17:00:00.000Z',
          end: '2026-09-08T17:30:00.000Z',
        } ],
      } );
  } );
} );

describe( 'inheritedBlocks', () => {
  test( 'school event is inherited when teacher inherit-blocks', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.schoolCal, { id: SCHOOL_EVENT } ) ],
    } );
    setInheritance( snapshot, IDS.teacherCal, 'inherit-blocks' );
    const inherited = inheritedBlocks(
      snapshot,
      IDS.teacherCal,
      RANGE,
    );
    expect( inherited ).toEqual( {
      ok: true,
      value: [ EVENT_13_14 ],
    } );
    expect( effectiveExclusiveBusy( snapshot, IDS.teacherCal, RANGE ) )
      .toEqual( {
        ok: true,
        value: [ EVENT_13_14 ],
      } );
  } );

  test( 'school event is not inherited when teacher is none', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.schoolCal, { id: SCHOOL_EVENT } ) ],
    } );
    setInheritance( snapshot, IDS.teacherCal, 'none' );
    expect( inheritedBlocks( snapshot, IDS.teacherCal, RANGE ) )
      .toEqual( { ok: true, value: [] } );
  } );

  test( 'chain stops when term is none', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.schoolCal, { id: SCHOOL_EVENT } ) ],
    } );
    setInheritance( snapshot, IDS.termCal, 'none' );
    setInheritance( snapshot, IDS.teacherCal, 'inherit-blocks' );
    expect( inheritedBlocks( snapshot, IDS.teacherCal, RANGE ) )
      .toEqual( { ok: true, value: [] } );
  } );

  test( 'school event is inherited when term and teacher inherit-blocks', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.schoolCal, { id: SCHOOL_EVENT } ) ],
    } );
    setInheritance( snapshot, IDS.termCal, 'inherit-blocks' );
    setInheritance( snapshot, IDS.teacherCal, 'inherit-blocks' );
    expect( inheritedBlocks( snapshot, IDS.teacherCal, RANGE ) )
      .toEqual( {
        ok: true,
        value: [ EVENT_13_14 ],
      } );
  } );

  test( 'parent slot is not inherited', () => {
    const snapshot = teacherSnapshot( {
      slots: [ slotOn( IDS.sectionCal, { id: PARENT_SLOT } ) ],
    } );
    setInheritance( snapshot, IDS.teacherCal, 'inherit-blocks' );
    expect( inheritedBlocks( snapshot, IDS.teacherCal, RANGE ) )
      .toEqual( { ok: true, value: [] } );
  } );
} );

describe( 'range errors', () => {
  test( 'bad range returns range', () => {
    const snapshot = teacherSnapshot();
    const bad: TimeRange = {
      start: '2026-09-08T12:00:00.000Z',
      end: '2026-09-08T12:00:00.000Z',
    };
    expect( ownExclusiveBusy( snapshot, IDS.teacherCal, bad ) )
      .toMatchObject( { ok: false, error: { code: 'range' } } );
    expect( inheritedBlocks( snapshot, IDS.teacherCal, bad ) )
      .toMatchObject( { ok: false, error: { code: 'range' } } );
    expect( effectiveExclusiveBusy( snapshot, IDS.teacherCal, bad ) )
      .toMatchObject( { ok: false, error: { code: 'range' } } );
  } );
} );
