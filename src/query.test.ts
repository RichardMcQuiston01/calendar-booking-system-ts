import { describe, expect, test } from 'bun:test';
import { queryAvailability, queryView } from './query.ts';
import { IDS, NOW, schoolTreeSnapshot } from './test/fixtures.ts';
import type {
  AvailabilityRule,
  BookableSlot,
  Booking,
  CalendarEvent,
  InheritanceMode,
  Occupancy,
  TimeRange,
  ViewItem,
} from './types.ts';

const exclusive: Occupancy = { kind: 'exclusive' };

/** Whole UTC day 2026-09-08 (Tuesday). */
const RANGE: TimeRange = {
  start: '2026-09-08T00:00:00.000Z',
  end: '2026-09-09T00:00:00.000Z',
};

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const SCHOOL_EVENT = '14141414-1414-4141-8141-141414141414';
const SEAT = '12121212-1212-4121-8121-121212121212';

const EVENT_13_14 = {
  start: '2026-09-08T13:00:00.000Z',
  end: '2026-09-08T14:00:00.000Z',
};

const SLOT_15_16 = {
  start: '2026-09-08T15:00:00.000Z',
  end: '2026-09-08T16:00:00.000Z',
};

const BOOKING_17 = {
  start: '2026-09-08T17:00:00.000Z',
  end: '2026-09-08T17:30:00.000Z',
};

const HOLE_INTERVALS = [
  {
    start: '2026-09-08T12:00:00.000Z',
    end: '2026-09-08T13:00:00.000Z',
  },
  {
    start: '2026-09-08T14:00:00.000Z',
    end: '2026-09-08T19:00:00.000Z',
  },
];

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
    start: SLOT_15_16.start,
    end: SLOT_15_16.end,
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
    start: BOOKING_17.start,
    end: BOOKING_17.end,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function teacherSnapshot(
  extras: {
    rules?: AvailabilityRule[];
    events?: CalendarEvent[];
    slots?: BookableSlot[];
    bookings?: Booking[];
  } = {},
): ReturnType<typeof schoolTreeSnapshot> {
  const snapshot = schoolTreeSnapshot();
  snapshot.availabilityRules.push( ...( extras.rules ?? [] ) );
  snapshot.events.push( ...( extras.events ?? [] ) );
  snapshot.slots.push( ...( extras.slots ?? [] ) );
  snapshot.bookings.push( ...( extras.bookings ?? [] ) );
  return snapshot;
}

function ownEventItem(
  overrides: Partial<ViewItem> = {},
): ViewItem {
  return {
    source: 'own',
    type: 'event',
    id: IDS.event,
    calendarId: IDS.teacherCal,
    title: 'Class',
    start: EVENT_13_14.start,
    end: EVENT_13_14.end,
    occupancy: exclusive,
    ...overrides,
  };
}

describe( 'queryAvailability', () => {
  test( 'weekday rule with 13:00–14:00 event has a UTC hole', () => {
    const snapshot = teacherSnapshot( {
      rules: [ weekdayRule() ],
      events: [ eventOn( IDS.teacherCal ) ],
    } );
    const result = queryAvailability(
      snapshot,
      IDS.teacherCal,
      RANGE,
    );
    expect( result ).toEqual( {
      ok: true,
      value: {
        calendarId: IDS.teacherCal,
        intervals: HOLE_INTERVALS,
      },
    } );
    if ( !result.ok ) {
      return;
    }
    for ( const interval of result.value.intervals ) {
      expect( interval.start.endsWith( 'Z' ) ).toBe( true );
      expect( interval.end.endsWith( 'Z' ) ).toBe( true );
    }
  } );

  test( 'inherited school block punches teacher availability', () => {
    const snapshot = teacherSnapshot( {
      rules: [ weekdayRule() ],
      events: [ eventOn( IDS.schoolCal, { id: SCHOOL_EVENT } ) ],
    } );
    setInheritance( snapshot, IDS.teacherCal, 'both' );
    expect( queryAvailability( snapshot, IDS.teacherCal, RANGE ) )
      .toEqual( {
        ok: true,
        value: {
          calendarId: IDS.teacherCal,
          intervals: HOLE_INTERVALS,
        },
      } );
  } );
} );

