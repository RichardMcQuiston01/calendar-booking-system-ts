# @richardmcquiston01/calendar-booking-system

Framework-agnostic TypeScript engine for hierarchical scheduling and booking.

Each **entity** (school, term, section, course, teacher, student, or a host-defined type) can have exactly one **calendar**. Calendar parentage follows the entity tree: a teacher’s calendar is a child of their parent entity’s calendar. A calendar's `inheritance` mode decides how it treats that parent: inherit busy time from ancestors (`inherit-blocks`), roll its own events up to them (`roll-up`), `both`, or `none`.

This package is a **pure engine**. You pass a snapshot in; you get a report or a new snapshot out. There is no UI, HTTP server, or database connection.

The public API is the `src/index.ts` barrel; import everything from the
package root.

## Install

The package is not published to a registry yet. When it is:

```bash
bun add @richardmcquiston01/calendar-booking-system
```

## Snapshot shape

Hosts map persisted rows into a `CalendarSnapshot` and pass that
object into every call. Functions never mutate the input.

| Collection | Type | Role |
| --- | --- | --- |
| `entities` | `Entity[]` | Owners (school, term, teacher, …) |
| `calendars` | `Calendar[]` | Time zone and inheritance mode |
| `entityCalendars` | `EntityCalendar[]` | 1:1 entity ↔ calendar link |
| `events` | `CalendarEvent[]` | Busy time; optional recurrence |
| `availabilityRules` | `AvailabilityRule[]` | Working hours in the calendar zone |
| `slots` | `BookableSlot[]` | Bookable windows (not ad-hoc-open) |
| `bookings` | `Booking[]` | Single-occurrence seats or ad-hoc |

For any operation on calendar C, load C, its entity and link, every
ancestor (and that ancestor’s calendar if it has one), the descendant
subtree, and the events, rules, slots, and bookings on those
calendars. `requiredCalendarIds` names calendars implied by entities
already in the snapshot.

An entity with no `entityCalendar` row is skipped (students need not
have calendars). The host supplies every UUID; the engine does not
generate ids.

## Check then apply

`check*` returns `{ ok: true, value: { conflicts } }` even when
conflicts exist — “ok” means the check ran. Inspect
`conflicts.length`. `apply*` with conflicts and
`allowConflicts !== true` returns `{ ok: false, error: { code:
'conflict' } }` and the same snapshot reference.

```ts
import {
  applyAvailabilityRule,
  applyBooking,
  checkBooking,
  putCalendar,
  putEntity,
  putEntityCalendar,
} from '@richardmcquiston01/calendar-booking-system';

const now = '2026-08-12T12:00:00.000Z';
const teacherId = '55555555-5555-4555-8555-555555555555';
const studentId = '66666666-6666-4666-8666-666666666666';
const teacherCalendarId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const bookingId = 'abababab-abab-4bab-8bab-abababababab';

let snapshot = {
  entities: [],
  calendars: [],
  entityCalendars: [],
  events: [],
  availabilityRules: [],
  slots: [],
  bookings: [],
};

const student = putEntity( snapshot, {
  id: studentId,
  entityType: 'student',
  name: 'Lin',
}, { now } );
if ( !student.ok ) {
  throw new Error( student.error.message );
}
snapshot = student.value.snapshot;

const teacher = putEntity( snapshot, {
  id: teacherId,
  entityType: 'teacher',
  name: 'Ada',
}, { now } );
if ( !teacher.ok ) {
  throw new Error( teacher.error.message );
}
snapshot = teacher.value.snapshot;

const calendar = putCalendar( snapshot, {
  id: teacherCalendarId,
  timeZone: 'America/New_York',
  inheritance: 'none',
}, { now } );
if ( !calendar.ok ) {
  throw new Error( calendar.error.message );
}
snapshot = calendar.value.snapshot;

const link = putEntityCalendar( snapshot, {
  id: '05050505-0505-4505-8505-050505050505',
  entityId: teacherId,
  calendarId: teacherCalendarId,
}, { now } );
if ( !link.ok ) {
  throw new Error( link.error.message );
}
snapshot = link.value.snapshot;

const rule = applyAvailabilityRule( snapshot, {
  id: '88888888-8888-4888-8888-888888888888',
  calendarId: teacherCalendarId,
  startTime: '08:00',
  endTime: '15:00',
  recurrence: {
    freq: 'weekly',
    byDay: [ 'MO', 'TU', 'WE', 'TH', 'FR' ],
  },
}, { now } );
if ( !rule.ok ) {
  throw new Error( rule.error.message );
}
snapshot = rule.value.snapshot;

const command = {
  id: bookingId,
  calendarId: teacherCalendarId,
  start: '2026-09-08T13:30:00.000Z',
  end: '2026-09-08T14:00:00.000Z',
  attendeeId: studentId,
};

const preview = checkBooking( snapshot, command );
if ( !preview.ok ) {
  throw new Error( preview.error.message );
}
if ( preview.value.conflicts.length > 0 ) {
  // inspect preview.value.conflicts, or apply with allowConflicts
}

const booked = applyBooking( snapshot, command, { now } );
if ( booked.ok ) {
  // persist booked.value.snapshot
}
```

Tuesday 2026-09-08 in `America/New_York`. The booking is 09:30–10:00
local. A school holiday event on an ancestor calendar blocks the
teacher when each hop uses `inherit-blocks` or `both`. The teacher’s
class event appears on the school `queryView` when each hop uses
`roll-up` or `both`.

## Query example

`queryAvailability` returns UTC intervals where an **ad-hoc** booking
may be placed (working-hours rules minus events, slots, other ad-hoc
bookings, and inherited blocks). Slots are not ad-hoc-open; book them
with `slotId`. `queryView` lists items that intersect the range,
tagged `own`, `inherited`, or `rolled-up`.

Occupancy helpers (`ownExclusiveBusy`, `inheritedBlocks`,
`effectiveExclusiveBusy`) return `[]` when `calendarId` is not in
the snapshot. `queryAvailability` and `queryView` return
`not_found` for an unknown calendar.

```ts
import {
  queryAvailability,
  queryView,
} from '@richardmcquiston01/calendar-booking-system';

const range = {
  start: '2026-09-08T12:00:00.000Z',
  end: '2026-09-08T19:00:00.000Z',
};

const availability = queryAvailability(
  snapshot,
  teacherCalendarId,
  range,
);
if ( availability.ok ) {
  // availability.value.intervals — open ad-hoc windows in UTC
}

const view = queryView( snapshot, teacherCalendarId, range );
if ( view.ok ) {
  // view.value.items — own / inherited / rolled-up
}
```

## Development

Use **bun**, not npm.

```bash
bun install
bun run typecheck   # tsc --noEmit
bun run test        # bun test
bun run lint        # eslint src sql
bun run build       # emit dist/
```

Reference PostgreSQL DDL matching the TypeScript model lives in
[`sql/schema.sql`](sql/schema.sql). The engine never executes SQL;
hosts apply the schema (or an equivalent) themselves.

## Buy Me a Coffee

I developed this while I am currently looking for work. If this app has helped you or someone you know, please consider donating. I appreciate it.

[**Donate via Stripe**](https://donate.stripe.com/00w5kD3Gj1Xo9v7gVOcs800), or scan:

[![Donate via Stripe](./donate.svg)](https://donate.stripe.com/00w5kD3Gj1Xo9v7gVOcs800)

## License

Apache 2.0 — see [`LICENSE`](LICENSE).
