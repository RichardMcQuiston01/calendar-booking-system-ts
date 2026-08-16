# Scheduling Calendar Engine — Design Spec

Date: 2026-08-12  
Status: Approved for implementation planning  
Package: `scheduling-calendar`

## 1. Purpose

A framework-agnostic TypeScript library for hierarchical scheduling and booking. Host applications (school SIS, clinics, anything with nested owners) load their records into an immutable snapshot, call pure functions, and persist the returned snapshot themselves.

The library is:

- **Headless** — model, availability, and booking. No UI.
- **A pure engine** — no database connection, no HTTP, no hidden process state.
- **Runtime-portable** — ESM TypeScript for Node and browsers.

A typical host: a School has a calendar, a Term/Section/Course/Teacher/Student may each have a calendar, and a child calendar can inherit busy time from ancestors and/or roll its events up to parents.

## 2. Goals

- Represent entities, calendars, events, availability rules, bookable slots, and bookings as a single snapshot.
- Resolve calendar parentage from the entity tree (`entity.parent_id` → that parent’s linked calendar).
- Compute availability and conflicts with configurable inheritance per calendar.
- Support exclusive occupancy by default and optional capacity (seats) on events and slots.
- Support a practical recurrence subset on events and availability rules. Bookings are single occurrences.
- Preview conflicts (`check*`) then commit (`apply*`), with an explicit `allowConflicts` override.
- Ship a reference SQL schema that matches the TypeScript model (snake_case tables, camelCase models).

## 3. Non-goals (v1)

- Any UI toolkit or CSS.
- A live database adapter, Prisma client, or repository implementation.
- HTTP/API layer.
- Multi-resource booking (teacher + room in one transaction).
- Recurring bookings.
- “This and future” series edits.
- Auth, permissions, notifications, payments.
- Generated ids. The host supplies UUIDs.

## 4. Architecture

The host maps persisted rows into a `CalendarSnapshot` and passes that snapshot into every call. Functions never mutate the input. Writes return a new snapshot. Reads return reports.

```
Host entities / DB                  scheduling-calendar
------------------                  -------------------
entity, calendar,                   CalendarSnapshot
entity_calendar,                    checkEvent / checkSlot / checkBooking
calendar_event,                     applyEvent / applySlot / applyBooking / …
availability_rule,                  queryAvailability / queryView
bookable_slot, booking              expandRecurrence
        |                           validateSnapshot
        |                           requiredCalendarIds
        v
CalendarSnapshot  -------------->   Result<T>
                              <---- new snapshot or report
host persists diff
```

There is no session object and no implicit cache. If the snapshot omits an ancestor or descendant, inheritance for that missing node does not run. The engine does not fetch.

### 4.1 Operations

| Kind | Functions |
| --- | --- |
| Graph (integrity only) | `putEntity`, `removeEntity`, `putCalendar`, `removeCalendar`, `putEntityCalendar`, `removeEntityCalendar` |
| Preview | `checkEvent`, `checkSlot`, `checkBooking` |
| Commit | `applyEvent`, `updateEvent`, `deleteEvent`, `excludeOccurrence`, `applyAvailabilityRule`, `updateAvailabilityRule`, `deleteAvailabilityRule`, `applySlot`, `updateSlot`, `deleteSlot`, `applyBooking`, `updateBooking`, `cancelBooking` |
| Query | `queryAvailability`, `queryView`, `expandRecurrence` |
| Helpers | `validateSnapshot`, `requiredCalendarIds` |

`apply*` and occupancy-sensitive updates run the same checks as `check*`. They refuse on `conflict` unless `allowConflicts: true`. `allowConflicts` never bypasses `validation`, `not_found`, or `integrity`.

### 4.2 What the host must load

For any operation on calendar C, the snapshot should include:

- C and its `entity_calendar` + entity.
- Every ancestor entity via `parent_id`, and each ancestor’s calendar if it has one.
- The full descendant entity subtree, and each descendant’s calendar if it has one.
- Events, rules, slots, and bookings for all of those calendars.

`requiredCalendarIds(snapshot, calendarId)` returns the calendar ids implied by the entities **already in the snapshot**. It cannot name entities the host never loaded.

An entity with no `entity_calendar` row is skipped (students need not have calendars).

