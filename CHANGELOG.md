# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Donate block now uses the standard wording and sits last in the
  README, after License. The previous copy predated the standard and
  had drifted from the other repositories

### Added

- CI workflow (`.github/workflows/ci.yml`): typecheck, lint, tests, and
  a build on every pull request and on pushes to `main`, `dev`, and
  `staging`. `publish.yml` only ran on release, so pull requests had no
  automated signal

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
