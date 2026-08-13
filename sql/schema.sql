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