## 5. Domain model

### 5.1 Naming

| Layer | Convention |
| --- | --- |
| SQL tables and columns | singular `snake_case` |
| TypeScript models | singular PascalCase |
| TypeScript fields | camelCase (`createdAt`) |
| Primary keys | UUID strings (v4 or v7) |
| Every table | `id`, `created_at`, `updated_at` |

The engine rejects ids that are not canonical UUID strings (8-4-4-4-12 hex, any version nibble, any variant). Comparison is case-insensitive; snapshots normalize ids to lowercase.

### 5.2 Tables (reference PostgreSQL)

```sql
create table entity (
  id          uuid primary key,
  entity_type text not null,
  name        text not null,
  parent_id   uuid references entity (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table calendar (
  id           uuid primary key,
  time_zone    text not null,
  inheritance  text not null default 'none',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint calendar_inheritance_chk
    check (inheritance in ('none', 'inherit-blocks', 'roll-up', 'both'))
);

create table entity_calendar (
  id           uuid primary key,
  entity_id    uuid not null unique references entity (id),
  calendar_id  uuid not null unique references calendar (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table calendar_event (
  id              uuid primary key,
  calendar_id     uuid not null references calendar (id) on delete cascade,
  title           text not null,
  start_at        timestamptz not null,
  end_at          timestamptz not null,
  time_zone       text,
  occupancy_kind  text not null default 'exclusive',
  capacity_max    integer,
  recurrence      jsonb,
  excluded_dates  date[],
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint calendar_event_range_chk check (start_at < end_at),
  constraint calendar_event_occupancy_chk
    check (
      (occupancy_kind = 'exclusive' and capacity_max is null)
      or (occupancy_kind = 'capacity' and capacity_max >= 1)
    )
);

create table availability_rule (
  id              uuid primary key,
  calendar_id     uuid not null references calendar (id) on delete cascade,
  start_time      time not null,
  end_time        time not null,
  recurrence      jsonb not null,
  excluded_dates  date[],
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table bookable_slot (
  id              uuid primary key,
  calendar_id     uuid not null references calendar (id) on delete cascade,
  start_at        timestamptz not null,
  end_at          timestamptz not null,
  occupancy_kind  text not null default 'exclusive',
  capacity_max    integer,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint bookable_slot_range_chk check (start_at < end_at),
  constraint bookable_slot_occupancy_chk
    check (
      (occupancy_kind = 'exclusive' and capacity_max is null)
      or (occupancy_kind = 'capacity' and capacity_max >= 1)
    )
);

create table booking (
  id           uuid primary key,
  calendar_id  uuid not null references calendar (id) on delete cascade,
  start_at     timestamptz not null,
  end_at       timestamptz not null,
  event_id     uuid references calendar_event (id) on delete cascade,
  slot_id      uuid references bookable_slot (id) on delete cascade,
  attendee_id  uuid references entity (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint booking_range_chk check (start_at < end_at),
  constraint booking_target_chk check (
    not (event_id is not null and slot_id is not null)
  )
);

create index entity_parent_id_idx on entity (parent_id);
create index entity_entity_type_idx on entity (entity_type);
create index calendar_event_calendar_id_idx on calendar_event (calendar_id);
create index availability_rule_calendar_id_idx on availability_rule (calendar_id);
create index bookable_slot_calendar_id_idx on bookable_slot (calendar_id);
create index booking_calendar_id_idx on booking (calendar_id);
create index booking_event_id_idx on booking (event_id);
create index booking_slot_id_idx on booking (slot_id);
```

Recommended extra integrity (host DB, also enforced by the engine):

- No cycles in `entity.parent_id`.
- `booking.event_id` / `booking.slot_id`, when set, must belong to `booking.calendar_id`.
- Deleting an entity that still has children or an `entity_calendar` row is an integrity error unless the host deletes dependents first. The engine `removeEntity` follows the same rule (no implicit cascade of the org tree).
- Deleting a calendar via `removeCalendar` also removes its `entity_calendar` link and all events, rules, slots, and bookings on that calendar.

The package ships this schema as `sql/schema.sql`. The engine never executes SQL.

### 5.3 Entity types

`entity.entity_type` is a non-empty string. Known values used in docs and tests:

