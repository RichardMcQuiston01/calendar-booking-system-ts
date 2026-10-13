import { describe, expect, test } from 'bun:test';
import {
  buildSnapshotIndex,
  bookingsOn,
  calendarIn,
  eventsOn,
  findById,
  findIndexById,
  slotsOf,
  sortedCopy,
} from './lookup.ts';
import { IDS, NOW, schoolTreeSnapshot } from './test/fixtures.ts';
import { queryView } from './query.ts';
import type { CalendarSnapshot } from './types.ts';

describe( 'lookup helpers', () => {
  test( 'sortedCopy does not reorder or alias its input', () => {
    const input = [ 3, 1, 2 ];
    const output = sortedCopy( input, ( a, b ) => a - b );
    expect( output ).toEqual( [ 1, 2, 3 ] );
    expect( input ).toEqual( [ 3, 1, 2 ] );
    expect( output ).not.toBe( input );
  } );

  test( 'findById and findIndexById ignore UUID case', () => {
    const rows = [ { id: IDS.school }, { id: IDS.term } ];
    expect( findById( rows, IDS.term.toUpperCase() ) ).toBe( rows[ 1 ] );
    expect( findIndexById( rows, IDS.term.toUpperCase() ) ).toBe( 1 );
    expect( findById( rows, IDS.course ) ).toBeUndefined();
    expect( findIndexById( rows, IDS.course ) ).toBe( -1 );
  } );
} );

describe( 'buildSnapshotIndex', () => {
  test( 'groups rows by calendar in snapshot order', () => {
    const snapshot: CalendarSnapshot = schoolTreeSnapshot();
    const stamp = { createdAt: NOW, updatedAt: NOW };
    const event = ( id: string, calendarId: string ) => ( {
      id,
      calendarId,
      title: id,
      start: '2026-09-08T13:00:00.000Z',
      end: '2026-09-08T14:00:00.000Z',
      occupancy: { kind: 'exclusive' as const },
      ...stamp,
    } );
    snapshot.events.push(
      event( '10000000-0000-4000-8000-000000000001', IDS.teacherCal ),
      event( '10000000-0000-4000-8000-000000000002', IDS.schoolCal ),
      event( '10000000-0000-4000-8000-000000000003', IDS.teacherCal ),
    );
    const index = buildSnapshotIndex( snapshot );
    expect(
      eventsOn( index, IDS.teacherCal.toUpperCase() ).map( ( row ) => row.id ),
    ).toEqual( [
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000003',
    ] );
    expect( slotsOf( index, IDS.teacherCal ) ).toEqual( [] );
    expect( bookingsOn( index, IDS.teacherCal ) ).toEqual( [] );
    expect( calendarIn( index, IDS.teacherCal )?.id ).toBe( IDS.teacherCal );
    expect( calendarIn( index, IDS.course.replace( '3', '4' ) ) )
      .toBeUndefined();
  } );
} );

describe( 'deep org tree', () => {
  test( 'queryView on a deep chain returns every inherited level', () => {
    const depth = 120;
    const stamp = { createdAt: NOW, updatedAt: NOW };
    const uuid = ( prefix: number, n: number ): string =>
      `${ prefix.toString( 16 ).padStart( 8, '0' ) }-0000-4000-8000-` +
      n.toString( 16 ).padStart( 12, '0' );
    const snapshot: CalendarSnapshot = {
      entities: [],
      calendars: [],
      entityCalendars: [],
      events: [],
      availabilityRules: [],
      slots: [],
      bookings: [],
    };
    for ( let i = 0; i < depth; i += 1 ) {
      snapshot.entities.push( {
        id: uuid( 1, i ),
        entityType: 'org',
        name: `org ${ i }`,
        ...( i > 0 ? { parentId: uuid( 1, i - 1 ) } : {} ),
        ...stamp,
      } );
      snapshot.calendars.push( {
        id: uuid( 2, i ),
        timeZone: 'UTC',
        inheritance: 'both',
        ...stamp,
      } );
      snapshot.entityCalendars.push( {
        id: uuid( 3, i ),
        entityId: uuid( 1, i ),
        calendarId: uuid( 2, i ),
        ...stamp,
      } );
      snapshot.events.push( {
        id: uuid( 4, i ),
        calendarId: uuid( 2, i ),
        title: `event ${ i }`,
        start: '2026-09-08T13:00:00.000Z',
        end: '2026-09-08T14:00:00.000Z',
        occupancy: { kind: 'capacity', max: 5 },
        ...stamp,
      } );
    }
    const range = {
      start: '2026-09-07T00:00:00.000Z',
      end: '2026-09-14T00:00:00.000Z',
    };
    const leaf = queryView( snapshot, uuid( 2, depth - 1 ), range );
    expect( leaf.ok ).toBe( true );
    if ( leaf.ok ) {
      expect( leaf.value.items ).toHaveLength( depth );
      expect(
        leaf.value.items.filter( ( item ) => item.source === 'own' ),
      ).toHaveLength( 1 );
      expect(
        leaf.value.items.filter( ( item ) => item.source === 'inherited' ),
      ).toHaveLength( depth - 1 );
    }
    const root = queryView( snapshot, uuid( 2, 0 ), range );
    expect( root.ok ).toBe( true );
    if ( root.ok ) {
      expect(
        root.value.items.filter( ( item ) => item.source === 'rolled-up' ),
      ).toHaveLength( depth - 1 );
    }
  } );
} );
