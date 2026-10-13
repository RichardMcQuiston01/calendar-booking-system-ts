import type { CalendarSnapshot, Instant } from './types.js';

/**
 * Shallow-clone snapshot arrays so writes do not mutate the input.
 * Rows a write does not touch stay shared and must be treated as
 * read-only; written rows are always fresh copies (`copyRecord`).
 */
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

/**
 * Deep-copy a record so nested values (`recurrence`, `byDay`,
 * `excludedDates`, `occupancy`) are never shared between a caller's
 * object and the snapshot.
 */
export function copyRecord<T extends object>( record: T ): T {
  return structuredClone( record );
}

/**
 * Stamp `createdAt` from the existing row (or `now` on insert) and
 * always set `updatedAt` to `now`.
 */
export function stamp(
  existing: { createdAt?: Instant } | undefined,
  now: Instant,
): { createdAt: Instant; updatedAt: Instant } {
  return {
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}
