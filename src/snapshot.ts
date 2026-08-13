import type { CalendarSnapshot, Instant } from './types.js';

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
