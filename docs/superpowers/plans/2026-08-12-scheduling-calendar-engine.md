# Scheduling Calendar Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a headless, framework-agnostic TypeScript package (`scheduling-calendar`) that checks and applies events, slots, and bookings against an immutable hierarchical calendar snapshot.

**Architecture:** Pure functions over a `CalendarSnapshot`. No UI, HTTP, or database. Hosts pass state in and persist the new snapshot themselves. Calendar parentage is derived from `entity.parentId` plus the 1:1 `entity_calendar` link. Writes are copy-on-write; failed applies return the same snapshot reference.

**Tech Stack:** TypeScript (`strict`, ESM), bun (`bun test`, `bun run typecheck`, `bun run lint`), eslint + typescript-eslint. No runtime dependencies.

## Global Constraints

- Use **bun**, not npm.
- Package name `scheduling-calendar`, `"type": "module"`, TypeScript `strict`.
- 2-space indent, LF, trailing commas, ~80 column soft margin.
- Spaces inside import braces and object literal braces.
- JSDoc on every exported function, type, and interface.
- Tests colocated: `foo.ts` + `foo.test.ts`.
- Update `CHANGELOG.md` `[Unreleased]` in the same commit as the change.
- Update `README.md` when user-facing API or behavior is added.
- Conventional Commits; subject ≤ 50 characters.
- Work on `feature/*` from `dev`; merge each completed task/stage to `dev`.
- Host supplies UUIDs. Engine never generates ids.
- Domain failures return `Result<T>`; do not throw for validation/conflict/integrity.
- Intervals are half-open `[start, end)`. Touching endpoints do not overlap.
- Ids normalize to lowercase. UUID regex: 8-4-4-4-12 hex.
- Follow `docs/superpowers/specs/2026-08-12-scheduling-calendar-design.md` if anything here is unclear.
- Do not add UI, Prisma, HTTP, recurring bookings, or multi-resource booking.

## File map

| File | Responsibility |
| --- | --- |
| `package.json` | bun scripts: `typecheck`, `test`, `lint`, `build` |
| `tsconfig.json` | ESM, `strict`, `rootDir` `src`, `outDir` `dist` |
| `eslint.config.js` | typescript-eslint for `src/**/*.ts` |
| `sql/schema.sql` | Reference PostgreSQL schema from the spec |
| `src/types.ts` | Public types only |
| `src/result.ts` | `ok` / `err` |
| `src/ids.ts` | UUID validate/normalize |
| `src/time.ts` | Instants, zones, overlap, civil dates |
| `src/validate.ts` | `validateSnapshot` |
| `src/recurrence.ts` | `expandRecurrence` |
| `src/hierarchy.ts` | Entity tree, parent calendars, `requiredCalendarIds` |
| `src/occupancy.ts` | Own and inherited exclusive busy |
| `src/availability.ts` | Ad-hoc open intervals |
| `src/conflicts.ts` | `checkEvent`, `checkSlot`, `checkBooking` |
| `src/graph.ts` | put/remove entity, calendar, link |
| `src/apply.ts` | apply/update/delete/exclude/cancel |
| `src/query.ts` | `queryAvailability`, `queryView` |
| `src/index.ts` | Public barrel |
| `src/test/fixtures.ts` | Shared UUIDs and snapshot builders (test-only) |

---

### Task 1: Repo skeleton and reference SQL

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `eslint.config.js`
- Create: `sql/schema.sql`
- Create: `sql/schema.test.ts`
- Create: `src/index.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: spec §5.2 SQL and §10 package layout
- Produces: bun scripts `typecheck`, `test`, `lint`; `sql/schema.sql` with singular snake_case tables

- [ ] **Step 1: Write the failing schema test**

```ts
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe( 'sql/schema.sql', () => {
  test( 'declares every reference table', () => {
    const sql = readFileSync(
      join( import.meta.dir, 'schema.sql' ),
      'utf8',
    );
    for ( const table of [
      'entity',
      'calendar',
      'entity_calendar',
      'calendar_event',
      'availability_rule',
      'bookable_slot',
      'booking',
    ] ) {
      expect( sql ).toContain( `create table ${ table }` );
    }
  } );
} );
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test sql/schema.test.ts`

Expected: FAIL because `sql/schema.sql` does not exist.

- [ ] **Step 3: Write package files and schema**

`package.json`:

```json
{
  "name": "scheduling-calendar",
  "version": "0.0.0",
  "description": "Framework-agnostic TypeScript engine for hierarchical scheduling and booking",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "sql/schema.sql"],
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "lint": "eslint src sql",
    "build": "tsc"
  },
  "devDependencies": {
    "@eslint/js": "^9.0.0",
    "@types/bun": "latest",
    "eslint": "^9.0.0",
    "typescript": "^5.6.0",
    "typescript-eslint": "^8.0.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "src/test/**/*.ts"]
}
```

`eslint.config.js`: ESM flat config with `typescript-eslint` recommended, applied to `src/**/*.ts`. Ignore `dist` and `node_modules`.

Copy the exact `create table` / index SQL from spec §5.2 into `sql/schema.sql`.

`src/index.ts`:

```ts
/**
 * Public entry for the scheduling calendar engine.
 * Symbols are added as later tasks land.
 */
