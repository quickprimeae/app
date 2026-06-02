-- ============================================================================
-- Migration 0001 — Per-employee shift times
-- Run this in the Supabase SQL editor (Database → SQL Editor → New query).
-- Safe to run more than once (idempotent where possible).
--
-- Context: employees at the same location can work different shift patterns
-- (e.g. 08:00–19:00, 12:00–23:00, 22:00–09:00). Shift times move to the
-- employees table; the locations columns become defaults/fallbacks.
-- ============================================================================

begin;

-- 1) Per-employee shift times. NULL means "inherit the location default".
alter table public.employees
  add column if not exists shift_start time without time zone,
  add column if not exists shift_end   time without time zone;

-- 2) Make the location shift columns optional defaults (no longer required).
alter table public.locations alter column shift_start drop not null;
alter table public.locations alter column shift_end   drop not null;

-- 3) today_attendance — no-show / counts use the employee's shift time when set,
--    else the location's default. Output columns are unchanged so the app and
--    any other consumers keep working; shift_start/shift_end stay as the
--    LOCATION default (display only — there is no single shift per location now).
--
--    Shift times are Gulf Standard Time (UTC+4); compared as (now()+4h). No
--    overnight shifts, so a same-day comparison is sufficient.
create or replace view public.today_attendance as
with todays_clock_ins as (
  select distinct employee_id
  from public.clock_events
  where event_type = 'clock_in'
    and timestamp >= date_trunc('day', now())
    and timestamp <  date_trunc('day', now()) + interval '1 day'
)
select
  l.id                                   as location_id,
  l.name                                 as location_name,
  c.name                                 as client,
  l.shift_start,                         -- location default (display only)
  l.shift_end,
  count(e.id)                            as total_pickers,
  count(e.id) filter (where ci.employee_id is not null)              as clocked_in_count,
  count(e.id) filter (
    where ci.employee_id is null
      and coalesce(e.shift_start, l.shift_start) is not null
      and (now() + interval '4 hours')::time >= coalesce(e.shift_start, l.shift_start)
  )                                                                  as missing_count,
  case
    when count(e.id) = 0 then 'noshift'
    when count(e.id) filter (where ci.employee_id is not null) = count(e.id) then 'active'
    when count(e.id) filter (where ci.employee_id is not null) = 0 then 'noshow'
    else 'late'
  end                                                                as status
from public.locations l
left join public.clients   c  on c.id = l.client_id
left join public.employees e  on e.location_id = l.id
                             and e.active is true
                             and e.role = 'picker'
left join todays_clock_ins ci on ci.employee_id = e.id
where l.active is true
group by l.id, l.name, c.name, l.shift_start, l.shift_end;

commit;

-- ============================================================================
-- 4) auto_clockout_missed()  —  apply two changes to the CURRENT function:
--    (a) use coalesce(e.shift_end, l.shift_end) for each employee's effective
--        shift end instead of the location's shift_end;
--    (b) shift times are GST (UTC+4): add interval '4 hours' to now() in the
--        comparison, e.g. (now() + interval '4 hours')::time >= coalesce(...).
--
-- Dump the current definition so the edits preserve everything else:
--     select pg_get_functiondef('public.auto_clockout_missed'::regproc);
-- ============================================================================
