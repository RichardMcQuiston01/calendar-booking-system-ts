# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-10-13

Behavior-tightening release. Several inputs that were silently
accepted (and could double-book, hang, or throw) are now rejected with
a descriptive `Result` error. See **Changed** for what hosts must update.

### Added

- `attendee-conflict` conflict kind. `checkBooking` / `applyBooking` /
  `updateBooking` report other bookings in the snapshot held by the same
  `attendeeId` that overlap the candidate, on the same occurrence or any
  other calendar the host loaded (#24)
- `AvailabilityRule.startDate` (and `start_date` in `sql/schema.sql`):
  the anchor for a rule's `interval` and `count` (#22)
- `MAX_RECURRENCE_INTERVAL` (1000), `MAX_RECURRENCE_COUNT` (10000), and
  `MAX_EXPANDED_DATES` (20000) exported from `recurrence.ts` (#20)
- Reference schema integrity: entity cycle trigger, composite booking
  foreign keys, exclusion constraints for exclusive events/slots/ad-hoc
  bookings, time zone and recurrence checks, `updated_at` triggers, and
  `on delete restrict` for attendees. Requires `btree_gist`. A live
  PostgreSQL test runs when `SCHEMA_TEST_DATABASE_URL` is set (#27)

### Changed

- Instants must be canonical UTC `YYYY-MM-DDTHH:mm:ss.sssZ` strings in
  snapshots, `recurrence.until`, and query ranges. Offsets (`+00:00`),
  missing milliseconds, date-only, and zoneless strings are rejected.
  Serialize `timestamptz` columns accordingly (#18)
- Availability rules with `recurrence.interval > 1` or `recurrence.count`
  require `startDate`; previously their phase followed the query window (#22)
- `recurrence.interval` is limited to 1–1000, `count` to 1–10000, and
  `byDay` may not repeat a weekday (#20, #21)
- Slot capacity counts bookings that overlap the candidate (peak
  concurrency) instead of every booking on the slot, so a capacity-1
  window can hold sequential appointments (#23)
- Records returned from writes are copies, and written records are deep
  copies of the caller's input (#25)
- Event conflict checks scan the real series horizon; an unbounded series
  is scanned through the latest event, slot, or booking in the snapshot
  (minimum one year) (#19)

### Fixed

- Instant comparisons used string order, so equivalent UTC times
  disagreed: valid bookings were rejected as `outside-availability`, busy
  events written with an offset were not subtracted from availability,
  and `until` dropped its last occurrence (#18)
- `expandRecurrence` hung on `interval: 0` and `checkEvent` threw a raw
  `RangeError` on an absurd `count`; both now return a `Result`
  error (#20)
- Duplicate `byDay` values emitted duplicate occurrences and spent
  `count` twice (#21)
- `checkEvent` missed conflicts when `byDay` skipped the prototype day or
  a series ran past a year (#19)
- `excludeOccurrence` and `applyEvent` aliased arrays and objects in the
  caller's snapshot (#25)
- `removeEntity` of an attendee reported `attendeeId does not resolve`
  with the booking id; it now returns `entity is referenced by bookings`
  with the entity id and `bookingId` (#26)
- Yearly Feb 29 series emitted Feb 28 in non-leap years on runtimes with
  `Temporal` (Bun) because `ZonedDateTime.from` constrained the date;
  it now rejects it (#29)

## [0.1.1] - 2026-08-23

### Added

- README "Getting Started" section: real Prerequisites (Node 18+/Bun,
  ESM-only, matched `module`/`moduleResolution` with a minimal
  `tsconfig.json`), copyable Installation commands for
  npm/bun/pnpm/yarn, and a Usage quickstart that puts an entity and
  calendar, declares working hours, and queries open time — verified
  to run against a fresh build before being written down
- CI workflow (`.github/workflows/ci.yml`): typecheck, lint, tests, and
  a build on every pull request and on pushes to `main`, `dev`, and
  `staging`. `publish.yml` only ran on release, so pull requests had no
  automated signal

### Changed

- Donate block now uses the standard wording and sits last in the
  README, after License. The previous copy predated the standard and
  had drifted from the other repositories
- README's Install section no longer says the package is unpublished
  — it has been on npm since `0.1.0`. Spec §12.1 updated to match and
  retitled from "before publication" now that it has happened

### Fixed

- The README's TypeScript examples (Usage and Check then apply) typed
  their `let snapshot = { ...all empty arrays }` initializer implicitly.
  Under `strict`, TypeScript infers `never[]` for each empty array with
  no annotation, so the very next reassignment
  (`snapshot = teacher.value.snapshot`) failed to compile. Both now
  import and annotate with `CalendarSnapshot`. Caught by actually
  running `tsc --strict` against the examples in a scratch ESM
  project, not just executing them with Bun (which strips types
  without checking them)

## [0.1.0] - 2026-08-17

### Added

- v0 scheduling calendar engine: hosts pass an immutable
  `CalendarSnapshot` and receive a `Result` — a report or a new
  snapshot to persist. No UI, HTTP, or database connection.

  Public surface (`src/index.ts`):

  - Domain types, `Result` helpers (`ok` / `err`), and
    `validateSnapshot`
  - `expandRecurrence` (civil-time daily/weekly/yearly, EXDATE,
    DST, overnight windows)
  - Hierarchy (`parentCalendarId`, `ancestorCalendarIds`,
    `descendantCalendarIds`, `requiredCalendarIds`, `rollsUpTo`,
    `inheritsBlocks`)
  - Occupancy and open hours (`ownExclusiveBusy`,
    `inheritedBlocks`, `effectiveExclusiveBusy`,
    `openAvailability`)
  - Graph writes (`put*` / `remove*` for entities, calendars,
    links)
  - Check/apply for events, availability rules, slots, and
    bookings (`allowConflicts` overrides occupancy only)
  - Queries: `queryAvailability` (open ad-hoc intervals) and
    `queryView` (items tagged `own` / `inherited` / `rolled-up`)

- README: install, snapshot shape, check-then-apply and query
  examples, and development scripts
- README-shaped integration test that puts a teacher calendar,
  books open time, and asserts the availability hole
- Reference PostgreSQL schema (`sql/schema.sql`) matching spec
  §5.2
- Design spec
  (`docs/superpowers/specs/2026-08-12-scheduling-calendar-design.md`)
- Implementation plan
  (`docs/superpowers/plans/2026-08-12-scheduling-calendar-engine.md`)
- Bun TypeScript package skeleton (`package.json`, `tsconfig.json`,
  `eslint.config.js`, `.gitignore`)
- README “Buy Me a Coffee” section: Stripe donate link and a
  scannable QR code (`donate.svg`), matching the other
  repositories

- Apache 2.0 license: `LICENSE` (canonical Apache text, copyright
  2026 Richard McQuiston), `"license": "Apache-2.0"` in
  `package.json`, and a matching README section replacing
  “UNLICENSED until a license is chosen”

- `prepublishOnly` script so `npm publish` always builds `dist/`
  first, rather than shipping whatever happens to be on disk
- GitHub Actions publish workflow (`.github/workflows/publish.yml`):
  runs typecheck, lint, and tests, verifies the release tag matches
  `package.json`, then publishes to npm on a published release or
  manual dispatch

- Package published as `@richardmcquiston01/calendar-booking-system`
  with `publishConfig.access` set to `public`, since scoped packages
  default to restricted
- `author` field

### Changed

- README trimmed to consumer-facing install and usage. The
  inheritance-mode tables, roll-up rules, recurrence horizon,
  v1 non-goals, and the `feature/*` → `dev` → `main` branch
  workflow now live only in the design spec, which already
  covered them (§3, §5.4, §12.2)
- Design spec documents the one-year unbounded-series horizon
  (§6.2) that `src/conflicts.ts` implements, and records the
  pre-publication `bun link` workflow (§12.1)
- `.gitignore` covers `.eslintcache` and `*.tgz` pack artifacts

### Fixed

- Recurring `checkEvent` / `applyEvent` inspect the series bound
  (`until`, `count`, or a one-year default horizon) instead of
  only the prototype ±1 day
- Interval overlap and `start < end` compare instants by epoch
  milliseconds, not string order
- `expandRecurrence` returns `validation` for an unknown IANA zone
  instead of throwing
- Rule expansion aligns `interval`/`count` to the range-start civil
  date; overnight lookbehind no longer shifts the series origin