describe( 'queryView', () => {
  test( 'teacher own event, slot, and booking are tagged own', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.teacherCal ) ],
      slots: [ slotOn( IDS.teacherCal ) ],
      bookings: [ bookingOn( IDS.teacherCal ) ],
    } );
    expect( queryView( snapshot, IDS.teacherCal, RANGE ) )
      .toEqual( {
        ok: true,
        value: {
          calendarId: IDS.teacherCal,
          range: RANGE,
          items: [
            ownEventItem(),
            {
              source: 'own',
              type: 'slot',
              id: IDS.slot,
              calendarId: IDS.teacherCal,
              start: SLOT_15_16.start,
              end: SLOT_15_16.end,
              occupancy: exclusive,
            },
            {
              source: 'own',
              type: 'booking',
              id: IDS.booking,
              calendarId: IDS.teacherCal,
              start: BOOKING_17.start,
              end: BOOKING_17.end,
            },
          ],
        },
      } );
  } );

  test( 'school holiday is tagged inherited on teacher view', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.schoolCal, {
        id: SCHOOL_EVENT,
        title: 'Holiday',
      } ) ],
    } );
    expect( queryView( snapshot, IDS.teacherCal, RANGE ) )
      .toEqual( {
        ok: true,
        value: {
          calendarId: IDS.teacherCal,
          range: RANGE,
          items: [
            {
              source: 'inherited',
              type: 'event',
              id: SCHOOL_EVENT,
              calendarId: IDS.schoolCal,
              title: 'Holiday',
              start: EVENT_13_14.start,
              end: EVENT_13_14.end,
              occupancy: exclusive,
            },
          ],
        },
      } );
  } );

  test( 'teacher class is rolled-up on school when path is roll-up/both', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.teacherCal ) ],
    } );
    expect( queryView( snapshot, IDS.schoolCal, RANGE ) )
      .toEqual( {
        ok: true,
        value: {
          calendarId: IDS.schoolCal,
          range: RANGE,
          items: [
            ownEventItem( { source: 'rolled-up' } ),
          ],
        },
      } );
  } );

  test( 'breaking one hop to none hides the class from school view', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.teacherCal ) ],
    } );
    setInheritance( snapshot, IDS.sectionCal, 'none' );
    expect( queryView( snapshot, IDS.schoolCal, RANGE ) )
      .toEqual( {
        ok: true,
        value: {
          calendarId: IDS.schoolCal,
          range: RANGE,
          items: [],
        },
      } );
  } );

  test( 'seat booking is own on teacher and not rolled-up on school', () => {
    const snapshot = teacherSnapshot( {
      events: [ eventOn( IDS.teacherCal ) ],
      bookings: [ bookingOn( IDS.teacherCal, {
        id: SEAT,
        start: '2026-09-08T13:15:00.000Z',
        end: '2026-09-08T13:45:00.000Z',
        eventId: IDS.event,
      } ) ],
    } );
    expect( queryView( snapshot, IDS.teacherCal, RANGE ) )
      .toEqual( {
        ok: true,
        value: {
          calendarId: IDS.teacherCal,
          range: RANGE,
          items: [
            ownEventItem(),
            {
              source: 'own',
              type: 'booking',
              id: SEAT,
              calendarId: IDS.teacherCal,
              start: '2026-09-08T13:15:00.000Z',
              end: '2026-09-08T13:45:00.000Z',
            },
          ],
        },
      } );
    const school = queryView( snapshot, IDS.schoolCal, RANGE );
    expect( school ).toEqual( {
      ok: true,
      value: {
        calendarId: IDS.schoolCal,
        range: RANGE,
        items: [ ownEventItem( { source: 'rolled-up' } ) ],
      },
    } );
    if ( !school.ok ) {
      return;
    }
    expect( school.value.items.some(
      ( item ) => item.type === 'booking',
    ) ).toBe( false );
  } );
} );

describe( 'query errors', () => {
  test( 'bad range returns range', () => {
    const snapshot = teacherSnapshot();
    const bad: TimeRange = {
      start: '2026-09-08T12:00:00.000Z',
      end: '2026-09-08T12:00:00.000Z',
    };
    expect( queryAvailability( snapshot, IDS.teacherCal, bad ) )
      .toMatchObject( { ok: false, error: { code: 'range' } } );
    expect( queryView( snapshot, IDS.teacherCal, bad ) )
      .toMatchObject( { ok: false, error: { code: 'range' } } );
  } );

  test( 'unknown calendar returns not_found', () => {
    const snapshot = teacherSnapshot();
    expect( queryAvailability( snapshot, UNKNOWN, RANGE ) )
      .toMatchObject( {
        ok: false,
        error: { code: 'not_found' },
      } );
    expect( queryView( snapshot, UNKNOWN, RANGE ) )
      .toMatchObject( {
        ok: false,
        error: { code: 'not_found' },
      } );
  } );
} );