export {};
```

README: add a Development section with the three bun scripts. CHANGELOG: note the package skeleton and reference schema.

- [ ] **Step 4: Install deps and run tests**

Run: `bun install` then `bun test sql/schema.test.ts` then `bun run typecheck`

Expected: tests PASS; typecheck PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json eslint.config.js bun.lock sql/schema.sql sql/schema.test.ts src/index.ts README.md CHANGELOG.md
git commit -m "chore: scaffold bun TypeScript package" -m "Add the toolchain and reference SQL schema so later engine modules have a place to land."
```

---

### Task 2: Types, result, ids, time, and snapshot validation

**Files:**
- Create: `src/types.ts`
- Create: `src/result.ts`
- Create: `src/result.test.ts`
- Create: `src/ids.ts`
- Create: `src/ids.test.ts`
- Create: `src/time.ts`
- Create: `src/time.test.ts`
- Create: `src/validate.ts`
- Create: `src/validate.test.ts`
- Create: `src/test/fixtures.ts`
- Modify: `src/index.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: spec §6 types, §7.1 Result, §7.2 validate
- Produces:

```ts
ok<T>( value: T ): Result<T>
err( error: EngineError ): Result<never>
isUuid( value: string ): boolean
normalizeUuid( value: string ): string
parseInstant( value: string ): Date | undefined
toInstant( date: Date ): Instant
isValidTimeZone( zone: TimeZone ): boolean
isValidClockTime( value: string ): boolean
isValidDateOnly( value: string ): boolean
overlaps( a: TimeRange, b: TimeRange ): boolean
civilDateInZone( instant: Instant, timeZone: TimeZone ): DateOnly
weekdayInZone( instant: Instant, timeZone: TimeZone ): Weekday
zonedInstant(
  dateOnly: DateOnly,
  clockTime: ClockTime,
  timeZone: TimeZone,
): Instant | undefined
nowInstant(): Instant
validateSnapshot( snapshot: CalendarSnapshot ): Result<CalendarSnapshot>
```

Command input types (no timestamps):

```ts
type EntityInput = Omit<Entity, 'createdAt' | 'updatedAt'>
type CalendarInput = Omit<Calendar, 'createdAt' | 'updatedAt'>
type EntityCalendarInput = Omit<EntityCalendar, 'createdAt' | 'updatedAt'>
type EventInput = Omit<
  CalendarEvent,
  'createdAt' | 'updatedAt' | 'occupancy'
> & { occupancy?: Occupancy }
type RuleInput = Omit<AvailabilityRule, 'createdAt' | 'updatedAt'>
type SlotInput = Omit<
  BookableSlot,
  'createdAt' | 'updatedAt' | 'occupancy'
> & { occupancy?: Occupancy }
type BookingInput = Omit<Booking, 'createdAt' | 'updatedAt'>
```

Also export `TimeRange`, `Occurrence`, `CheckReport`, `ApplySuccess<T>`, `AvailabilityReport` as specified in the spec (`CheckReport`, `ApplySuccess` from §7.1–7.3; `AvailabilityReport` is `{ calendarId: Uuid; intervals: Occurrence[] }`).

- [ ] **Step 1: Write failing ids and result tests**

```ts
// src/ids.test.ts
import { describe, expect, test } from 'bun:test';
import { isUuid, normalizeUuid } from './ids.ts';

describe( 'isUuid', () => {
  test( 'accepts a canonical UUID', () => {
    expect( isUuid( '11111111-1111-4111-8111-111111111111' ) ).toBe( true );
  } );

  test( 'rejects a non-UUID', () => {
    expect( isUuid( 'not-a-uuid' ) ).toBe( false );
    expect( isUuid( '11111111111141118111111111111111' ) ).toBe( false );
  } );
} );

describe( 'normalizeUuid', () => {
  test( 'lowercases a valid UUID', () => {
    expect( normalizeUuid( '11111111-1111-4111-8111-111111111111' ) )
      .toBe( '11111111-1111-4111-8111-111111111111' );
  } );
} );
```

```ts
// src/result.test.ts
import { describe, expect, test } from 'bun:test';
import { err, ok } from './result.ts';

test( 'ok wraps a value', () => {
  expect( ok( 1 ) ).toEqual( { ok: true, value: 1 } );
} );

test( 'err wraps an engine error', () => {
  const error = { code: 'validation' as const, message: 'bad' };
  expect( err( error ) ).toEqual( { ok: false, error } );
} );
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/ids.test.ts src/result.test.ts`

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement types, result, and ids**

Copy public types from spec §6 and §7.1 into `src/types.ts` with JSDoc. Add the command/input types listed above.

```ts
// src/result.ts
import type { EngineError, Result } from './types.ts';

/** Successful domain result. */
export function ok<T>( value: T ): Result<T> {
  return { ok: true, value };
}

