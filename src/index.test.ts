import { expect, test } from 'bun:test';
import {
  applyAvailabilityRule,
  applyBooking,
  putCalendar,
  putEntity,
  putEntityCalendar,
  queryAvailability,
} from './index.ts';
import { IDS, NOW, emptySnapshot } from './test/fixtures.ts';

test( 'host can put a teacher calendar and book open time', () => {
  let snap = emptySnapshot();
  const student = putEntity( snap, {
    id: IDS.student,
    entityType: 'student',
    name: 'Lin',
  }, { now: NOW } );
  expect( student.ok ).toBe( true );
  if ( !student.ok ) {
    return;
  }
  snap = student.value.snapshot;

  const entity = putEntity( snap, {
    id: IDS.teacher,
    entityType: 'teacher',
    name: 'Ada',
  }, { now: NOW } );
  expect( entity.ok ).toBe( true );
  if ( !entity.ok ) {
    return;
  }
  snap = entity.value.snapshot;

  const calendar = putCalendar( snap, {
    id: IDS.teacherCal,
    timeZone: 'America/New_York',
    inheritance: 'none',
  }, { now: NOW } );
  expect( calendar.ok ).toBe( true );
  if ( !calendar.ok ) {
    return;
  }
  snap = calendar.value.snapshot;

  const link = putEntityCalendar( snap, {
    id: IDS.linkTeacher,
    entityId: IDS.teacher,
    calendarId: IDS.teacherCal,
  }, { now: NOW } );
  expect( link.ok ).toBe( true );
  if ( !link.ok ) {
    return;
  }
  snap = link.value.snapshot;

  const rule = applyAvailabilityRule( snap, {
    id: IDS.rule,
    calendarId: IDS.teacherCal,
    startTime: '08:00',
    endTime: '15:00',
    recurrence: { freq: 'weekly', byDay: [ 'MO', 'TU', 'WE', 'TH', 'FR' ] },
  }, { now: NOW } );
  expect( rule.ok ).toBe( true );
  if ( !rule.ok ) {
    return;
  }
  snap = rule.value.snapshot;

  const booked = applyBooking( snap, {
    id: IDS.booking,
    calendarId: IDS.teacherCal,
    start: '2026-09-08T13:30:00.000Z',
    end: '2026-09-08T14:00:00.000Z',
    attendeeId: IDS.student,
  }, { now: NOW } );
  expect( booked.ok ).toBe( true );
  if ( !booked.ok ) {
    return;
  }

  const availability = queryAvailability(
    booked.value.snapshot,
    IDS.teacherCal,
    {
      start: '2026-09-08T12:00:00.000Z',
      end: '2026-09-08T19:00:00.000Z',
    },
  );
  expect( availability.ok ).toBe( true );
  if ( !availability.ok ) {
    return;
  }
  expect( availability.value.intervals ).toEqual( [
    {
      start: '2026-09-08T12:00:00.000Z',
      end: '2026-09-08T13:30:00.000Z',
    },
    {
      start: '2026-09-08T14:00:00.000Z',
      end: '2026-09-08T19:00:00.000Z',
    },
  ] );
} );
