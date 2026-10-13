import { expect, test } from 'bun:test';
import {
  civilDateInZone,
  isCanonicalInstant,
  isValidClockTime,
  isValidTimeZone,
  overlaps,
  rangeProblem,
  weekdayInZone,
  zonedInstant,
} from './time.ts';

test( 'rejects an unknown IANA zone', () => {
  expect( isValidTimeZone( 'Not/AZone' ) ).toBe( false );
} );

test( 'accepts America/New_York', () => {
  expect( isValidTimeZone( 'America/New_York' ) ).toBe( true );
} );

test( 'accepts HH:mm and rejects 24:00', () => {
  expect( isValidClockTime( '09:30' ) ).toBe( true );
  expect( isValidClockTime( '24:00' ) ).toBe( false );
} );

test( 'touching intervals do not overlap', () => {
  expect( overlaps(
    { start: '2026-09-08T13:00:00.000Z', end: '2026-09-08T14:00:00.000Z' },
    { start: '2026-09-08T14:00:00.000Z', end: '2026-09-08T15:00:00.000Z' },
  ) ).toBe( false );
} );

test( 'overlapping intervals overlap', () => {
  expect( overlaps(
    { start: '2026-09-08T13:00:00.000Z', end: '2026-09-08T14:00:00.000Z' },
    { start: '2026-09-08T13:30:00.000Z', end: '2026-09-08T15:00:00.000Z' },
  ) ).toBe( true );
} );

test( 'equivalent instants in different lexical forms overlap', () => {
  expect( overlaps(
    {
      start: '2026-09-08T13:00:00.000Z',
      end: '2026-09-08T14:00:00.000Z',
    },
    {
      start: '2026-09-08T09:00:00.000-04:00',
      end: '2026-09-08T10:00:00.000-04:00',
    },
  ) ).toBe( true );
  expect( overlaps(
    {
      start: '2026-09-08T13:00:00.000Z',
      end: '2026-09-08T14:00:00.000Z',
    },
    {
      start: '2026-09-08T13:00:00Z',
      end: '2026-09-08T14:00:00Z',
    },
  ) ).toBe( true );
} );

test( 'civil date and weekday follow the zone', () => {
  // 2026-09-08 00:30 EDT = 04:30Z
  const instant = '2026-09-08T04:30:00.000Z';
  expect( civilDateInZone( instant, 'America/New_York' ) ).toBe( '2026-09-08' );
  expect( weekdayInZone( instant, 'America/New_York' ) ).toBe( 'TU' );
} );

test( 'zonedInstant builds a UTC instant from civil parts', () => {
  expect( zonedInstant( '2026-09-08', '09:00', 'America/New_York' ) )
    .toBe( '2026-09-08T13:00:00.000Z' );
} );

test( 'isCanonicalInstant accepts only YYYY-MM-DDTHH:mm:ss.sssZ', () => {
  expect( isCanonicalInstant( '2026-09-08T12:00:00.000Z' ) ).toBe( true );
  for ( const bad of [
    '2026-09-08T12:00:00Z',
    '2026-09-08T12:00:00.000+00:00',
    '2026-09-08T08:00:00.000-04:00',
    '2026-09-08T09:00:00',
    '2026-09-08',
    '2026-02-30T12:00:00.000Z',
    'nope',
  ] ) {
    expect( isCanonicalInstant( bad ) ).toBe( false );
  }
} );

test( 'rangeProblem rejects non-canonical and inverted ranges', () => {
  expect(
    rangeProblem( {
      start: '2026-09-08T00:00:00.000Z',
      end: '2026-09-09T00:00:00.000Z',
    } ),
  ).toBeUndefined();
  expect(
    rangeProblem( {
      start: '2026-06-01T12:00:00-04:00',
      end: '2026-06-01T15:00:00.000Z',
    } ),
  ).toContain( 'canonical' );
  expect(
    rangeProblem( {
      start: '2026-09-09T00:00:00.000Z',
      end: '2026-09-08T00:00:00.000Z',
    } ),
  ).toContain( 'before' );
} );
