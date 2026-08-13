import { describe, expect, test } from 'bun:test';
import {
  ancestorCalendarIds,
  descendantCalendarIds,
  inheritsBlocks,
  parentCalendarId,
  requiredCalendarIds,
  rollsUpTo,
} from './hierarchy.ts';
import {
  emptySnapshot,
  IDS,
  NOW,
  schoolTreeSnapshot,
} from './test/fixtures.ts';
import type { InheritanceMode } from './types.ts';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const ORPHAN_CAL = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const TREE_CHAIN = [
  IDS.teacherCal,
  IDS.sectionCal,
  IDS.courseCal,
  IDS.termCal,
  IDS.schoolCal,
] as const;

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

describe( 'parentCalendarId', () => {
  test( 'teacher calendar parent is the section calendar', () => {
    const snapshot = schoolTreeSnapshot();
    expect( parentCalendarId( snapshot, IDS.teacherCal ) )
      .toBe( IDS.sectionCal );
  } );

  test( 'skips an ancestor entity with no calendar link', () => {
    const snapshot = schoolTreeSnapshot();
    snapshot.entityCalendars = snapshot.entityCalendars.filter(
      ( link ) => link.calendarId !== IDS.sectionCal,
    );
    expect( parentCalendarId( snapshot, IDS.teacherCal ) )
      .toBe( IDS.courseCal );
  } );

  test( 'school calendar has no parent', () => {
    const snapshot = schoolTreeSnapshot();
    expect( parentCalendarId( snapshot, IDS.schoolCal ) )
      .toBeUndefined();
  } );

  test( 'calendar with no entity link has no parent', () => {
    const snapshot = schoolTreeSnapshot();
    snapshot.calendars.push( {
      id: ORPHAN_CAL,
      timeZone: 'America/New_York',
      inheritance: 'none',
      createdAt: NOW,
      updatedAt: NOW,
    } );
    expect( parentCalendarId( snapshot, ORPHAN_CAL ) ).toBeUndefined();
  } );
} );

describe( 'ancestorCalendarIds', () => {
  test( 'teacher ancestors walk section through school', () => {
    const snapshot = schoolTreeSnapshot();
    expect( ancestorCalendarIds( snapshot, IDS.teacherCal ) ).toEqual( [
      IDS.sectionCal,
      IDS.courseCal,
      IDS.termCal,
      IDS.schoolCal,
    ] );
  } );
} );

describe( 'descendantCalendarIds', () => {
  test( 'school descendants include teacher through term', () => {
    const snapshot = schoolTreeSnapshot();
    const descendants = descendantCalendarIds( snapshot, IDS.schoolCal );
    expect( descendants ).toEqual( expect.arrayContaining( [
      IDS.termCal,
      IDS.courseCal,
      IDS.sectionCal,
      IDS.teacherCal,
    ] ) );
    expect( descendants ).toHaveLength( 4 );
    expect( descendants ).not.toContain( IDS.schoolCal );
  } );
} );

describe( 'requiredCalendarIds', () => {
  test( 'teacher required set includes the full chain', () => {
    const snapshot = schoolTreeSnapshot();
    const result = requiredCalendarIds( snapshot, IDS.teacherCal );
    expect( result.ok ).toBe( true );
    if ( !result.ok ) {
      return;
    }
    expect( result.value ).toEqual( expect.arrayContaining( [ ...TREE_CHAIN ] ) );
    expect( result.value ).toHaveLength( TREE_CHAIN.length );
  } );

  test( 'unknown calendar returns not_found', () => {
    const snapshot = schoolTreeSnapshot();
    expect( requiredCalendarIds( snapshot, UNKNOWN ) ).toMatchObject( {
      ok: false,
      error: { code: 'not_found' },
    } );
  } );

  test( 'unlinked calendar still returns itself after validate', () => {
    const snapshot = schoolTreeSnapshot();
    snapshot.calendars.push( {
      id: ORPHAN_CAL,
      timeZone: 'America/New_York',
      inheritance: 'none',
      createdAt: NOW,
      updatedAt: NOW,
    } );
    expect( requiredCalendarIds( snapshot, ORPHAN_CAL ) ).toEqual( {
      ok: true,
      value: [ ORPHAN_CAL ],
    } );
  } );

  test( 'validates the snapshot before resolving ids', () => {
    const snapshot = emptySnapshot();
    snapshot.calendars.push( {
      id: 'nope',
      timeZone: 'America/New_York',
      inheritance: 'none',
      createdAt: NOW,
      updatedAt: NOW,
    } );
    expect( requiredCalendarIds( snapshot, 'nope' ) ).toMatchObject( {
      ok: false,
      error: { code: 'validation' },
    } );
  } );
} );

describe( 'inheritsBlocks', () => {
  test( 'both inherits blocks', () => {
    const snapshot = schoolTreeSnapshot();
    expect( inheritsBlocks( snapshot, IDS.teacherCal ) ).toBe( true );
  } );

  test( 'none does not inherit blocks', () => {
    const snapshot = schoolTreeSnapshot();
    setInheritance( snapshot, IDS.teacherCal, 'none' );
    expect( inheritsBlocks( snapshot, IDS.teacherCal ) ).toBe( false );
  } );

  test( 'inherit-blocks inherits blocks', () => {
    const snapshot = schoolTreeSnapshot();
    setInheritance( snapshot, IDS.teacherCal, 'inherit-blocks' );
    expect( inheritsBlocks( snapshot, IDS.teacherCal ) ).toBe( true );
  } );
} );

describe( 'rollsUpTo', () => {
  test( 'default both chain rolls up teacher to school', () => {
    const snapshot = schoolTreeSnapshot();
    expect( rollsUpTo( snapshot, IDS.teacherCal, IDS.schoolCal ) )
      .toBe( true );
  } );

  test( 'teacher none does not roll up to school', () => {
    const snapshot = schoolTreeSnapshot();
    setInheritance( snapshot, IDS.teacherCal, 'none' );
    expect( inheritsBlocks( snapshot, IDS.teacherCal ) ).toBe( false );
    expect( rollsUpTo( snapshot, IDS.teacherCal, IDS.schoolCal ) )
      .toBe( false );
  } );

  test( 'section none blocks roll-up past section', () => {
    const snapshot = schoolTreeSnapshot();
    setInheritance( snapshot, IDS.sectionCal, 'none' );
    expect( rollsUpTo( snapshot, IDS.teacherCal, IDS.schoolCal ) )
      .toBe( false );
    expect( rollsUpTo( snapshot, IDS.teacherCal, IDS.sectionCal ) )
      .toBe( true );
  } );

  test( 'inherit-blocks does not roll up to the parent', () => {
    const snapshot = schoolTreeSnapshot();
    setInheritance( snapshot, IDS.teacherCal, 'inherit-blocks' );
    expect( inheritsBlocks( snapshot, IDS.teacherCal ) ).toBe( true );
    expect( rollsUpTo( snapshot, IDS.teacherCal, IDS.sectionCal ) )
      .toBe( false );
  } );
} );
