import { describe, expect, test } from 'bun:test';
import { openAvailability } from './availability.ts';
import { IDS, NOW, schoolTreeSnapshot } from './test/fixtures.ts';
import type {
  AvailabilityRule,
  BookableSlot,
  CalendarEvent,
  Occupancy,
  TimeRange,
} from './types.ts';

const exclusive: Occupancy = { kind: 'exclusive' };

/** Whole UTC day 2026-09-08 (Tuesday). */
const RANGE: TimeRange = {
  start: '2026-09-08T00:00:00.000Z',
  end: '2026-09-09T00:00:00.000Z',
};

const RULE_B = '88888888-8888-4888-8888-888888888880';
const SCHOOL_EVENT = '14141414-1414-4141-8141-141414141414';

const OPEN_DAY = {
  start: '2026-09-08T12:00:00.000Z',
  end: '2026-09-08T19:00:00.000Z',
};

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

function teacherSnapshot(
  extras: {
    rules?: AvailabilityRule[];
    events?: CalendarEvent[];
    slots?: BookableSlot[];
  } = {},
): ReturnType<typeof schoolTreeSnapshot> {
  const snapshot = schoolTreeSnapshot();
  snapshot.availabilityRules.push( ...( extras.rules ?? [] ) );
  snapshot.events.push( ...( extras.events ?? [] ) );
  snapshot.slots.push( ...( extras.slots ?? [] ) );
  return snapshot;
}

describe( 'openAvailability', () => {
  test( 'no busy yields one interval 12:00Z–19:00Z', () => {
    const snapshot = teacherSnapshot( {
      rules: [ weekdayRule() ],
    } );
    expect( openAvailability( snapshot, IDS.teacherCal, RANGE ) )
      .toEqual( {
        ok: true,
        value: [ OPEN_DAY ],
      } );
  } );

  test( 'event 13:00–14:00Z punches a hole', () => {
    const snapshot = teacherSnapshot( {
      rules: [ weekdayRule() ],
      events: [ eventOn( IDS.teacherCal ) ],
    } );
    expect( openAvailability( snapshot, IDS.teacherCal, RANGE ) )
      .toEqual( {
        ok: true,
        value: [
          {
            start: '2026-09-08T12:00:00.000Z',
            end: '2026-09-08T13:00:00.000Z',
          },
          {
            start: '2026-09-08T14:00:00.000Z',
            end: '2026-09-08T19:00:00.000Z',
          },
        ],
      } );
  } );

  test( 'slot 15:00–16:00Z is subtracted', () => {
    const snapshot = teacherSnapshot( {
      rules: [ weekdayRule() ],
      slots: [ slotOn( IDS.teacherCal ) ],
    } );
    expect( openAvailability( snapshot, IDS.teacherCal, RANGE ) )
      .toEqual( {
        ok: true,
        value: [
          {
            start: '2026-09-08T12:00:00.000Z',
            end: '2026-09-08T15:00:00.000Z',
          },
          {
            start: '2026-09-08T16:00:00.000Z',
            end: '2026-09-08T19:00:00.000Z',
          },
        ],
      } );
  } );

  test( 'inherited school block punches a hole', () => {
    const snapshot = teacherSnapshot( {
      rules: [ weekdayRule() ],
      events: [ eventOn( IDS.schoolCal, { id: SCHOOL_EVENT } ) ],
    } );
    expect( openAvailability( snapshot, IDS.teacherCal, RANGE ) )
      .toEqual( {
        ok: true,
        value: [
          {
            start: '2026-09-08T12:00:00.000Z',
            end: '2026-09-08T13:00:00.000Z',
          },
          {
            start: '2026-09-08T14:00:00.000Z',
            end: '2026-09-08T19:00:00.000Z',
          },
        ],
      } );
  } );

  test( 'overnight rule 22:00–02:00 produces a crossing interval', () => {
    const snapshot = teacherSnapshot( {
      rules: [ weekdayRule( {
        startTime: '22:00',
        endTime: '02:00',
      } ) ],
    } );
    expect( openAvailability( snapshot, IDS.teacherCal, RANGE ) )
      .toEqual( {
        ok: true,
        value: [ {
          start: '2026-09-08T02:00:00.000Z',
          end: '2026-09-08T06:00:00.000Z',
        } ],
      } );
  } );

  test( 'adjacent open intervals merge when they touch', () => {
    const snapshot = teacherSnapshot( {
      rules: [
        weekdayRule( { startTime: '08:00', endTime: '09:00' } ),
        weekdayRule( {
          id: RULE_B,
          startTime: '09:00',
          endTime: '10:00',
        } ),
      ],
    } );
    expect( openAvailability( snapshot, IDS.teacherCal, RANGE ) )
      .toEqual( {
        ok: true,
        value: [ {
          start: '2026-09-08T12:00:00.000Z',
          end: '2026-09-08T14:00:00.000Z',
        } ],
      } );
  } );
} );
