import { describe, expect, test } from 'bun:test';
import { expandRecurrence } from './recurrence.ts';
import { IDS, NOW } from './test/fixtures.ts';
import { civilDateInZone, zonedInstant } from './time.ts';
import type {
  AvailabilityRule,
  CalendarEvent,
  Instant,
  Occupancy,
  RecurrenceRule,
  TimeRange,
} from './types.ts';

const TZ = 'America/New_York';
const exclusive: Occupancy = { kind: 'exclusive' };

/** Civil midnight in `TZ` as a UTC instant. */
function midnight( dateOnly: string ): Instant {
  const instant = zonedInstant( dateOnly, '00:00', TZ );
  if ( instant === undefined ) {
    throw new Error( `midnight failed for ${ dateOnly }` );
  }
  return instant;
}

/** Half-open civil range `[startDate, endDate)` in `TZ`. */
function civilRange( startDate: string, endDate: string ): TimeRange {
  return { start: midnight( startDate ), end: midnight( endDate ) };
}

function event(
  recurrence?: RecurrenceRule,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  return {
    id: IDS.event,
    calendarId: IDS.teacherCal,
    title: 'Class',
    start: '2026-09-08T13:00:00.000Z',
    end: '2026-09-08T14:00:00.000Z',
    occupancy: exclusive,
    createdAt: NOW,
    updatedAt: NOW,
    ...( recurrence ? { recurrence } : {} ),
    ...overrides,
  };
}