`school`, `term`, `section`, `course`, `teacher`, `student`

Any other non-empty string is valid (for example `department`). The engine does not maintain an enum allow-list.

### 5.4 Calendar parentage

A calendar has **no** `parent_id`. Parentage is derived:

1. Find `entity_calendar` for the calendar.
2. Load that entity’s `parent_id`.
3. Find `entity_calendar` for the parent entity, if any.
4. That calendar is the parent calendar.

If the parent entity has no calendar, the hop is skipped for occupancy (there is no parent calendar). Walking further ancestors continues from that parent entity.

`calendar.inheritance` describes how **this** calendar treats its resolved parent:

| Mode | Downward (query/check this calendar) | Upward (query/check an ancestor) |
| --- | --- | --- |
| `none` | Ignore parent busy | This calendar’s events do not appear on the parent |
| `inherit-blocks` | Parent **effective** exclusive busy is busy here | No roll-up |
| `roll-up` | Ignore parent busy | This calendar’s events occupy the parent |
| `both` | Both | Both |

**Effective exclusive busy** on a calendar is:

- Its own exclusive occupancy (see §6.3), plus
- If its `inheritance` is `inherit-blocks` or `both`, the effective exclusive busy of its resolved parent calendar (transitive along a chain of inherit-blocks/both). A mid-node with `none` or `roll-up` stops the downward chain.

**Roll-up** of descendant D onto ancestor A includes D’s events if and only if every calendar on the path from D up to (but not including) A has `inheritance` of `roll-up` or `both`.

Seat bookings never inherit or roll up on their own. The event they belong to already occupies the owner.

Parent **slots** never become inherited blocks. Only ancestor **events** and **ad-hoc bookings** (no `eventId`, no `slotId`) contribute to inherited exclusive busy.

### 5.5 Occupancy

```
Occupancy =
  | { kind: 'exclusive' }
  | { kind: 'capacity', max: number }  // max >= 1
```

- Default for events and slots is `exclusive`.
- A capacity event or slot **still blocks its owner** for other events, slots, and ad-hoc bookings (the teacher is teaching).
- Seat bookings consume one unit each toward `max`. They do not create additional owner-busy intervals.
- Exclusive is treated as capacity `max = 1` for seat bookings that target that event/slot. An exclusive event is not normally targeted by seat bookings; if a host does so, the first seat fills it.

### 5.6 Bookings

A booking is always a single `[start, end)` interval. Exactly one of:

1. **Event seat** — `eventId` set. Interval must lie inside one expanded occurrence of that event. Event must be on the same calendar. Consumes one seat on that occurrence (occurrences of a recurring event have independent counts).
2. **Slot seat** — `slotId` set. Interval must lie inside the slot. Slot must be on the same calendar. Consumes one seat on that slot.
3. **Ad-hoc** — neither set. Interval must lie inside `queryAvailability` for that calendar (working-hours rules minus events, slots, other ad-hoc bookings, and inherited blocks). The booking itself is exclusive busy on the calendar and participates in inherit-blocks. Slots are booked only with `slotId`, never as ad-hoc.

`attendeeId` is an optional `entity.id`. The engine does not require the attendee to have a calendar.

## 6. TypeScript types

All public types live in `src/types.ts` and are re-exported from `src/index.ts`. Fields below are required unless marked optional.