/** Failed domain result. */
export function err( error: EngineError ): Result<never> {
  return { ok: false, error };
}
```

```ts
// src/ids.ts
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is an 8-4-4-4-12 hex UUID. */
export function isUuid( value: string ): boolean {
  return UUID_RE.test( value );
}

/** Lowercase a UUID. Callers must already know it is valid. */
export function normalizeUuid( value: string ): string {
  return value.toLowerCase();
}
```

- [ ] **Step 4: Run ids/result tests**

Run: `bun test src/ids.test.ts src/result.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing time tests**

```ts
import { describe, expect, test } from 'bun:test';
import {
  civilDateInZone,
  isValidClockTime,
  isValidTimeZone,
  overlaps,
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
```

- [ ] **Step 6: Run time tests to verify they fail**

Run: `bun test src/time.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 7: Implement time.ts**

- `isValidTimeZone`: `Intl.supportedValuesOf( 'timeZone' )` when present; else try `new Intl.DateTimeFormat( 'en-US', { timeZone: zone } )` and catch.
- `isValidClockTime`: `/^([01]\d|2[0-3]):[0-5]\d$/`.
- `isValidDateOnly`: `/^\d{4}-\d{2}-\d{2}$/` plus `Date.parse( `${ value }T00:00:00Z` )` matching Y-M-D.
- `overlaps( a, b )`: `a.start < b.end && b.start < a.end` (string compare is safe for normalized `Z` instants; still parse if you prefer).
- `toInstant`: `date.toISOString()`.
- `parseInstant`: `Date.parse`; reject `NaN`.
- `civilDateInZone` / `weekdayInZone`: `Intl.DateTimeFormat( 'en-US', { timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' } )` and map Sun..Sat → `SU`..`SA`.
- `zonedInstant`: build via `Temporal` if available; otherwise iterate: take `${ dateOnly }T${ clockTime }:00.000Z`, format back in zone, adjust the UTC millis until the civil date+time match. Return `undefined` if it cannot be represented.
- `nowInstant`: `toInstant( new Date() )`.

- [ ] **Step 8: Run time tests**

Run: `bun test src/time.test.ts`

Expected: PASS.

- [ ] **Step 9: Write fixtures and failing validate tests**

`src/test/fixtures.ts` (test-only helper):

```ts
import type { CalendarSnapshot, Instant } from '../types.ts';

export const NOW: Instant = '2026-08-12T12:00:00.000Z';

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
```

Add `schoolTreeSnapshot()` that builds school → term → course → section → teacher entities, each with a calendar (`inheritance: 'both'` except school `'none'`), linked 1:1, all timestamps `NOW`. Implement this helper fully in this step; later tasks reuse it.

`src/validate.test.ts` cases (all via `validateSnapshot`):

1. `emptySnapshot()` is ok.
2. `schoolTreeSnapshot()` is ok.
3. `id: 'nope'` → `validation`.
4. Two entities with the same id → `validation`.
5. Two `entityCalendars` with the same `entityId` → `integrity`.
6. `parentId` that is not in `entities` → `integrity`.
7. Entity A parent of B parent of A → `integrity`.
8. Event `start === end` → `validation`.
9. Recurrence with both `until` and `count` → `validation`.
10. Empty `entityType` → `validation`.
11. Booking with both `eventId` and `slotId` → `validation`.
12. Booking `eventId` on a different calendar than the booking → `integrity`.
13. Custom `entityType: 'department'` is ok.

- [ ] **Step 10: Run validate tests to verify they fail**

Run: `bun test src/validate.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 11: Implement validateSnapshot**

Walk every collection. On first failure return `err`. Codes:

- `validation`: bad UUID, duplicate id within a collection, empty name/type/title, `start >= end`, bad occupancy, bad recurrence, bad `HH:mm`, unknown time zone, both booking targets, invalid `DateOnly`.
- `integrity`: dangling FK (`parentId`, `calendarId`, `entityId`, `eventId`, `slotId`, `attendeeId`), parent cycle (DFS/colors), 1:1 violation on `entityId` or `calendarId`, booking target calendar mismatch.

Normalize nothing in place (pure). Callers that persist may lowercase ids later; validation accepts either case.

- [ ] **Step 12: Run validate tests and typecheck**

Run: `bun test src/validate.test.ts src/ids.test.ts src/result.test.ts src/time.test.ts` then `bun run typecheck`

Expected: PASS.

Export new public symbols from `src/index.ts`. Update CHANGELOG.

- [ ] **Step 13: Commit**

```bash
git add src/types.ts src/result.ts src/result.test.ts src/ids.ts src/ids.test.ts src/time.ts src/time.test.ts src/validate.ts src/validate.test.ts src/test/fixtures.ts src/index.ts CHANGELOG.md
git commit -m "feat: add snapshot types and validation" -m "Lock the domain types and reject illegal snapshots before any occupancy logic exists."
```

---

### Task 3: Recurrence expansion

**Files:**
- Create: `src/recurrence.ts`
- Create: `src/recurrence.test.ts`
- Modify: `src/types.ts` (ensure `Occurrence` is exported)
- Modify: `src/index.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `CalendarEvent`, `AvailabilityRule`, `TimeRange`, `Occurrence`, `time.ts`, `result.ts`
- Produces:

```ts
expandRecurrence(
  source: CalendarEvent | AvailabilityRule,
  range: TimeRange,
  timeZone: TimeZone,
): Result<Occurrence[]>
```

For events, the zone is `source.timeZone ?? timeZone`. For rules, always `timeZone`. Event occurrence duration is `end - start` of the prototype, applied from each civil start. Rule occurrences use `startTime`/`endTime`; if `endTime <= startTime`, the window ends on the next civil day.

If `range.start >= range.end`, return `err( { code: 'range', message } )`.

- [ ] **Step 1: Write failing recurrence tests**

Use `America/New_York`. Event prototype: start `2026-09-08T13:00:00.000Z` (09:00 EDT), end `2026-09-08T14:00:00.000Z`.

1. Daily, interval 1, range Sep 8–10 → two occurrences (8th, 9th).
2. Weekly, no `byDay`, range 4 weeks → four Tuesdays.
3. Weekly `byDay: ['MO', 'WE']`, interval 1, range that week → Mon and Wed (not Tue prototype weekday unless listed).
4. `count: 2` daily → exactly two even if range is longer.
5. `until` before a later occurrence drops it (`until` compared to occurrence **start**).
6. `excludedDates: ['2026-09-09']` on daily → Sep 9 omitted.
7. Yearly Feb 29 2024 start, range 2024–2027 → 2024 and 2026 only (skip 2025).
8. Weekly 09:00 across 2026-03-08 spring-forward: civil 09:00 stays 09:00 (`civilDateInZone` + `zonedInstant`).
9. Weekly 09:00 across 2026-11-01 fall-back: civil 09:00 stays 09:00.
10. Rule `startTime: '22:00', endTime: '02:00'` on that date → end is next civil day 02:00.
11. Range `start >= end` → `{ ok: false, error.code: 'range' }`.
12. Occurrence that starts before range but ends inside it is included (intersect test).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/recurrence.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement expandRecurrence**

Algorithm:

1. Validate range; resolve zone.
2. Determine DTSTART civil date from event `start` or, for a rule, `range.start` floored to the first civil date that can produce a window intersecting the range (walk back one day to catch overnight).
3. `interval` default 1.
4. Generate candidate civil dates:
   - daily: add `interval` days
   - weekly: if `byDay` omitted, use DTSTART weekday; else those weekdays. Advance week by `interval`.
   - yearly: same month-day; if `zonedInstant` is `undefined` (Feb 29), skip
5. Stop when occurrence start > `until` (if set), or `count` reached, or civil date is after `range.end` plus one day.
6. Drop `excludedDates`.
7. Keep occurrences that intersect the range (`overlaps`).
8. Return `{ ok: true, value: occurrences }` sorted by `start`.

Do not implement a full RFC 5545 library. No new dependencies.

- [ ] **Step 4: Run recurrence tests**

Run: `bun test src/recurrence.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/recurrence.ts src/recurrence.test.ts src/types.ts src/index.ts CHANGELOG.md
git commit -m "feat: expand event and rule recurrence" -m "Generate civil-time occurrences so DST and EXDATE are handled before booking checks."
```

---

### Task 4: Hierarchy

**Files:**
- Create: `src/hierarchy.ts`
- Create: `src/hierarchy.test.ts`
- Modify: `src/index.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `validateSnapshot`, `CalendarSnapshot`, fixtures `schoolTreeSnapshot`
- Produces:

```ts
parentCalendarId(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
): Uuid | undefined

ancestorCalendarIds(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
): Uuid[]

descendantCalendarIds(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
): Uuid[]

requiredCalendarIds(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
): Result<Uuid[]>

rollsUpTo(
  snapshot: CalendarSnapshot,
  descendantCalendarId: Uuid,
  ancestorCalendarId: Uuid,
): boolean

inheritsBlocks(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
): boolean
```

Parent resolution (spec §5.4): calendar → `entity_calendar` → entity `parentId` → walk up entities until one has a calendar (skip entities with no link).

`inheritsBlocks` is true when this calendar’s `inheritance` is `inherit-blocks` or `both`.

`rollsUpTo(D, A)` is true iff every calendar on the path from D up to but not including A has `inheritance` `roll-up` or `both`.

`requiredCalendarIds` validates the snapshot, returns `not_found` if `calendarId` is missing, otherwise the unique set `{ calendarId } ∪ ancestors ∪ descendants`.

- [ ] **Step 1: Write failing hierarchy tests**

Using `schoolTreeSnapshot()` (all `both` except school `none`):

1. `parentCalendarId( teacherCal )` is `sectionCal`.
2. `ancestorCalendarIds( teacherCal )` is `[sectionCal, courseCal, termCal, schoolCal]`.
3. `descendantCalendarIds( schoolCal )` includes teacher through term.
4. `requiredCalendarIds( snapshot, teacherCal )` ok and includes the chain.
5. Unknown calendar → `not_found`.
6. Remove section’s `entity_calendar`; `parentCalendarId( teacherCal )` is `courseCal` (skip).
7. Set teacher `inheritance: 'none'`; `inheritsBlocks( teacherCal )` is false; `rollsUpTo( teacherCal, schoolCal )` is false.
8. Teacher `both`, section `none`: `rollsUpTo( teacherCal, schoolCal )` is false; `rollsUpTo( teacherCal, sectionCal )` is true.
9. Teacher `inherit-blocks` only: `inheritsBlocks` true; `rollsUpTo( teacherCal, sectionCal )` false.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/hierarchy.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement hierarchy.ts**

Index entities, calendars, and links in maps (local, not cached on the snapshot). Walk parents with a visited set. `requiredCalendarIds` calls `validateSnapshot` first.

- [ ] **Step 4: Run hierarchy tests**

Run: `bun test src/hierarchy.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hierarchy.ts src/hierarchy.test.ts src/index.ts CHANGELOG.md
git commit -m "feat: resolve calendar parentage" -m "Derive parent calendars from the entity tree so inheritance can walk a real org chart."
```

---

### Task 5: Occupancy and availability

**Files:**
- Create: `src/occupancy.ts`
- Create: `src/occupancy.test.ts`
- Create: `src/availability.ts`
- Create: `src/availability.test.ts`
- Modify: `src/index.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: recurrence, hierarchy, validate
- Produces:

```ts
ownExclusiveBusy(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
): Result<Occurrence[]>

inheritedBlocks(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
): Result<Occurrence[]>

effectiveExclusiveBusy(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
): Result<Occurrence[]>

openAvailability(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
): Result<Occurrence[]>
```

`ownExclusiveBusy` = expanded events (all occupancies) + slots + ad-hoc bookings (`!eventId && !slotId`) on that calendar.

`inheritedBlocks` = if `inheritsBlocks(C)`, then parent’s events + parent’s ad-hoc + `inheritedBlocks(parent)`. Never parent slots. If no parent calendar, empty.

`effectiveExclusiveBusy` = own ∪ inherited.

`openAvailability` = expanded rules minus `effectiveExclusiveBusy` (which already includes own slots). Merge adjacent/overlapping intervals (`a.end >= b.start` after sort → merge). This is the body of `queryAvailability` without the public wrapper.

- [ ] **Step 1: Write failing occupancy tests**

On a teacher calendar in `America/New_York`, range 2026-09-08 whole UTC day:

1. Exclusive event 13:00–14:00Z appears in `ownExclusiveBusy`.
2. Slot 15:00–16:00Z appears in `ownExclusiveBusy`.
3. Seat booking on that event does **not** appear in `ownExclusiveBusy`.
4. Ad-hoc booking 17:00–17:30Z appears.
5. School event 13:00–14:00Z, teacher `inherit-blocks`: school interval is in `inheritedBlocks(teacher)` and `effectiveExclusiveBusy`.
6. Same school event, teacher `none`: not inherited.
7. School event, term `none`, teacher `inherit-blocks`: not inherited (chain stops).
8. School event, term `inherit-blocks`, teacher `inherit-blocks`: inherited (effective parent busy).
9. Parent slot only: not in `inheritedBlocks(teacher)`.
10. Bad range → `range`.

- [ ] **Step 2: Run occupancy tests to verify they fail**

Run: `bun test src/occupancy.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement occupancy.ts**

Call `validateSnapshot`. Expand events with `expandRecurrence`. Filter bookings with no `eventId`/`slotId`. Recurse inherited blocks only when `inheritsBlocks`.

- [ ] **Step 4: Run occupancy tests**

Run: `bun test src/occupancy.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing availability tests**

Teacher rule: weekly MO–FR 08:00–15:00 America/New_York. Range Tuesday 2026-09-08.

1. No busy → one interval 12:00Z–19:00Z (EDT).
2. Event 13:00–14:00Z punches a hole → two open intervals.
3. Slot 15:00–16:00Z is subtracted (not ad-hoc-open).
4. Inherited school block 13:00–14:00Z punches a hole when teacher inherits.
5. Overnight rule 22:00–02:00 on that local night produces a crossing interval.
6. Adjacent holes that touch merge back if busy is removed (merge helper: `12–13` and `13–14` become `12–14`).

- [ ] **Step 6: Run availability tests to verify they fail**

Run: `bun test src/availability.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 7: Implement availability.ts**

Expand each rule via `expandRecurrence`. Subtract every effective busy interval (split open intervals). Sort and merge.

- [ ] **Step 8: Run occupancy and availability tests**

Run: `bun test src/occupancy.test.ts src/availability.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/occupancy.ts src/occupancy.test.ts src/availability.ts src/availability.test.ts src/index.ts CHANGELOG.md
git commit -m "feat: compute busy time and open hours" -m "Turn events, slots, inheritance, and working-hour rules into interval sets the checker can use."
```

---

### Task 6: Graph writes, checks, and apply

**Files:**
- Create: `src/graph.ts`
- Create: `src/graph.test.ts`
- Create: `src/conflicts.ts`
- Create: `src/conflicts.test.ts`
- Create: `src/apply.ts`
- Create: `src/apply.test.ts`
- Create: `src/snapshot.ts` (clone + stamp helpers used by graph and apply)
- Modify: `src/index.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: validate, occupancy, availability, recurrence, hierarchy
- Produces:

```ts
putEntity( snapshot, input: EntityInput, opts?: ApplyOptions ): Result<ApplySuccess<Entity>>
putCalendar( snapshot, input: CalendarInput, opts?: ApplyOptions ): Result<ApplySuccess<Calendar>>
putEntityCalendar( snapshot, input: EntityCalendarInput, opts?: ApplyOptions ): Result<ApplySuccess<EntityCalendar>>
removeEntity( snapshot, id: Uuid ): Result<CalendarSnapshot>
removeCalendar( snapshot, id: Uuid ): Result<CalendarSnapshot>
removeEntityCalendar( snapshot, id: Uuid ): Result<CalendarSnapshot>

checkEvent( snapshot, input: EventInput ): Result<CheckReport>
checkSlot( snapshot, input: SlotInput ): Result<CheckReport>
checkBooking( snapshot, input: BookingInput ): Result<CheckReport>

applyEvent( snapshot, input: EventInput, opts?: ApplyOptions ): Result<ApplySuccess<CalendarEvent>>
updateEvent( snapshot, input: EventInput, opts?: ApplyOptions ): Result<ApplySuccess<CalendarEvent>>
deleteEvent( snapshot, id: Uuid, opts?: ApplyOptions ): Result<CalendarSnapshot>
excludeOccurrence( snapshot, eventId: Uuid, date: DateOnly, opts?: ApplyOptions ): Result<ApplySuccess<CalendarEvent>>

applyAvailabilityRule( snapshot, input: RuleInput, opts?: ApplyOptions ): Result<ApplySuccess<AvailabilityRule>>
updateAvailabilityRule( snapshot, input: RuleInput, opts?: ApplyOptions ): Result<ApplySuccess<AvailabilityRule>>
deleteAvailabilityRule( snapshot, id: Uuid, opts?: ApplyOptions ): Result<CalendarSnapshot>

applySlot( snapshot, input: SlotInput, opts?: ApplyOptions ): Result<ApplySuccess<BookableSlot>>
updateSlot( snapshot, input: SlotInput, opts?: ApplyOptions ): Result<ApplySuccess<BookableSlot>>
deleteSlot( snapshot, id: Uuid, opts?: ApplyOptions ): Result<CalendarSnapshot>

applyBooking( snapshot, input: BookingInput, opts?: ApplyOptions ): Result<ApplySuccess<Booking>>
updateBooking( snapshot, input: BookingInput, opts?: ApplyOptions ): Result<ApplySuccess<Booking>>
cancelBooking( snapshot, id: Uuid, opts?: ApplyOptions ): Result<CalendarSnapshot>
```

Stamp rules: `createdAt` set on insert if missing; `updatedAt` always `opts.now ?? nowInstant()`. Occupancy defaults to `{ kind: 'exclusive' }`.

`cloneSnapshot` must be a shallow copy of the snapshot object and a new array for the mutated collection so a failed apply can return the **same snapshot reference** (do not clone until a write is accepted).

Check vs apply:

- `check*` → always `ok: true` after validation, even when `conflicts.length > 0`.
- `apply*` → if conflicts and `!opts.allowConflicts`, `err( { code: 'conflict', conflicts } )` and same snapshot reference.
- `allowConflicts` does not bypass `validation` / `not_found` / `integrity`.

Conflict kinds:

- New event/slot vs `effectiveExclusiveBusy` of other records (exclude the record being updated by id) → `exclusive-overlap` or `inherited-block` if the overlapping interval came from `inheritedBlocks`.
- Ad-hoc booking outside `openAvailability` → `outside-availability`.
- Ad-hoc booking overlapping exclusive busy → `exclusive-overlap` / `inherited-block`.
- Seat booking whose interval is not inside one occurrence/slot → `outside-target`.
- Seat booking when seats on that occurrence/slot are full → `capacity-full`. Exclusive target has implicit `max = 1`. Recurring event seats are counted **per occurrence** (bookings that overlap that occurrence and share `eventId`).
- `remainingCapacity` on check: `max - currentSeats` after imagining this booking (floor at 0). Only for seat bookings.

`update*` requires the id to already exist (`not_found` otherwise). `apply*` of an existing id is an upsert only if you document it as such — **do not upsert**. `apply*` of an existing id → `validation` (“already exists”). Use `update*` to change.

`deleteEvent` / `deleteSlot` drop dependent bookings. `removeCalendar` drops link + events + rules + slots + bookings. `removeEntity` fails if children or a link exist.

- [ ] **Step 1: Write failing graph tests**

1. `putEntity` then `putCalendar` then `putEntityCalendar` on `emptySnapshot()` yields a valid snapshot; `createdAt`/`updatedAt` equal `opts.now`.
2. Second `putEntityCalendar` with the same `entityId` → `integrity`.
3. `removeEntity` with a link → `integrity`.
4. `removeEntityCalendar` then `removeCalendar` then `removeEntity` succeeds.
5. `removeCalendar` drops events on that calendar.
6. Cycle via `putEntity` parent pointers → `integrity`.
7. Failed put returns the original snapshot reference: `expect( result.ok === false && result.error )` and compare input `===`.

- [ ] **Step 2: Run graph tests to verify they fail**

Run: `bun test src/graph.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement snapshot.ts and graph.ts**

```ts
/** Shallow-clone snapshot arrays so writes do not mutate the input. */
export function cloneSnapshot(
  snapshot: CalendarSnapshot,
): CalendarSnapshot {
  return {
    entities: snapshot.entities.slice(),
    calendars: snapshot.calendars.slice(),
    entityCalendars: snapshot.entityCalendars.slice(),
    events: snapshot.events.slice(),
    availabilityRules: snapshot.availabilityRules.slice(),
    slots: snapshot.slots.slice(),
    bookings: snapshot.bookings.slice(),
  };
}

export function stamp(
  existing: { createdAt?: Instant } | undefined,
  now: Instant,
): { createdAt: Instant; updatedAt: Instant } {
  return {
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}
```

Graph functions validate the **resulting** snapshot before returning; if invalid, return that error and the original reference.

- [ ] **Step 4: Run graph tests**

Run: `bun test src/graph.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing check/apply tests**

1. `checkEvent` overlapping an existing exclusive event → `ok: true`, one `exclusive-overlap`.
2. `applyEvent` of that input → `ok: false`, `code: 'conflict'`, input snapshot `===`.
3. `applyEvent( ..., { allowConflicts: true, now } )` → new snapshot containing the event; input not mutated.
4. Touching events (11:00–12:00 and 12:00–13:00) apply cleanly.
5. Capacity event still blocks a second event at the same time.
6. Seat bookings: capacity 2, two seats apply, third `capacity-full`; `remainingCapacity` 1 after first check.
7. Seat bookings do not make `checkEvent` for a different time fail extra.
8. Ad-hoc booking inside working hours with no busy → apply ok.
9. Ad-hoc during a slot → `exclusive-overlap` (slot source).
10. Ad-hoc outside rules → `outside-availability`.
11. Slot seat with interval inside slot → ok; interval sticking out → `outside-target`.
12. Inherited school holiday vs teacher event → `inherited-block` when inheritance allows; no conflict when teacher `none`.
13. `excludeOccurrence` adds the date; that day no longer conflicts.
14. `deleteEvent` removes seat bookings on it.
15. `allowConflicts: true` with a bad UUID still `validation`.
16. `updateEvent` missing id → `not_found`.
17. `applyEvent` duplicate id → `validation`.
18. `cancelBooking` removes only that booking.

Cover `checkSlot` overlap with an event. Cover `updateBooking` moving onto a full slot.

- [ ] **Step 6: Run conflict/apply tests to verify they fail**

Run: `bun test src/conflicts.test.ts src/apply.test.ts`

Expected: FAIL.

- [ ] **Step 7: Implement conflicts.ts and apply.ts**

Shared internal `collectEventConflicts` / `collectSlotConflicts` / `collectBookingConflicts`. Apply calls check, then `cloneSnapshot`, splice the collection, return.

When comparing busy for an update, exclude the record with the same id from own busy.

- [ ] **Step 8: Run graph, conflict, and apply tests plus typecheck**

Run: `bun test src/graph.test.ts src/conflicts.test.ts src/apply.test.ts` then `bun run typecheck`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/snapshot.ts src/graph.ts src/graph.test.ts src/conflicts.ts src/conflicts.test.ts src/apply.ts src/apply.test.ts src/index.ts CHANGELOG.md
git commit -m "feat: check and apply calendar writes" -m "Preview conflicts and copy-on-write commits so hosts can persist only accepted snapshots."
```

---

### Task 7: Query availability and view

**Files:**
- Create: `src/query.ts`
- Create: `src/query.test.ts`
- Modify: `src/index.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `openAvailability`, occupancy, recurrence, hierarchy
- Produces:

```ts
queryAvailability(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
): Result<AvailabilityReport>

queryView(
  snapshot: CalendarSnapshot,
  calendarId: Uuid,
  range: TimeRange,
): Result<CalendarView>
```

`queryAvailability` is `openAvailability` plus `{ calendarId }`. `not_found` if calendar missing; `range` if bad range.

`queryView` items intersecting `range`:

- `own`: events (expanded), slots, bookings on this calendar
- `inherited`: ancestor events and ad-hoc bookings that appear in `inheritedBlocks` (tag `type: 'event' | 'booking'`, `source: 'inherited'`)
- `rolled-up`: descendant **events** where `rollsUpTo( descendant, calendarId )`

Event titles flow to `ViewItem.title`. Sort items by `start`, then `id`.

- [ ] **Step 1: Write failing query tests**

1. Teacher with weekday rule and a 13:00–14:00 event: `queryAvailability` has a hole; intervals are UTC.
2. Inherited school block punches teacher availability when inheritance is `both`.
3. `queryView` teacher: own event + own slot + own booking tagged `own`.
4. `queryView` teacher: school holiday tagged `inherited`.
5. `queryView` school: teacher class tagged `rolled-up` when every hop is `roll-up`/`both`.
6. Break one hop to `none`: that class is absent from school view.
7. Seat booking is `own` on the teacher view and does **not** appear as a separate rolled-up item on the school view.
8. Bad range → `range`. Unknown calendar → `not_found`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/query.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement query.ts**

Reuse `openAvailability` and `expandRecurrence`. For inherited view items, walk ancestors while `inheritsBlocks` holds and emit their events and ad-hoc bookings (not slots). For roll-up, scan `descendantCalendarIds` and filter with `rollsUpTo`.

- [ ] **Step 4: Run query tests**

Run: `bun test src/query.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/query.ts src/query.test.ts src/index.ts CHANGELOG.md
git commit -m "feat: query availability and calendar views" -m "Give hosts tagged intervals so they can render a calendar without owning inheritance math."
```

---

### Task 8: Public barrel, docs, and full verification

**Files:**
- Modify: `src/index.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Create: `src/index.test.ts`

**Interfaces:**
- Consumes: every public function from tasks 2–7
- Produces: a single documented export surface and README examples that compile against it

`src/index.ts` must export:

`ok`, `err`, `validateSnapshot`, `requiredCalendarIds`, `expandRecurrence`, `parentCalendarId`, `ancestorCalendarIds`, `descendantCalendarIds`, `rollsUpTo`, `inheritsBlocks`, `ownExclusiveBusy`, `inheritedBlocks`, `effectiveExclusiveBusy`, `putEntity`, `putCalendar`, `putEntityCalendar`, `removeEntity`, `removeCalendar`, `removeEntityCalendar`, `checkEvent`, `checkSlot`, `checkBooking`, `applyEvent`, `updateEvent`, `deleteEvent`, `excludeOccurrence`, `applyAvailabilityRule`, `updateAvailabilityRule`, `deleteAvailabilityRule`, `applySlot`, `updateSlot`, `deleteSlot`, `applyBooking`, `updateBooking`, `cancelBooking`, `queryAvailability`, `queryView`, and all public types.

- [ ] **Step 1: Write a failing README-shaped integration test**

```ts
import { describe, expect, test } from 'bun:test';
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
```

Uses `America/New_York` on Tuesday 2026-09-08. Booking is 09:30–10:00 local.

- [ ] **Step 2: Run the integration test**

Run: `bun test src/index.test.ts`

Expected: FAIL until exports and the scenario are wired. If Task 6–7 already make it pass once the test is filled in, that is acceptable — then this step documents the public path.

- [ ] **Step 3: Finish the barrel and README**

README sections:

- Install (`bun add scheduling-calendar` placeholder + local `bun link` note)
- Snapshot shape (table of collections)
- Inheritance modes
- Check then apply example (copy spec §14, adjusted to use `put*` so it is runnable)
- Query example
- Non-goals
- Development scripts

CHANGELOG: summarize v0 engine under `[Unreleased]`.

- [ ] **Step 4: Run the full suite, typecheck, and lint**

Run: `bun test` then `bun run typecheck` then `bun run lint`

Expected: all PASS. Fix any failures before committing.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/index.test.ts README.md CHANGELOG.md
git commit -m "docs: document public engine API" -m "Export the full surface and show hosts how to load a snapshot, book time, and persist the result."
```

---

## Self-review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| §2–4 architecture, operations list | 2, 4, 6, 7, 8 |
| §5.2 SQL schema | 1 |
| §5.3 entity types | 2 (department allowed) |
| §5.4 parentage + inheritance table | 4, 5 |
| §5.5 occupancy | 5, 6 |
| §5.6 booking kinds | 6 |
| §6 types, time, recurrence | 2, 3 |
| §6.3 exclusive sources | 5 |
| §7.1 Result / errors | 2, 6 |
| §7.2 validateSnapshot | 2 |
| §7.3 check/apply/delete/exclude | 6 |
| §7.4 queries | 5, 7 |
| §7.5 graph writes | 6 |
| §8 error codes | 2, 3, 6, 7 |
| §9 modules | file map |
| §10 package layout / bun / style | 1 |
| §11 required test suites | 3–7 |
| §12 README / CHANGELOG / git | 1, 8 + every commit |
| Non-goals | not implemented |

**Placeholders:** none. Availability “rules ∪ slots” wording in spec §9 is superseded by §7.4 (slots are not ad-hoc-open); this plan follows §7.4.

**Type names** used later match Task 2: `Result`, `ApplyOptions`, `CheckReport`, `ApplySuccess`, `Occurrence`, `TimeRange`, `EventInput`, `BookingInput`, `AvailabilityReport`, `CalendarView`.
