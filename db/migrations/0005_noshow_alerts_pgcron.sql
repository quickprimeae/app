-- ============================================================================
-- Migration 0005 — No-show alerts via pg_cron
-- Run this in the Supabase SQL editor (Database → SQL Editor → New query).
--
-- What it does: a scheduled job scans every few minutes for pickers who are
-- past their shift start (+ a grace window) with no clock-in today, and inserts
-- one `noshow` alert per employee per day. The dashboard already renders and
-- live-subscribes to the alerts table, so flagged no-shows appear automatically.
--
-- Mirrors the app's no-show logic in src/lib/dashboard.ts, but adds a grace
-- window so a picker isn't flagged the instant their shift starts.
--
-- Run the parts IN ORDER and inspect between them:
--   Part A: enable pg_cron (idempotent)
--   Part B: create detect_noshows() (safe, idempotent — does NOT schedule)
--   Part C: DRY RUN — preview who would be flagged right now (no writes)
--   Part D: run it once manually and confirm the alerts landed
--   Part E: schedule the cron job (idempotent — re-running re-registers it)
--   Part F: (reference) how to inspect / unschedule the job later
--
-- ── Tunables (edit before running if you want different behavior) ───────────
--   GRACE WINDOW : 15 minutes after shift start — change the interval in Part B.
--   CRON CADENCE : every 5 minutes ('*/5 * * * *') — change the schedule in Part E.
--   TIMEZONE     : 'Asia/Dubai' (GST, UTC+4, no DST) — shifts are stored in GST.
-- ============================================================================


-- ── Part A — Enable pg_cron ────────────────────────────────────────────────
-- On Supabase this can also be toggled under Database → Extensions. Safe to
-- run repeatedly. pg_cron installs into the `cron` schema.
create extension if not exists pg_cron;


-- ── Part B — No-show detector function ─────────────────────────────────────
-- One alert per no-show employee per GST day. A picker is a no-show when:
--   • active, has set a PIN (awaiting_setup employees CAN'T clock in, so they
--     are never flagged — consistent with Phase 2), role = 'picker'
--   • assigned to an active location
--   • has an effective shift start (own shift_start, else the location's)
--   • now (GST) is past shift_start + grace
--   • no clock_in event today (GST day)
--   • no `noshow` alert already exists for them today (resolved or not) — so a
--     resolved alert is not immediately re-created
-- Returns the number of alerts inserted (handy for the dry run / manual run).
create or replace function public.detect_noshows()
returns integer
language plpgsql
as $$
declare
  inserted integer;
  gst_now  timestamp := (now() at time zone 'Asia/Dubai');  -- GST wall-clock
  gst_day  date      := (now() at time zone 'Asia/Dubai')::date;
begin
  with flagged as (
    insert into public.alerts (tenant_id, type, severity, title, body, employee_id, location_id, resolved, created_at)
    select
      e.tenant_id,
      'noshow',
      'critical',
      'No-show — ' || l.name,
      trim(e.first_name || ' ' || e.last_name)
        || ' has not clocked in. Shift started '
        || to_char(coalesce(e.shift_start, l.shift_start), 'HH24:MI') || ' (GST).',
      e.id,
      e.location_id,
      false,
      now()
    from public.employees e
    join public.locations l
      on l.id = e.location_id
     and l.active = true
    where e.active = true
      and e.pin_set = true
      and e.role = 'picker'
      and coalesce(e.shift_start, l.shift_start) is not null
      -- shift started + 15-minute grace, compared in GST (no overnight shifts)
      and gst_now::time > coalesce(e.shift_start, l.shift_start) + interval '15 minutes'
      -- no clock-in today (GST day)
      and not exists (
        select 1
        from public.clock_events ce
        where ce.employee_id = e.id
          and ce.event_type = 'clock_in'
          and (ce.timestamp at time zone 'Asia/Dubai')::date = gst_day
      )
      -- one per employee per day (don't re-raise after resolution)
      and not exists (
        select 1
        from public.alerts a
        where a.employee_id = e.id
          and a.type = 'noshow'
          and (a.created_at at time zone 'Asia/Dubai')::date = gst_day
      )
    returning 1
  )
  select count(*) into inserted from flagged;
  return inserted;
end;
$$;


-- ── Part C — DRY RUN: preview who would be flagged right now (no writes) ────
-- Same predicate as the function, as a SELECT. Empty result = nobody is
-- currently a no-show (or everyone due has already been flagged today).
select
  e.employee_number,
  trim(e.first_name || ' ' || e.last_name) as name,
  l.name as location,
  to_char(coalesce(e.shift_start, l.shift_start), 'HH24:MI') as shift_start_gst,
  to_char((now() at time zone 'Asia/Dubai'), 'HH24:MI') as now_gst
from public.employees e
join public.locations l
  on l.id = e.location_id and l.active = true
where e.active = true
  and e.pin_set = true
  and e.role = 'picker'
  and coalesce(e.shift_start, l.shift_start) is not null
  and (now() at time zone 'Asia/Dubai')::time
        > coalesce(e.shift_start, l.shift_start) + interval '15 minutes'
  and not exists (
    select 1 from public.clock_events ce
    where ce.employee_id = e.id
      and ce.event_type = 'clock_in'
      and (ce.timestamp at time zone 'Asia/Dubai')::date = (now() at time zone 'Asia/Dubai')::date
  )
  and not exists (
    select 1 from public.alerts a
    where a.employee_id = e.id
      and a.type = 'noshow'
      and (a.created_at at time zone 'Asia/Dubai')::date = (now() at time zone 'Asia/Dubai')::date
  )
order by l.name, name;


-- ── Part D — Run once manually and confirm ─────────────────────────────────
-- Returns the number of alerts inserted this run (0 if the dry run was empty).
select public.detect_noshows() as alerts_inserted;

-- Inspect today's no-show alerts:
-- select id, title, body, employee_id, location_id, resolved, created_at
-- from public.alerts
-- where type = 'noshow'
--   and (created_at at time zone 'Asia/Dubai')::date = (now() at time zone 'Asia/Dubai')::date
-- order by created_at desc;


-- ── Part E — Schedule the cron job (every 5 minutes) ───────────────────────
-- Idempotent: drop any existing job with this name first, then (re)create it.
-- cron.schedule runs the command in the database's own session; no auth needed.
do $$
declare jid bigint;
begin
  for jid in select jobid from cron.job where jobname = 'detect-noshows' loop
    perform cron.unschedule(jid);
  end loop;
end $$;

select cron.schedule(
  'detect-noshows',
  '*/5 * * * *',                 -- every 5 minutes
  $cron$ select public.detect_noshows(); $cron$
);


-- ── Part F — (reference) inspect / unschedule later ────────────────────────
-- List scheduled jobs:
--   select jobid, jobname, schedule, command, active from cron.job;
-- See recent runs + status:
--   select * from cron.job_run_details order by start_time desc limit 20;
-- Pause/remove the job:
--   select cron.unschedule('detect-noshows');