```ts
type Uuid = string;
type Instant = string;      // ISO-8601 instant, normalized to UTC with `Z`
type DateOnly = string;     // YYYY-MM-DD
type ClockTime = string;    // HH:mm 24-hour
type TimeZone = string;     // IANA, e.g. America/New_York

type InheritanceMode = 'none' | 'inherit-blocks' | 'roll-up' | 'both';
type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';
type Freq = 'daily' | 'weekly' | 'yearly';

interface OccupancyExclusive {
  kind: 'exclusive';
}

interface OccupancyCapacity {
  kind: 'capacity';
  max: number;
}

type Occupancy = OccupancyExclusive | OccupancyCapacity;

interface RecurrenceRule {
  freq: Freq;
  interval?: number;     // default 1, must be >= 1
  byDay?: Weekday[];
  until?: Instant;       // inclusive last instant allowed for occurrence start
  count?: number;        // >= 1; mutually exclusive with until
}

interface Entity {
  id: Uuid;
  entityType: string;
  name: string;
  parentId?: Uuid;
  createdAt: Instant;
  updatedAt: Instant;
}

interface Calendar {
  id: Uuid;
  timeZone: TimeZone;
  inheritance: InheritanceMode;
  createdAt: Instant;
  updatedAt: Instant;
}

interface EntityCalendar {
  id: Uuid;
  entityId: Uuid;
  calendarId: Uuid;
  createdAt: Instant;
  updatedAt: Instant;
}

interface CalendarEvent {
  id: Uuid;
  calendarId: Uuid;
  title: string;
  start: Instant;
  end: Instant;
  timeZone?: TimeZone;
  occupancy: Occupancy;
  recurrence?: RecurrenceRule;
  excludedDates?: DateOnly[];
  createdAt: Instant;
  updatedAt: Instant;
}

interface AvailabilityRule {
  id: Uuid;
  calendarId: Uuid;
  startTime: ClockTime;
  endTime: ClockTime;
  recurrence: RecurrenceRule;
  excludedDates?: DateOnly[];
  createdAt: Instant;
  updatedAt: Instant;
}

interface BookableSlot {
  id: Uuid;
  calendarId: Uuid;
  start: Instant;
  end: Instant;
  occupancy: Occupancy;
  createdAt: Instant;
  updatedAt: Instant;
}

interface Booking {
  id: Uuid;
  calendarId: Uuid;
  start: Instant;
  end: Instant;
  eventId?: Uuid;
  slotId?: Uuid;
  attendeeId?: Uuid;
  createdAt: Instant;
  updatedAt: Instant;
}

interface CalendarSnapshot {
  entities: Entity[];
  calendars: Calendar[];
  entityCalendars: EntityCalendar[];
  events: CalendarEvent[];
  availabilityRules: AvailabilityRule[];
  slots: BookableSlot[];
  bookings: Booking[];
}
```

SQL `start_at` / `end_at` map to TypeScript `start` / `end`.

### 6.1 Time

- Stored and compared as UTC instants.
- Working hours and recurrence are evaluated in the calendar `timeZone`, or the event `timeZone` when set.
- Unknown IANA names are `validation` errors. Validation uses `Intl.supportedValuesOf('timeZone')` when available; otherwise a best-effort `Intl.DateTimeFormat` probe.
- Intervals are half-open `[start, end)`. Touching endpoints do not conflict (`10:00–11:00` and `11:00–12:00` is allowed).
- Query ranges are also `[start, end)`.
- Overnight availability: if `endTime <= startTime`, the window crosses midnight into the next civil day.

### 6.2 Recurrence

Applies to `CalendarEvent` and `AvailabilityRule` only.

- `daily` — every `interval` days from the DTSTART civil date in the rule zone.
- `weekly` — every `interval` weeks. If `byDay` is omitted, the weekday of DTSTART in that zone is used.
- `yearly` — every `interval` years on the same month-day as DTSTART. Invalid civil dates (29 February in a non-leap year) are **skipped**, not clamped.
- `byDay`, when present, keeps only occurrences whose civil weekday is listed. Valid for all three freqs.
- `until` and `count` must not both be set. If neither is set, expansion is bounded by the **query range** only (the host must always pass a range).
- Conflict checking must bound the series itself, since no query range is supplied. `checkEvent` / `applyEvent` scan through `until` (plus one local day), or far enough to cover `count` (plus one local day). When neither bound is set they use a **one-year horizon from the prototype start**. Hosts that need a longer unbounded series set `until` or `count`.
- `excludedDates` (`EXDATE`) are civil dates in the event/rule zone. Any occurrence whose local date is listed is dropped.
- DST: occurrences keep civil clock time. A 09:00 weekly class stays 09:00 local on both sides of a DST transition; the UTC instant changes.
- Event duration is `end - start` of the prototype, applied to each occurrence start in the event zone.

`expandRecurrence(source, range)` returns occurrence `{ start, end }` pairs that intersect `[range.start, range.end)`.

### 6.3 Exclusive occupancy sources

On calendar C, own exclusive occupancy (used when checking a new event, slot, or ad-hoc booking, and when building inherited blocks) is the union of:

- Every expanded event occurrence on C (exclusive **and** capacity — both block the owner).
- Every bookable slot on C (a slot reserves the owner’s time for slot bookings).
- Every **ad-hoc** booking on C.

Not included: seat bookings (`eventId` or `slotId` set).

`queryAvailability` subtracts that same set **except it also subtracts slots** (slots are not ad-hoc-open time). See §7.4.

## 7. Data flow

### 7.1 Result type

Expected domain failures do not throw.

```ts
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: EngineError };

interface EngineError {
  code: 'validation' | 'not_found' | 'integrity' | 'conflict' | 'range';
  message: string;
  conflicts?: Conflict[];
  details?: Record<string, unknown>;
}

interface Conflict {
  kind:
    | 'exclusive-overlap'
    | 'inherited-block'
    | 'capacity-full'
    | 'outside-availability'
    | 'outside-target';
  calendarId: Uuid;
  start: Instant;
  end: Instant;
  source:
    | { type: 'event'; id: Uuid }
    | { type: 'slot'; id: Uuid }
    | { type: 'booking'; id: Uuid }
    | { type: 'availability' };
}

interface ApplyOptions {
  allowConflicts?: boolean; // default false
  now?: Instant;            // default current time as UTC instant
}
```

Programming errors (passing a non-object where a snapshot is required) may throw `TypeError`. Domain problems use `Result`.

### 7.2 Validate

`validateSnapshot(snapshot)` runs at the start of every public function (including itself, once). Checks:

- Every `id` is a UUID and unique within its collection.
- `entity_calendar` is unique on `entityId` and unique on `calendarId`.
- All foreign keys resolve (`parentId`, `calendarId`, `entityId`, `eventId`, `slotId`, `attendeeId`).
- No cycle in `entity.parentId`.
- `start < end` on events, slots, bookings.
- Occupancy shape (`capacity.max >= 1`; exclusive has no max).
- Recurrence: `interval >= 1`; not both `until` and `count`; `count >= 1` when set; `byDay` values are valid.
- `entityType` and `name` are non-empty; `title` is non-empty.
- Time zones are valid IANA names.
- A booking does not set both `eventId` and `slotId`.
- Booking targets belong to the same calendar.

Failure code is `validation` or `integrity` as appropriate (`integrity` for cycles, 1:1 violations, and dangling references).

### 7.3 Check then apply

1. Validate snapshot and command.
2. Resolve calendar, entity, parent chain, descendant set.
3. Expand recurrences in a range that covers the command interval (and one extra local day on each side for overnight rules).
4. Build exclusive busy (own + inherited).
5. For ad-hoc bookings, build open availability.
6. Collect `conflicts[]`.
7. `check*` returns `{ ok: true, value: { conflicts, remainingCapacity? } }` even when conflicts exist — “ok” means the check ran. Hosts inspect `conflicts.length`.
8. `apply*` with conflicts and `allowConflicts !== true` returns `{ ok: false, error: { code: 'conflict', conflicts } }` and the **same snapshot reference**.
9. On success, `apply*` structurally clones the snapshot, inserts/replaces/removes the record, sets `createdAt` (insert only, if missing) and `updatedAt` to `opts.now`, and returns `{ snapshot, record }`.

`update*` replaces the record with the same `id`. Recurring events are updated as the **entire series**. `excludeOccurrence(snapshot, eventId, date, opts)` appends a `DateOnly` to `excludedDates`. There is no “this and future” split in v1.

`deleteEvent` / `deleteSlot` also drop bookings that reference them. `deleteAvailabilityRule` does not affect bookings. `cancelBooking` removes that booking only.

### 7.4 Queries

`queryAvailability(snapshot, calendarId, range)` — intervals where an **ad-hoc** booking may be placed:

- Expand availability rules in `range` in the calendar zone (overnight windows included).
- Subtract own events, own slots, own ad-hoc bookings, and inherited exclusive busy.
- Do not add slots to this set. Slots are booked only via `slotId` and appear on `queryView`.
- Merge adjacent or overlapping open intervals.
- Return `{ calendarId, intervals: { start, end }[] }` in UTC.

`queryView(snapshot, calendarId, range)` returns items that intersect `range`, each tagged:

| `source` | What |
| --- | --- |
| `own` | Events, slots, and bookings on this calendar |
| `inherited` | Ancestor events and ad-hoc bookings that contribute to effective inherited busy |
| `rolled-up` | Descendant **events** that satisfy the roll-up path rule |

```ts
interface ViewItem {
  source: 'own' | 'inherited' | 'rolled-up';
  type: 'event' | 'slot' | 'booking';
  id: Uuid;
  calendarId: Uuid;
  title?: string;
  start: Instant;
  end: Instant;
  occupancy?: Occupancy;
}

interface CalendarView {
  calendarId: Uuid;
  range: { start: Instant; end: Instant };
  items: ViewItem[];
}
```

### 7.5 Graph writes

`putEntity` / `putCalendar` / `putEntityCalendar` upsert by `id` (integrity only). They accept `ApplyOptions.now` and stamp `createdAt` on insert (if missing) and `updatedAt` on every successful put.  
`removeEntity` fails with `integrity` if children or an `entity_calendar` still exist.  
`removeCalendar` removes the calendar, its link row, and all events/rules/slots/bookings on it.  
`removeEntityCalendar` unlinks; the calendar and entity rows remain.

These functions still return `Result` and never mutate the input.

Command inputs for `apply*` / `put*` omit `createdAt` and `updatedAt`. `occupancy` may be omitted and defaults to `{ kind: 'exclusive' }`. Stored snapshot records always include those fields.

## 8. Error handling

| Code | When |
| --- | --- |
| `validation` | Bad UUID, empty name/title/type, `start >= end`, unknown time zone, `until` and `count` together, both booking targets, `capacity.max < 1`, bad `HH:mm` |
| `not_found` | Unknown calendar, entity, event, slot, booking, or rule id in a command |
| `integrity` | Parent cycle, dangling FK, 1:1 link violation, booking target on another calendar, remove entity with dependents |
| `conflict` | Exclusive overlap, inherited block, capacity full, ad-hoc outside availability, seat outside its event occurrence or slot |
| `range` | Query/expand range missing or `start >= end` |

`check*` does not use `conflict` as a failure code; it reports conflicts in the value. `apply*` uses `conflict` as a failure code.

## 9. Modules

Each file has one job. Tests sit beside the source (`foo.ts` + `foo.test.ts`).

| File | Responsibility |
| --- | --- |
| `src/types.ts` | Public types only |
| `src/result.ts` | `ok` / `err` helpers |
| `src/ids.ts` | UUID normalize/validate |
| `src/time.ts` | Instant parse, zone probe, half-open overlap, civil date in zone |
| `src/validate.ts` | Snapshot and command validation |
| `src/recurrence.ts` | RRULE subset expansion, EXDATE, DST civil time |
| `src/hierarchy.ts` | Entity tree, resolved parent calendar, ancestor/descendant sets, `requiredCalendarIds`, inheritance path rules |
| `src/occupancy.ts` | Exclusive busy intervals after inheritance |
| `src/availability.ts` | Open intervals = rules ∪ slots − busy |
| `src/conflicts.ts` | `checkEvent`, `checkSlot`, `checkBooking` |
| `src/apply.ts` | Copy-on-write apply/update/delete/exclude/cancel |
| `src/graph.ts` | put/remove entity, calendar, link |
| `src/query.ts` | `queryAvailability`, `queryView` |
| `src/index.ts` | Public barrel |

## 10. Package layout

```
scheduling-calendar/
  package.json          bun scripts: typecheck, test, lint
  tsconfig.json
  README.md
  CHANGELOG.md
  sql/schema.sql
  src/                  modules + colocated tests
  docs/superpowers/specs/2026-08-12-scheduling-calendar-design.md
```

- Package name: `scheduling-calendar`.
- `"type": "module"`.
- TypeScript `strict`.
- Toolchain is **bun** (`bun run typecheck`, `bun run test`, `bun run lint`). Do not use npm unless the user says so.
- JSDoc on every exported function, type, and interface.
- 2-space indent, LF, trailing commas, ~80 column soft margin.
- Spaces inside import braces and object literal braces.

## 11. Testing

Tests are required, not optional. Colocate `*.test.ts`. Every public function has at least one test.

Required suites:

