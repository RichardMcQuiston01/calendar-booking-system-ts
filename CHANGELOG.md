# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

- README: install (`bun add` placeholder and local `bun link`),
  snapshot shape, inheritance modes, check-then-apply and query
  examples, non-goals, and development scripts
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
