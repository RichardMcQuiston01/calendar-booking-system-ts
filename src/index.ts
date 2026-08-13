/**
 * Public entry for the scheduling calendar engine.
 */

export { err, ok } from './result.js';
export { expandRecurrence } from './recurrence.js';
export { validateSnapshot } from './validate.js';
export {
  ancestorCalendarIds,
  descendantCalendarIds,
  inheritsBlocks,
  parentCalendarId,
  requiredCalendarIds,
  rollsUpTo,
} from './hierarchy.js';
export {
  effectiveExclusiveBusy,
  inheritedBlocks,
  ownExclusiveBusy,
} from './occupancy.js';
export { openAvailability } from './availability.js';

export type {
  ApplyOptions,
  ApplySuccess,
  AvailabilityReport,
  AvailabilityRule,
  BookableSlot,
  Booking,
  BookingInput,
  Calendar,
  CalendarEvent,
  CalendarInput,
  CalendarSnapshot,
  CalendarView,
  CheckReport,
  ClockTime,
  Conflict,
  DateOnly,
  EngineError,
  Entity,
  EntityCalendar,
  EntityCalendarInput,
  EntityInput,
  EventInput,
  Freq,
  InheritanceMode,
  Instant,
  Occupancy,
  OccupancyCapacity,
  OccupancyExclusive,
  Occurrence,
  RecurrenceRule,
  Result,
  RuleInput,
  SlotInput,
  TimeRange,
  TimeZone,
  Uuid,
  ViewItem,
  Weekday,
} from './types.js';
