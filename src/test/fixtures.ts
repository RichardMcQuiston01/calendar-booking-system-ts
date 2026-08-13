import type {
  Calendar,
  CalendarSnapshot,
  Entity,
  EntityCalendar,
  Instant,
} from '../types.ts';

/** Fixed `now` for deterministic tests. */
export const NOW: Instant = '2026-08-12T12:00:00.000Z';

/** Stable UUIDs shared across engine tests. */
export const IDS = {
  school: '11111111-1111-4111-8111-111111111111',
  term: '22222222-2222-4222-8222-222222222222',
  course: '33333333-3333-4333-8333-333333333333',
  section: '44444444-4444-4444-8444-444444444444',
  teacher: '55555555-5555-4555-8555-555555555555',
  student: '66666666-6666-4666-8666-666666666666',
  schoolCal: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  termCal: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  courseCal: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  sectionCal: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  teacherCal: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  linkSchool: '01010101-0101-4101-8101-010101010101',
  linkTerm: '02020202-0202-4202-8202-020202020202',
  linkCourse: '03030303-0303-4303-8303-030303030303',
  linkSection: '04040404-0404-4404-8404-040404040404',
  linkTeacher: '05050505-0505-4505-8505-050505050505',
  event: '77777777-7777-4777-8777-777777777777',
  rule: '88888888-8888-4888-8888-888888888888',
  slot: '99999999-9999-4999-8999-999999999999',
  booking: 'abababab-abab-4bab-8bab-abababababab',
} as const;

function stamped<T extends object>(
  row: T,
): T & { createdAt: Instant; updatedAt: Instant } {
  return { ...row, createdAt: NOW, updatedAt: NOW };
}

/** Empty valid snapshot. */
export function emptySnapshot(): CalendarSnapshot {
  return {
    entities: [],
    calendars: [],
    entityCalendars: [],
    events: [],
    availabilityRules: [],
    slots: [],
    bookings: [],
  };
}

/**
 * School → term → course → section → teacher, each with a calendar.
 * School inheritance is `none`; every other calendar is `both`.
 */
export function schoolTreeSnapshot(): CalendarSnapshot {
  const entities: Entity[] = [
    stamped( {
      id: IDS.school,
      entityType: 'school',
      name: 'School',
    } ),
    stamped( {
      id: IDS.term,
      entityType: 'term',
      name: 'Term',
      parentId: IDS.school,
    } ),
    stamped( {
      id: IDS.course,
      entityType: 'course',
      name: 'Course',
      parentId: IDS.term,
    } ),
    stamped( {
      id: IDS.section,
      entityType: 'section',
      name: 'Section',
      parentId: IDS.course,
    } ),
    stamped( {
      id: IDS.teacher,
      entityType: 'teacher',
      name: 'Teacher',
      parentId: IDS.section,
    } ),
  ];

  const calendars: Calendar[] = [
    stamped( {
      id: IDS.schoolCal,
      timeZone: 'America/New_York',
      inheritance: 'none',
    } ),
    stamped( {
      id: IDS.termCal,
      timeZone: 'America/New_York',
      inheritance: 'both',
    } ),
    stamped( {
      id: IDS.courseCal,
      timeZone: 'America/New_York',
      inheritance: 'both',
    } ),
    stamped( {
      id: IDS.sectionCal,
      timeZone: 'America/New_York',
      inheritance: 'both',
    } ),
    stamped( {
      id: IDS.teacherCal,
      timeZone: 'America/New_York',
      inheritance: 'both',
    } ),
  ];

  const entityCalendars: EntityCalendar[] = [
    stamped( {
      id: IDS.linkSchool,
      entityId: IDS.school,
      calendarId: IDS.schoolCal,
    } ),
    stamped( {
      id: IDS.linkTerm,
      entityId: IDS.term,
      calendarId: IDS.termCal,
    } ),
    stamped( {
      id: IDS.linkCourse,
      entityId: IDS.course,
      calendarId: IDS.courseCal,
    } ),
    stamped( {
      id: IDS.linkSection,
      entityId: IDS.section,
      calendarId: IDS.sectionCal,
    } ),
    stamped( {
      id: IDS.linkTeacher,
      entityId: IDS.teacher,
      calendarId: IDS.teacherCal,
    } ),
  ];

  return {
    entities,
    calendars,
    entityCalendars,
    events: [],
    availabilityRules: [],
    slots: [],
    bookings: [],
  };
}