1. **Recurrence** — daily, weekly, yearly; `interval`; `byDay` present and omitted; `until` vs `count`; `EXDATE`; yearly 29 Feb skipped on non-leap years; DST spring-forward and fall-back keep civil time.
2. **Hierarchy** — all four inheritance modes; missing parent calendar skipped; school → term → course → section → teacher chain; cycle rejected; roll-up only when every hop allows it; inherit-blocks uses parent **effective** busy.
3. **Occupancy** — exclusive overlap; touching intervals allowed; capacity fill and remaining; ad-hoc vs slot vs event booking; capacity event still blocks owner; seat bookings do not double-count as busy.
4. **Apply** — `check` reports conflicts without failing; `apply` refuses; `allowConflicts` commits; failed apply returns the same snapshot reference; `now` stamps `updatedAt`.
5. **Validate** — UUID; 1:1 `entity_calendar`; dangling FK; `until`+`count`; empty `entityType`/`name`; both booking targets.
6. **Query** — `queryAvailability` subtracts inherited blocks; `queryView` tags `own` | `inherited` | `rolled-up`.
7. **Errors** — one case per `EngineError.code`; `allowConflicts` still fails on `validation` and `integrity`.

Use fixed `now` and fixed instants in tests. Do not depend on the machine clock except when testing the default `now` path.

## 12. Documentation and git

- **README.md** is updated in the same change as user-facing API or behavior. It carries install and usage for consumers of the published package; project process, design rationale, and pre-publication workflow live in this spec.
- **CHANGELOG.md** follows Keep a Changelog. Every commit that changes the project updates `[Unreleased]`. Use Conventional Commits: `feat`, `fix`, `docs`, `test`, `chore`. Subject ≤ 50 characters; body explains why.
- **`.gitignore`** covers `node_modules/`, `dist/`, coverage, `.env` / `.env.*` (keep `.env.example` if added), logs, OS and editor junk, bun cache. Never commit `.env` or secrets.

### 12.1 Local consumption before publication

The package is not published to a registry yet. Until it is, hosts consume it from this repository with `bun link`:

```bash
# in this repository
bun link

# in the host application
bun link scheduling-calendar
```

A local path or git URL in the host `package.json` works as well. Once the package is published, `bun add scheduling-calendar` (as shown in the README) is the only step a host needs.

### 12.2 Branch model

| Branch | Role |
| --- | --- |
| `main` | Production |
| `dev` | Integration |
| `release` | Release candidate |
| `staging` | Staging |
| `hotfix/*` | Fixes |
| `feature/*` | Work |

Implementation stages run on `feature/*` branches created from `dev`. When a stage is complete and tested, merge that branch into `dev`. Merge `dev` into `main` only when the v1 library is complete and tested.

This spec is committed on `feature/scheduling-calendar-design` from `dev`.

## 13. Implementation stages (for later planning)

These are not work items yet. They exist so the implementation plan can map 1:1 to reviewable merges.

1. Repo skeleton: bun package, tsconfig, lint, `.gitignore`, README, CHANGELOG, `sql/schema.sql`.
2. Types, result, ids, time, `validateSnapshot`.
3. Recurrence expansion.
4. Hierarchy and `requiredCalendarIds`.
5. Occupancy and availability.
6. `check*` / `apply*` / graph writes.
7. `queryAvailability` / `queryView`.
8. Public barrel, README examples, changelog for the release.

## 14. Example (illustrative)

```ts
import {
  applyBooking,
  queryAvailability,
  type CalendarSnapshot,
} from 'scheduling-calendar';

const snapshot: CalendarSnapshot = { /* rows loaded by the host */ };

const availability = queryAvailability(snapshot, teacherCalendarId, {
  start: '2026-09-08T12:00:00.000Z',
  end: '2026-09-08T21:00:00.000Z',
});

const booked = applyBooking(snapshot, {
  id: bookingId,
  calendarId: teacherCalendarId,
  start: '2026-09-08T19:00:00.000Z',
  end: '2026-09-08T19:30:00.000Z',
  attendeeId: studentId,
});

if (booked.ok) {
  // persist booked.value.snapshot
}
```

School holiday as an event on the school calendar blocks the teacher when the teacher (and each hop above) uses `inherit-blocks` or `both`. The teacher’s class event appears on the school `queryView` when each hop uses `roll-up` or `both`.
