-- Reference PostgreSQL schema for the calendar booking engine.
--
-- The engine never executes SQL and `validateSnapshot` stays the source
-- of truth. This file enforces, in the database, the rules SQL can
-- express so that two writers that each pass `check*` against the same
-- loaded snapshot cannot both commit a violation.
--
-- DB-backed here:
--   * entity parent cycles (trigger)
--   * booking event/slot must belong to booking.calendar_id (composite FK)
--   * exclusive overlap per table: non-recurring exclusive events,
--     exclusive slots, and ad-hoc bookings (exclusion constraints)
--   * calendar/event time zones exist in pg_timezone_names (trigger)
--   * recurrence shape: object, freq, interval 1..1000, count 1..10000,
--     until xor count, and start_date for rules with a stride or count
--   * attendee deletes are restricted while bookings reference them
--   * updated_at is maintained on every UPDATE (trigger)
--
-- Engine-only (hosts must still run check*/apply*):
--   * recurring series expansion and their conflicts
--   * overlap across tables (an event against a slot or a booking),
--     inherited parent blocks, and availability windows
--   * capacity and attendee-conflict counting
--   * byDay uniqueness, excludedDates, canonical instant strings
--
-- Hosts must still serialize writes per calendar (for example with
-- `pg_advisory_xact_lock` on the calendar id) because the engine-only
-- checks above are made against a loaded snapshot.
--
-- Requires the btree_gist extension (superuser or trusted extension).

create extension if not exists btree_gist;

create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function assert_time_zone() returns trigger
language plpgsql as $$
begin
  if new.time_zone is not null
     and not exists (
       select 1 from pg_timezone_names where name = new.time_zone
     ) then
    raise exception 'unknown IANA time zone: %', new.time_zone
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Mirrors the engine's recurrence rules that SQL can express. Full
-- validation (byDay, until format) stays in the engine.
create function recurrence_is_valid(rule jsonb) returns boolean
language sql immutable as $$
  select case
    when rule is null then true
    when jsonb_typeof(rule) <> 'object' then false
    when coalesce(rule->>'freq', '') not in ('daily', 'weekly', 'yearly')
      then false
    when rule ? 'until' and rule ? 'count' then false
    when rule ? 'interval' and not case
      when jsonb_typeof(rule->'interval') = 'number'
        and (rule->>'interval') ~ '^[0-9]+$'
        then (rule->>'interval')::numeric between 1 and 1000
      else false
    end then false
    when rule ? 'count' and not case
      when jsonb_typeof(rule->'count') = 'number'
        and (rule->>'count') ~ '^[0-9]+$'
        then (rule->>'count')::numeric between 1 and 10000
      else false
    end then false
    else true
  end
$$;

create table entity (
  id          uuid primary key,
  entity_type text not null,
  name        text not null,
  parent_id   uuid references entity (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint entity_parent_not_self_chk check (parent_id is distinct from id)
);

create function assert_entity_acyclic() returns trigger
language plpgsql as $$
begin
  if new.parent_id is not null and exists (
    with recursive ancestor (id) as (
      select e.parent_id from entity e where e.id = new.parent_id
      union
      select e.parent_id from entity e
        join ancestor a on e.id = a.id
        where e.parent_id is not null
    )
    select 1 from ancestor where id = new.id
  ) then
    raise exception 'entity parent_id cycle: % under %', new.id, new.parent_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger entity_acyclic_trg
  before insert or update of parent_id on entity
  for each row execute function assert_entity_acyclic();

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
  -- Target of booking's composite foreign key.
  constraint calendar_event_id_calendar_uk unique (id, calendar_id),
  constraint calendar_event_range_chk check (start_at < end_at),
  constraint calendar_event_occupancy_chk
    check (
      (occupancy_kind = 'exclusive' and capacity_max is null)
      or (occupancy_kind = 'capacity' and capacity_max >= 1)
    ),
  constraint calendar_event_recurrence_chk
    check (recurrence_is_valid(recurrence)),
  -- Non-recurring exclusive events only; recurring series are
  -- checked by the engine.
  constraint calendar_event_exclusive_excl
    exclude using gist (
      calendar_id with =,
      tstzrange(start_at, end_at) with &&
    ) where (occupancy_kind = 'exclusive' and recurrence is null)
);

