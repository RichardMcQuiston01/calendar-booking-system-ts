# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `expandRecurrence` for event and availability-rule occurrences
  (civil-time daily/weekly/yearly, EXDATE, DST, overnight windows)
- Domain types, `Result` helpers (`ok` / `err`), UUID/time utilities,
  and `validateSnapshot` for snapshot shape and integrity checks

- Design spec for the headless scheduling calendar engine
  (`docs/superpowers/specs/2026-08-12-scheduling-calendar-design.md`)
- Implementation plan for the engine
  (`docs/superpowers/plans/2026-08-12-scheduling-calendar-engine.md`)
- Project README describing purpose, non-goals, and planned API
- `.gitignore` for a bun TypeScript library
- Bun TypeScript package skeleton (`package.json`, `tsconfig.json`,
  `eslint.config.js`, empty public entry `src/index.ts`)
- Reference PostgreSQL schema (`sql/schema.sql`) with singular snake_case
  tables from the design spec §5.2
