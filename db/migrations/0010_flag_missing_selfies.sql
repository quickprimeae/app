-- ============================================================================
-- Migration 0010 — Flag punches that are missing their mandatory selfie
-- Run this in the Supabase SQL editor (Database → SQL Editor → New query).
--
-- Context: the live selfie is now mandatory on every punch, but the clock_event
-- is still recorded at PIN, BEFORE the selfie uploads (the verify-vs-record
-- reorder is Sub-step 3). So a force-close right after PIN leaves an event with
-- selfie_triggered = true and selfie_url = null. This makes that gap VISIBLE:
-- after a short grace, such events are flagged for review so they can't hide.
--
-- A real punch uploads its selfie within a second or two, so we only flag events
-- older than the grace (default 10 min) and newer than 1 day (the 1-day floor
-- avoids back-flagging pre-mandatory-selfie history, where the old random check
-- legitimately had selfie_triggered=true + a skipped selfie).
--
-- Parts:
--   A. alerts.clock_event_id  — link an alert to the punch it concerns
--   B. flag_missing_selfies()  — set face_match_flagged + raise a faceflag alert
--   C. schedule the cron (every 5 min)
--   D. verify / dry-run
--
-- TUNABLES: grace '10 minutes' and floor '1 day' in Part B; cadence in Part C.
-- ============================================================================


-- ── Part A — Link alerts to the clock_event they concern ───────────────────
-- Nullable + ON DELETE CASCADE; existing alerts keep NULL. Sub-step 3's review
-- queue will join this to show the captured frame / score next to the alert.
alter table public.alerts
  add column if not exists clock_event_id uuid references public.clock_events(id) on delete cascade;

create index if not exists alerts_clock_event_idx on public.alerts (clock_event_id);


-- ── Part B — flag_missing_selfies() ────────────────────────────────────────
-- Idempotent: marks the events (face_match_flagged) and raises ONE faceflag
-- alert per event (deduped by clock_event_id). Returns the number of new alerts.
create or replace function public.flag_missing_selfies()
returns integer
language plpgsql
as $$
declare
  inserted integer;
begin
  -- Mark the stale punches so the dashboard's face-flag chips/KPI reflect them.
  update public.clock_events ce
  set face_match_flagged = true
  where ce.selfie_triggered = true
    and ce.selfie_url is null
    and ce.face_match_flagged is distinct from true
    and ce.timestamp < now() - interval '10 minutes'
    and ce.timestamp > now() - interval '1 day';

  -- Raise one faceflag alert per such event (the review queue entry).
  with newly as (
    insert into public.alerts (tenant_id, type, severity, title, body, employee_id, location_id, clock_event_id, resolved, created_at)
    select
      ce.tenant_id,
      'faceflag',
      'warning',
      'Punch missing selfie — ' || trim(e.first_name || ' ' || e.last_name),
      'A ' || replace(ce.event_type, '_', '-')
        || ' was recorded but no live selfie was captured (possible app close after PIN). Review this punch.',
      ce.employee_id,
      ce.location_id,
      ce.id,
      false,
      now()
    from public.clock_events ce
    join public.employees e on e.id = ce.employee_id
    where ce.selfie_triggered = true
      and ce.selfie_url is null
      and ce.timestamp < now() - interval '10 minutes'
      and ce.timestamp > now() - interval '1 day'
      and not exists (
        select 1 from public.alerts a
        where a.clock_event_id = ce.id and a.type = 'faceflag'
      )
    returning 1
  )
  select count(*) into inserted from newly;
  return inserted;
end;
$$;


-- ── Part C — Schedule (every 5 minutes) ────────────────────────────────────
-- Idempotent: drop any existing job with this name, then (re)create it.
do $$
declare jid bigint;
begin
  for jid in select jobid from cron.job where jobname = 'flag-missing-selfies' loop
    perform cron.unschedule(jid);
  end loop;
end $$;

select cron.schedule(
  'flag-missing-selfies',
  '*/5 * * * *',
  $cron$ select public.flag_missing_selfies(); $cron$
);


-- ── Part D — Verify ────────────────────────────────────────────────────────
-- Preview what WOULD flag right now (no writes):
-- select e.first_name, e.last_name, ce.event_type, ce.timestamp
-- from public.clock_events ce
-- join public.employees e on e.id = ce.employee_id
-- where ce.selfie_triggered = true and ce.selfie_url is null
--   and ce.timestamp < now() - interval '10 minutes'
--   and ce.timestamp > now() - interval '1 day'
--   and not exists (select 1 from public.alerts a where a.clock_event_id = ce.id and a.type='faceflag')
-- order by ce.timestamp desc;

-- Run once now and see how many alerts it raised:
-- select public.flag_missing_selfies() as alerts_raised;

-- Confirm the cron is registered:
-- select jobname, schedule, active from cron.job where jobname = 'flag-missing-selfies';