create table availability_rule (
  id              uuid primary key,
  calendar_id     uuid not null references calendar (id) on delete cascade,
  start_time      time not null,
  end_time        time not null,
  start_date      date,
  recurrence      jsonb not null,
  excluded_dates  date[],
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint availability_rule_recurrence_chk
    check (recurrence_is_valid(recurrence)),
  constraint availability_rule_start_date_chk
    check (
      start_date is not null
      or (
        not (recurrence ? 'count')
        and (not (recurrence ? 'interval') or recurrence->'interval' = '1'::jsonb)
      )
    )
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
  -- Target of booking's composite foreign key.
  constraint bookable_slot_id_calendar_uk unique (id, calendar_id),
  constraint bookable_slot_range_chk check (start_at < end_at),
  constraint bookable_slot_occupancy_chk
    check (
      (occupancy_kind = 'exclusive' and capacity_max is null)
      or (occupancy_kind = 'capacity' and capacity_max >= 1)
    ),
  constraint bookable_slot_exclusive_excl
    exclude using gist (
      calendar_id with =,
      tstzrange(start_at, end_at) with &&
    ) where (occupancy_kind = 'exclusive')
);

create table booking (
  id           uuid primary key,
  calendar_id  uuid not null references calendar (id) on delete cascade,
  start_at     timestamptz not null,
  end_at       timestamptz not null,
  event_id     uuid,
  slot_id      uuid,
  -- The engine refuses attendee removal while bookings reference
  -- them, so the database restricts rather than cascades.
  attendee_id  uuid references entity (id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint booking_range_chk check (start_at < end_at),
  constraint booking_target_chk check (
    not (event_id is not null and slot_id is not null)
  ),
  -- A seat booking's target must be on the booking's own calendar
  -- (not enforced when the column is null).
  constraint booking_event_calendar_fk
    foreign key (event_id, calendar_id)
    references calendar_event (id, calendar_id) on delete cascade,
  constraint booking_slot_calendar_fk
    foreign key (slot_id, calendar_id)
    references bookable_slot (id, calendar_id) on delete cascade,
  -- Ad-hoc bookings are exclusive busy time.
  constraint booking_ad_hoc_excl
    exclude using gist (
      calendar_id with =,
      tstzrange(start_at, end_at) with &&
    ) where (event_id is null and slot_id is null)
);

create trigger calendar_time_zone_trg
  before insert or update of time_zone on calendar
  for each row execute function assert_time_zone();

create trigger calendar_event_time_zone_trg
  before insert or update of time_zone on calendar_event
  for each row execute function assert_time_zone();

create trigger entity_updated_at_trg
  before update on entity
  for each row execute function set_updated_at();
create trigger calendar_updated_at_trg
  before update on calendar
  for each row execute function set_updated_at();
create trigger entity_calendar_updated_at_trg
  before update on entity_calendar
  for each row execute function set_updated_at();
create trigger calendar_event_updated_at_trg
  before update on calendar_event
  for each row execute function set_updated_at();
create trigger availability_rule_updated_at_trg
  before update on availability_rule
  for each row execute function set_updated_at();
create trigger bookable_slot_updated_at_trg
  before update on bookable_slot
  for each row execute function set_updated_at();
create trigger booking_updated_at_trg
  before update on booking
  for each row execute function set_updated_at();

create index entity_parent_id_idx on entity (parent_id);
create index entity_entity_type_idx on entity (entity_type);
create index calendar_event_calendar_id_idx on calendar_event (calendar_id);
create index availability_rule_calendar_id_idx on availability_rule (calendar_id);
create index bookable_slot_calendar_id_idx on bookable_slot (calendar_id);
create index booking_calendar_id_idx on booking (calendar_id);
create index booking_event_id_idx on booking (event_id);
create index booking_slot_id_idx on booking (slot_id);
create index booking_attendee_id_idx on booking (attendee_id);
