# scheduling-calendar

Framework-agnostic TypeScript engine for hierarchical scheduling and booking.

Each **entity** (school, term, section, course, teacher, student, or a host-defined type) can have exactly one **calendar**. Calendar parentage follows the entity tree: a teacher’s calendar is a child of their parent entity’s calendar. Child calendars can inherit busy time from ancestors, roll events up to parents, both, or neither.

This package is a **pure engine**. You pass a snapshot in; you get a report or a new snapshot out. There is no UI, HTTP server, or database connection.

**Status:** design approved. Implementation has not started. The spec is the source of truth until the first release.

## Spec

[docs/superpowers/specs/2026-08-12-scheduling-calendar-design.md](docs/superpowers/specs/2026-08-12-scheduling-calendar-design.md)

## What it will do

- Model entities, calendars, events, availability rules, bookable slots, and bookings
- Exclusive occupancy by default, optional capacity (seats) on events and slots
- Recurring events and working hours (`daily` / `weekly` / `yearly` plus `EXDATE`)
- Single-occurrence bookings (ad-hoc, slot seat, or event seat)
- `check*` then `apply*`, with `allowConflicts` to override occupancy conflicts
- `queryAvailability` and `queryView` with `own` / `inherited` / `rolled-up` tags

## What it will not do (v1)

UI, live database adapters, multi-resource booking, recurring bookings, auth, or notifications.

## Usage (planned)

```ts
import {
  applyBooking,
  queryAvailability,
} from 'scheduling-calendar';

const availability = queryAvailability(snapshot, teacherCalendarId, range);
const booked = applyBooking(snapshot, booking);

if (booked.ok) {
  // persist booked.value.snapshot
}
```

## Development

Use **bun**, not npm.

```bash
bun run typecheck
bun run test
bun run lint
```

Work on `feature/*` branches from `dev`. Merge each completed stage into `dev`. Merge `dev` into `main` when v1 is complete and tested.

## License

UNLICENSED until a license is chosen.