function rule(
  recurrence: RecurrenceRule,
  overrides: Partial<AvailabilityRule> = {},
): AvailabilityRule {
  return {
    id: IDS.rule,
    calendarId: IDS.teacherCal,
    startTime: '09:00',
    endTime: '10:00',
    recurrence,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe( 'expandRecurrence', () => {
  test( 'daily interval 1 over Sep 8–10 yields the 8th and 9th', () => {
    const result = expandRecurrence(
      event( { freq: 'daily', interval: 1 } ),
      civilRange( '2026-09-08', '2026-09-10' ),
      TZ,
    );
    expect( result ).toEqual( {
      ok: true,
      value: [
        {
          start: '2026-09-08T13:00:00.000Z',
          end: '2026-09-08T14:00:00.000Z',
        },
        {
          start: '2026-09-09T13:00:00.000Z',
          end: '2026-09-09T14:00:00.000Z',
        },
      ],
    } );
  } );

  test( 'weekly without byDay yields four Tuesdays', () => {
    const result = expandRecurrence(
      event( { freq: 'weekly' } ),
      civilRange( '2026-09-08', '2026-10-06' ),
      TZ,
    );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value ).toEqual( [
      {
        start: '2026-09-08T13:00:00.000Z',
        end: '2026-09-08T14:00:00.000Z',
      },
      {
        start: '2026-09-15T13:00:00.000Z',
        end: '2026-09-15T14:00:00.000Z',
      },
      {
        start: '2026-09-22T13:00:00.000Z',
        end: '2026-09-22T14:00:00.000Z',
      },
      {
        start: '2026-09-29T13:00:00.000Z',
        end: '2026-09-29T14:00:00.000Z',
      },
    ] );
  } );

  test( 'weekly byDay MO,WE omits the Tuesday prototype weekday', () => {
    const result = expandRecurrence(
      event( { freq: 'weekly', interval: 1, byDay: [ 'MO', 'WE' ] } ),
      civilRange( '2026-09-08', '2026-09-15' ),
      TZ,
    );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value ).toEqual( [
      {
        start: '2026-09-09T13:00:00.000Z',
        end: '2026-09-09T14:00:00.000Z',
      },
      {
        start: '2026-09-14T13:00:00.000Z',
        end: '2026-09-14T14:00:00.000Z',
      },
    ] );
  } );

  test( 'count 2 daily yields exactly two even when the range is longer', () => {
    const result = expandRecurrence(
      event( { freq: 'daily', count: 2 } ),
      civilRange( '2026-09-08', '2026-09-20' ),
      TZ,
    );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value ).toHaveLength( 2 );
    expect( result.value ).toEqual( [
      {
        start: '2026-09-08T13:00:00.000Z',
        end: '2026-09-08T14:00:00.000Z',
      },
      {
        start: '2026-09-09T13:00:00.000Z',
        end: '2026-09-09T14:00:00.000Z',
      },
    ] );
  } );

  test( 'until compared to occurrence start drops a later occurrence', () => {
    const result = expandRecurrence(
      event( {
        freq: 'daily',
        until: '2026-09-09T00:00:00.000Z',
      } ),
      civilRange( '2026-09-08', '2026-09-12' ),
      TZ,
    );
    expect( result ).toEqual( {
      ok: true,
      value: [
        {
          start: '2026-09-08T13:00:00.000Z',
          end: '2026-09-08T14:00:00.000Z',
        },
      ],
    } );
  } );

  test( 'excludedDates omits Sep 9 from a daily series', () => {
    const result = expandRecurrence(
      event(
        { freq: 'daily' },
        { excludedDates: [ '2026-09-09' ] },
      ),
      civilRange( '2026-09-08', '2026-09-11' ),
      TZ,
    );
    expect( result ).toEqual( {
      ok: true,
      value: [
        {
          start: '2026-09-08T13:00:00.000Z',
          end: '2026-09-08T14:00:00.000Z',
        },
        {
          start: '2026-09-10T13:00:00.000Z',
          end: '2026-09-10T14:00:00.000Z',
        },
      ],
    } );
  } );

  test( 'yearly Feb 29 skips non-leap years', () => {
    const result = expandRecurrence(
      event(
        { freq: 'yearly' },
        {
          start: '2024-02-29T14:00:00.000Z',
          end: '2024-02-29T15:00:00.000Z',
        },
      ),
      civilRange( '2024-01-01', '2029-01-01' ),
      TZ,
    );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value ).toEqual( [
      {
        start: '2024-02-29T14:00:00.000Z',
        end: '2024-02-29T15:00:00.000Z',
      },
      {
        start: '2028-02-29T14:00:00.000Z',
        end: '2028-02-29T15:00:00.000Z',
      },
    ] );
  } );

  test( 'weekly 09:00 stays 09:00 across 2026-03-08 spring-forward', () => {
    const result = expandRecurrence(
      event(
        { freq: 'weekly' },
        {
          start: '2026-03-03T14:00:00.000Z',
          end: '2026-03-03T15:00:00.000Z',
        },
      ),
      civilRange( '2026-03-03', '2026-03-11' ),
      TZ,
    );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value ).toHaveLength( 2 );
    expect( result.value[ 0 ] ).toEqual( {
      start: '2026-03-03T14:00:00.000Z',
      end: '2026-03-03T15:00:00.000Z',
    } );
    expect( result.value[ 1 ]!.start ).toBe(
      zonedInstant( '2026-03-10', '09:00', TZ ),
    );
    expect( civilDateInZone( result.value[ 1 ]!.start, TZ ) ).toBe(
      '2026-03-10',
    );
  } );

  test( 'weekly 09:00 stays 09:00 across 2026-11-01 fall-back', () => {
    const result = expandRecurrence(
      event(
        { freq: 'weekly' },
        {
          start: '2026-10-27T13:00:00.000Z',
          end: '2026-10-27T14:00:00.000Z',
        },
      ),
      civilRange( '2026-10-27', '2026-11-04' ),
      TZ,
    );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value ).toHaveLength( 2 );
    expect( result.value[ 0 ] ).toEqual( {
      start: '2026-10-27T13:00:00.000Z',
      end: '2026-10-27T14:00:00.000Z',
    } );
    expect( result.value[ 1 ]!.start ).toBe(
      zonedInstant( '2026-11-03', '09:00', TZ ),
    );
    expect( civilDateInZone( result.value[ 1 ]!.start, TZ ) ).toBe(
      '2026-11-03',
    );
  } );

  test( 'overnight rule ends on the next civil day', () => {
    const result = expandRecurrence(
      rule(
        { freq: 'weekly', byDay: [ 'TU' ] },
        { startTime: '22:00', endTime: '02:00' },
      ),
      civilRange( '2026-09-08', '2026-09-10' ),
      TZ,
    );
    expect( result ).toEqual( {
      ok: true,
      value: [
        {
          start: '2026-09-09T02:00:00.000Z',
          end: '2026-09-09T06:00:00.000Z',
        },
      ],
    } );
  } );

  test( 'overnight rule lookbehind still intersects the next morning', () => {
    const result = expandRecurrence(
      rule(
        { freq: 'weekly', byDay: [ 'TU' ] },
        { startTime: '22:00', endTime: '02:00' },
      ),
      civilRange( '2026-09-09', '2026-09-10' ),
      TZ,
    );
    expect( result ).toEqual( {
      ok: true,
      value: [
        {
          start: '2026-09-09T02:00:00.000Z',
          end: '2026-09-09T06:00:00.000Z',
        },
      ],
    } );
  } );

  test( 'rule daily interval 2 aligns to the range-start civil date', () => {
    const result = expandRecurrence(
      rule( { freq: 'daily', interval: 2 } ),
      civilRange( '2026-09-08', '2026-09-13' ),
      TZ,
    );
    expect( result ).toEqual( {
      ok: true,
      value: [
        {
          start: '2026-09-08T13:00:00.000Z',
          end: '2026-09-08T14:00:00.000Z',
        },
        {
          start: '2026-09-10T13:00:00.000Z',
          end: '2026-09-10T14:00:00.000Z',
        },
        {
          start: '2026-09-12T13:00:00.000Z',
          end: '2026-09-12T14:00:00.000Z',
        },
      ],
    } );
  } );

  test( 'rule daily count 2 starts at the range-start civil date', () => {
    const result = expandRecurrence(
      rule( { freq: 'daily', count: 2 } ),
      civilRange( '2026-09-08', '2026-09-20' ),
      TZ,
    );
    expect( result ).toEqual( {
      ok: true,
      value: [
        {
          start: '2026-09-08T13:00:00.000Z',
          end: '2026-09-08T14:00:00.000Z',
        },
        {
          start: '2026-09-09T13:00:00.000Z',
          end: '2026-09-09T14:00:00.000Z',
        },
      ],
    } );
  } );

  test( 'rule weekly interval 2 aligns weeks to the range-start Monday', () => {
    const result = expandRecurrence(
      rule( { freq: 'weekly', interval: 2, byDay: [ 'MO' ] } ),
      civilRange( '2026-09-14', '2026-10-12' ),
      TZ,
    );
    expect( result ).toEqual( {
      ok: true,
      value: [
        {
          start: '2026-09-14T13:00:00.000Z',
          end: '2026-09-14T14:00:00.000Z',
        },
        {
          start: '2026-09-28T13:00:00.000Z',
          end: '2026-09-28T14:00:00.000Z',
        },
      ],
    } );
  } );

  test( 'unknown IANA zone returns validation', () => {
    const result = expandRecurrence(
      event( { freq: 'daily' } ),
      civilRange( '2026-09-08', '2026-09-10' ),
      'Not/AZone',
    );
    expect( result.ok ).toBe( false );
    if ( result.ok ) {
      return;
    }
    expect( result.error.code ).toBe( 'validation' );
  } );

  test( 'range start >= end returns a range error', () => {
    const result = expandRecurrence(
      event( { freq: 'daily' } ),
      {
        start: '2026-09-08T13:00:00.000Z',
        end: '2026-09-08T13:00:00.000Z',
      },
      TZ,
    );
    expect( result.ok ).toBe( false );
    if ( result.ok ) {
      return;
    }
    expect( result.error.code ).toBe( 'range' );
  } );

  test( 'includes an occurrence that starts before the range and ends inside it', () => {
    const result = expandRecurrence(
      event( { freq: 'daily' } ),
      {
        start: '2026-09-08T13:30:00.000Z',
        end: '2026-09-08T16:00:00.000Z',
      },
      TZ,
    );
    expect( result ).toEqual( {
      ok: true,
      value: [
        {
          start: '2026-09-08T13:00:00.000Z',
          end: '2026-09-08T14:00:00.000Z',
        },
      ],
    } );
  } );
} );
