/** Canonical 8-4-4-4-12 hex UUID string. */
export type Uuid = string;

/** ISO-8601 instant, normalized to UTC with a `Z` suffix. */
export type Instant = string;

/** Civil date in `YYYY-MM-DD` form. */
export type DateOnly = string;

/** Clock time in 24-hour `HH:mm` form. */
export type ClockTime = string;

/** IANA time zone name, for example `America/New_York`. */
export type TimeZone = string;

/** How a calendar treats its resolved parent calendar. */
export type InheritanceMode =
  | 'none'
  | 'inherit-blocks'
  | 'roll-up'
  | 'both';

/** ISO weekday used by recurrence `byDay`. */
export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

/** Recurrence frequency subset supported by the engine. */
export type Freq = 'daily' | 'weekly' | 'yearly';

/** Exclusive occupancy: the owner is fully busy. */
export interface OccupancyExclusive {
  kind: 'exclusive';
}

/** Capacity occupancy: `max` seats, `max >= 1`. */
export interface OccupancyCapacity {
  kind: 'capacity';
  max: number;
}

/** Occupancy of an event or bookable slot. */
export type Occupancy = OccupancyExclusive | OccupancyCapacity;

/** Recurrence rule for events and availability windows. */
export interface RecurrenceRule {
  freq: Freq;
  /** Repeat every N periods. Default 1; must be `>= 1`. */
  interval?: number;
  /** Keep only occurrences whose civil weekday is listed. */
  byDay?: Weekday[];
  /** Inclusive last instant allowed for an occurrence start. */
  until?: Instant;
  /** Occurrence cap `>= 1`; mutually exclusive with `until`. */
  count?: number;
}

/** Host entity that may own a calendar. */
export interface Entity {
  id: Uuid;
  entityType: string;
  name: string;
  parentId?: Uuid;
  createdAt: Instant;
  updatedAt: Instant;
}

/** Calendar row; parentage is derived from the entity tree. */
export interface Calendar {
  id: Uuid;
  timeZone: TimeZone;
  inheritance: InheritanceMode;
  createdAt: Instant;
  updatedAt: Instant;
}

/** 1:1 link between an entity and a calendar. */
export interface EntityCalendar {
  id: Uuid;
  entityId: Uuid;
  calendarId: Uuid;
  createdAt: Instant;
  updatedAt: Instant;
}

/** Event on a calendar, optionally recurring. */
export interface CalendarEvent {
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

/** Working-hours rule expanded in the calendar zone. */
export interface AvailabilityRule {
  id: Uuid;
  calendarId: Uuid;
  startTime: ClockTime;
  endTime: ClockTime;
  recurrence: RecurrenceRule;
  excludedDates?: DateOnly[];
  createdAt: Instant;
  updatedAt: Instant;
}

/** Bookable slot that reserves the owner’s time. */
export interface BookableSlot {
  id: Uuid;
  calendarId: Uuid;
  start: Instant;
  end: Instant;
  occupancy: Occupancy;
  createdAt: Instant;
  updatedAt: Instant;
}

/** Single-occurrence booking: event seat, slot seat, or ad-hoc. */
export interface Booking {
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

/** Immutable host-supplied engine input. */
export interface CalendarSnapshot {
  entities: Entity[];
  calendars: Calendar[];
  entityCalendars: EntityCalendar[];
  events: CalendarEvent[];
  availabilityRules: AvailabilityRule[];
  slots: BookableSlot[];
  bookings: Booking[];
}

/** Domain success or a structured engine error. */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: EngineError };

/** Expected failure returned instead of throwing. */
export interface EngineError {
  code: 'validation' | 'not_found' | 'integrity' | 'conflict' | 'range';
  message: string;
  conflicts?: Conflict[];
  details?: Record<string, unknown>;
}

/** One occupancy or availability clash reported by check/apply. */
export interface Conflict {
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

/** Options for apply/put writes. */
export interface ApplyOptions {
  /** When true, commit even if occupancy conflicts exist. */
  allowConflicts?: boolean;
  /** Stamp for `createdAt` / `updatedAt`; default is now. */
  now?: Instant;
}

/** Half-open UTC interval `[start, end)`. */
export interface TimeRange {
  start: Instant;
  end: Instant;
}

/** Expanded occurrence interval in UTC. */
export interface Occurrence {
  start: Instant;
  end: Instant;
}

/** Value of a successful `check*` call. */
export interface CheckReport {
  conflicts: Conflict[];
  remainingCapacity?: number;
}

/** Value of a successful `apply*` / `put*` call. */
export interface ApplySuccess<T> {
  snapshot: CalendarSnapshot;
  record: T;
}

/** Open ad-hoc intervals for one calendar. */
export interface AvailabilityReport {
  calendarId: Uuid;
  intervals: Occurrence[];
}

/** One item in a calendar view query. */
export interface ViewItem {
  source: 'own' | 'inherited' | 'rolled-up';
  type: 'event' | 'slot' | 'booking';
  id: Uuid;
  calendarId: Uuid;
  title?: string;
  start: Instant;
  end: Instant;
  occupancy?: Occupancy;
}

/** Tagged items that intersect a query range. */
export interface CalendarView {
  calendarId: Uuid;
  range: TimeRange;
  items: ViewItem[];
}

/** `putEntity` input; timestamps are stamped by the engine. */
export type EntityInput = Omit<Entity, 'createdAt' | 'updatedAt'>;

/** `putCalendar` input; timestamps are stamped by the engine. */
export type CalendarInput = Omit<Calendar, 'createdAt' | 'updatedAt'>;

/** `putEntityCalendar` input; timestamps are stamped by the engine. */
export type EntityCalendarInput = Omit<
  EntityCalendar,
  'createdAt' | 'updatedAt'
>;

/**
 * Event command input. `occupancy` defaults to exclusive when omitted.
 */
export type EventInput = Omit<
  CalendarEvent,
  'createdAt' | 'updatedAt' | 'occupancy'
> & { occupancy?: Occupancy };

/** Availability-rule command input. */
export type RuleInput = Omit<AvailabilityRule, 'createdAt' | 'updatedAt'>;

/**
 * Slot command input. `occupancy` defaults to exclusive when omitted.
 */
export type SlotInput = Omit<
  BookableSlot,
  'createdAt' | 'updatedAt' | 'occupancy'
> & { occupancy?: Occupancy };

/** Booking command input. */
export type BookingInput = Omit<Booking, 'createdAt' | 'updatedAt'>;
