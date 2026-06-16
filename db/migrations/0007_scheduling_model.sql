-- ============================================================================
-- Migration 0007 — Scheduling model (Phase 4A)
-- Run this in the Supabase SQL editor (Database → SQL Editor → New query).
--
-- Introduces the schedule source of truth. The unit of truth is ONE concrete
-- shift = one picker, one date, its own start/end. A day off is simply the
-- ABSENCE of a row for that date. No recurrence engine — templates (Part B)
-- only speed up data entry; they are never authoritative.
--
-- Does NOT touch the existing `shifts` table (worked-hours records) or
-- employees.shift_start/end (kept as the fallback default).
--
-- Run the parts IN ORDER and inspect between them:
--   Part A: scheduled_shifts  — the concrete schedule
--   Part B: schedule_templates — a picker's typical week (data-entry aid only)
--   Part C: audit_logs         — append-only change log
--   Part D: enable RLS (deny-by-default; the app's secret-key server client
--           bypasses RLS, so server-rendered reads/writes keep working)
--   Part E: verify shapes
--
-- Conventions matched from the existing schema (see src/lib/supabase.ts types):
--   • uuid PKs via gen_random_uuid(); tenant_id/employee_id/location_id are uuid
--   • status/origin as text + CHECK (same style as alerts.type / shifts.status)
--   • actor / assigner reference public.ops_users(id)
--   • tenant_id is left WITHOUT a FK (the tenants table name isn't assumed here);
--     add one later if you want — every table is tenant-scoped in app logic.
-- ============================================================================

create extension if not exists pgcrypto;  -- gen_random_uuid() (no-op on PG13+)


-- ── Part A — scheduled_shifts ──────────────────────────────────────────────
-- One row = one picker scheduled on one date with concrete times.
--   status      : 'scheduled' (active), 'cancelled' (shift removed, not a
--                 no-show for anyone), 'reassigned' (covered — see below)
--   reassigned_to_employee_id : when this shift is covered, points to the cover
--                 picker (whose own 'scheduled' row, origin='cover', carries the
--                 real expected times). The original row stays as history.
--   origin      : how the row was created — 'csv' | 'manual' | 'cover' | 'template'
--   assigned_by : the ops user who created/last-assigned it (nullable for imports)
create table if not exists public.scheduled_shifts (
  id                         uuid primary key default gen_random_uuid(),
  tenant_id                  uuid not null,
  employee_id                uuid not null references public.employees(id) on delete cascade,
  location_id                uuid not null references public.locations(id) on delete cascade,
  date                       date not null,
  start_time                 time not null,
  end_time                   time not null,
  status                     text not null default 'scheduled'
                               check (status in ('scheduled','cancelled','reassigned')),
  reassigned_to_employee_id  uuid references public.employees(id) on delete set null,
  origin                     text not null default 'manual'
                               check (origin in ('csv','manual','cover','template')),
  assigned_by                uuid references public.ops_users(id) on delete set null,
  created_at                 timestamptz not null default now(),

  -- No overnight shifts; a shift must end after it starts.
  constraint scheduled_shifts_time_order_chk check (end_time > start_time),
  -- One picker can hold at most one shift per date (no double-booking). The
  -- original 'reassigned' row keeps the slot; the cover picker gets their OWN
  -- row on a different employee_id, so this never blocks a cover.
  constraint scheduled_shifts_emp_date_uniq unique (employee_id, date)
);

create index if not exists scheduled_shifts_location_date_idx
  on public.scheduled_shifts (location_id, date);
create index if not exists scheduled_shifts_date_idx
  on public.scheduled_shifts (date);


-- ── Part B — schedule_templates ────────────────────────────────────────────
-- A picker's TYPICAL week. Used only by a future "generate week from templates"
-- action to pre-fill scheduled_shifts rows you then edit. Never read by
-- attendance/no-show logic. weekday: 0 = Monday … 6 = Sunday (our week is
-- Mon-first). To map a date to this convention use ISO DOW minus one:
--   weekday := extract(isodow from d)::int - 1   -- Mon=0 … Sun=6
create table if not exists public.schedule_templates (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  employee_id   uuid not null references public.employees(id) on delete cascade,
  location_id   uuid not null references public.locations(id) on delete cascade,
  weekday       smallint not null check (weekday between 0 and 6),
  start_time    time not null,
  end_time      time not null,
  created_at    timestamptz not null default now(),

  constraint schedule_templates_time_order_chk check (end_time > start_time),
  -- One typical entry per picker per weekday.
  constraint schedule_templates_emp_weekday_uniq unique (employee_id, weekday)
);


-- ── Part C — audit_logs (append-only) ──────────────────────────────────────
-- Records every create/edit/cancel/cover on schedule data (and anything else
-- we choose to log). `before`/`after` capture the row state as jsonb.
create table if not exists public.audit_logs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  actor_user_id  uuid references public.ops_users(id) on delete set null,
  entity_type    text not null,         -- e.g. 'scheduled_shift'
  entity_id      uuid,                  -- the affected row's id (nullable for bulk)
  action         text not null,         -- e.g. 'create' | 'update' | 'cancel' | 'cover'
  before         jsonb,
  after          jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists audit_logs_entity_idx
  on public.audit_logs (entity_type, entity_id);
create index if not exists audit_logs_tenant_created_idx
  on public.audit_logs (tenant_id, created_at desc);


-- ── Part D — Row Level Security (deny-by-default) ──────────────────────────
-- The app reaches these tables only through the secret-key server client, which
-- BYPASSES RLS — so enabling RLS with no policies locks out the browser
-- (publishable key) without affecting the server-rendered roster or API routes.
-- Add tenant-scoped policies later only if you ever read these from the browser.
alter table public.scheduled_shifts  enable row level security;
alter table public.schedule_templates enable row level security;
alter table public.audit_logs         enable row level security;


-- ── Part E — Verify ────────────────────────────────────────────────────────
-- Column shapes (expect the columns listed above, correct types/defaults):
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('scheduled_shifts','schedule_templates','audit_logs')
order by table_name, ordinal_position;

-- Constraints + indexes landed:
-- select conname, contype from pg_constraint
-- where conrelid = 'public.scheduled_shifts'::regclass;
-- select indexname from pg_indexes
-- where schemaname = 'public'
--   and tablename in ('scheduled_shifts','schedule_templates','audit_logs');

-- Smoke test (rolls back — never commits a row):
-- begin;
--   insert into public.scheduled_shifts (tenant_id, employee_id, location_id, date, start_time, end_time, origin)
--   select e.tenant_id, e.id, e.location_id, current_date, '08:00', '19:00', 'manual'
--   from public.employees e
--   where e.location_id is not null and e.role = 'picker'
--   limit 1
--   returning *;
-- rollback;
