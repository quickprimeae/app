-- ============================================================================
-- Migration 0009 — Strict detection cutover onto scheduled_shifts (Phase 4B)
-- Run this in the Supabase SQL editor (Database → SQL Editor → New query),
-- PART BY PART, inspecting between them.
--
-- What changes: today_attendance, detect_noshows(), and auto_clockout_missed()
-- stop reading employee/location DEFAULT shift times and instead read the
-- concrete scheduled_shifts row for the picker+today (status='scheduled') for
-- the expected times.
--
-- STRICT MODE — the whole point of this cutover:
--   • A picker with NO scheduled_shifts row for today is OFF: never a no-show,
--     never auto-clocked-out. There is NO fallback to employee or location
--     default times.
--   • A 'cancelled' or 'reassigned' row is not status='scheduled', so the
--     ORIGINAL picker is OFF (never a no-show).
--   • A cover picker has their OWN row (origin='cover', status='scheduled'),
--     so THEY are the one tracked. No special-casing — status='scheduled' alone
--     expresses all of this.
--
-- Conventions preserved: GST via (now() + interval '4 hours'); 15-min no-show
-- grace (alerts only); no overnight shifts (same-day time comparison).
--
-- ⚠ PREREQUISITE BEFORE YOU RELY ON THIS: run Part D (safety) and make sure the
--   list of active PIN-set pickers with NO shift today is who you expect —
--   anyone accidentally left off the roster goes invisible to detection.
--
-- Parts (run A–D together for the cutover, then the Part E verifies):
--   A. Replace auto_clockout_missed()   — strict shift-end source
--   B. Replace today_attendance view
--   C. Replace detect_noshows()
--   D. Safety: active pin_set pickers with no scheduled_shift today
--   E. Verify
-- ============================================================================


-- ── Part A — auto_clockout_missed() (strict; reads today's scheduled end) ──
-- ONLY the effective shift-end source changes: from coalesce(e.shift_end,
-- l.shift_end) to today's scheduled_shifts.end_time, via an INNER join on
-- scheduled_shifts (status='scheduled'). Everything else — the clock_events /
-- shifts / alerts inserts, hours_raw math, the Asia/Dubai conversion, and the
-- current_date (UTC) clock-in/day filters — is unchanged.
--
-- STRICT: the inner join means a clocked-in picker with NO scheduled row today
-- is NOT processed — they stay open rather than getting a fabricated clock-out
-- against a default time we no longer trust. Cover pickers (origin='cover',
-- status='scheduled') ARE processed; the original reassigned/cancelled row is
-- excluded because it is not status='scheduled'.
create or replace function public.auto_clockout_missed()
 returns void
 language plpgsql
 security definer
as $function$
  declare
    r               record;
    auto_out_time   timestamptz;
    new_clockout_id uuid;
  begin
    for r in
      select
        ce.id          as clock_in_event_id,
        ce.employee_id,
        ce.location_id,
        ce.tenant_id,
        ce.timestamp   as clock_in_time,
        ss.end_time    as shift_end,   -- STRICT: today's scheduled end (was coalesce(e.shift_end, l.shift_end))
        e.hourly_rate,
        e.first_name,
        e.last_name
      from clock_events ce
      join locations l on l.id = ce.location_id
      join employees  e on e.id = ce.employee_id
      -- STRICT: inner join to today's scheduled shift. No row -> not processed.
      join scheduled_shifts ss
        on ss.employee_id = ce.employee_id
       and ss.date        = (now() + interval '4 hours')::date
       and ss.status      = 'scheduled'
      where
        ce.event_type        = 'clock_in'
        and ce.timestamp::date = current_date
        and not exists (
          select 1 from clock_events co
          where co.employee_id  = ce.employee_id
            and co.event_type   = 'clock_out'
            and co.timestamp::date = current_date
        )
        and not exists (
          select 1 from shifts s
          where s.employee_id = ce.employee_id
            and s.date        = current_date
        )
        -- effective shift end from the roster, GST (+4h) comparison
        and (now() + interval '4 hours') > (current_date + ss.end_time + interval '30 minutes')
    loop
      -- interpret the shift end as Dubai (GST) wall-clock -> correct UTC instant
      auto_out_time := ((current_date + r.shift_end) at time zone 'Asia/Dubai');

      insert into clock_events (
        tenant_id, employee_id, location_id,
        event_type, timestamp,
        is_auto_clockout, auto_clockout_note,
        geofence_passed, pin_verified
      ) values (
        r.tenant_id, r.employee_id, r.location_id,
        'clock_out', auto_out_time,
        true, 'Auto clock-out: no manual clock-out by shift end + 30 min',
        false, false
      )
      returning id into new_clockout_id;

      insert into shifts (
        tenant_id, employee_id, location_id,
        date, clock_in_event_id, clock_out_event_id,
        clock_in_time, clock_out_time,
        hours_raw, hourly_rate,
        is_auto_clockout, needs_review,
        review_note, status
      ) values (
        r.tenant_id, r.employee_id, r.location_id,
        current_date, r.clock_in_event_id, new_clockout_id,
        r.clock_in_time, auto_out_time,
        round(extract(epoch from (auto_out_time - r.clock_in_time)) / 3600, 2),
        r.hourly_rate,
        true, true,
        'Auto clock-out — ops must verify hours before payroll',
        'pending'
      );

      insert into alerts (
        tenant_id, employee_id, location_id,
        type, severity, title, body
      ) values (
        r.tenant_id, r.employee_id, r.location_id,
        'clockout', 'warning',
        'Auto clock-out — ' || r.first_name || ' ' || r.last_name,
        'No clock-out recorded. Auto-closed at ' ||
          to_char(auto_out_time at time zone 'Asia/Dubai', 'HH24:MI') ||
          '. Verify before payroll.'
      );
    end loop;
  end;
  $function$;


-- ── Part B — today_attendance (strict; per-location aggregate over today's
--    scheduled shifts) ──────────────────────────────────────────────────────
-- Output columns are unchanged (location_id, location_name, client, shift_start,
-- shift_end, total_pickers, clocked_in_count, missing_count, status) so any
-- consumer keeps working. total_pickers now counts pickers SCHEDULED today, not
-- everyone assigned to the location. shift_start/shift_end remain the location
-- default (display only).
create or replace view public.today_attendance as
with sched as (
  select ss.employee_id, ss.location_id, ss.start_time
  from public.scheduled_shifts ss
  join public.employees e
    on e.id = ss.employee_id
   and e.active is true
   and e.role = 'picker'
  where ss.status = 'scheduled'
    and ss.date = (now() + interval '4 hours')::date
),
todays_clock_ins as (
  select distinct employee_id
  from public.clock_events
  where event_type = 'clock_in'
    and (timestamp + interval '4 hours')::date = (now() + interval '4 hours')::date
)
select
  l.id                                   as location_id,
  l.name                                 as location_name,
  c.name                                 as client,
  l.shift_start,                         -- location default (display only)
  l.shift_end,
  count(s.employee_id)                                                  as total_pickers,
  count(s.employee_id) filter (where ci.employee_id is not null)        as clocked_in_count,
  count(s.employee_id) filter (
    where ci.employee_id is null
      and (now() + interval '4 hours')::time >= s.start_time
  )                                                                     as missing_count,
  case
    when count(s.employee_id) = 0 then 'noshift'
    when count(s.employee_id) filter (where ci.employee_id is not null) = count(s.employee_id) then 'active'
    when count(s.employee_id) filter (where ci.employee_id is not null) = 0 then 'noshow'
    else 'late'
  end                                                                   as status
from public.locations l
left join public.clients   c  on c.id = l.client_id
left join sched            s  on s.location_id = l.id
left join todays_clock_ins ci on ci.employee_id = s.employee_id
where l.active is true
group by l.id, l.name, c.name, l.shift_start, l.shift_end;


-- ── Part C — detect_noshows() (strict; reads today's scheduled shift) ──────
-- A picker is flagged only if they have a status='scheduled' row today whose
-- start_time + 15 min has passed (GST) and they have not clocked in. No row →
-- not in the FROM → never flagged. One alert per picker per GST day.
create or replace function public.detect_noshows()
returns integer
language plpgsql
as $$
declare
  inserted integer;
  gst_day  date := (now() + interval '4 hours')::date;
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
        || to_char(ss.start_time, 'HH24:MI') || ' (GST).',
      e.id,
      ss.location_id,
      false,
      now()
    from public.scheduled_shifts ss
    join public.employees e on e.id = ss.employee_id
    join public.locations l on l.id = ss.location_id
    where ss.date = gst_day
      and ss.status = 'scheduled'
      and e.active = true
      and e.pin_set = true
      and e.role = 'picker'
      -- shift start + 15-minute grace has passed (GST)
      and (now() + interval '4 hours')::time > ss.start_time + interval '15 minutes'
      -- no clock-in today (GST day)
      and not exists (
        select 1 from public.clock_events ce
        where ce.employee_id = e.id
          and ce.event_type = 'clock_in'
          and (ce.timestamp + interval '4 hours')::date = gst_day
      )
      -- one per picker per day (don't re-raise after resolution)
      and not exists (
        select 1 from public.alerts a
        where a.employee_id = e.id
          and a.type = 'noshow'
          and (a.created_at + interval '4 hours')::date = gst_day
      )
    returning 1
  )
  select count(*) into inserted from flagged;
  return inserted;
end;
$$;


-- ── Part D — SAFETY: active PIN-set pickers with NO scheduled shift today ──
-- Run this BEFORE trusting the cutover. In strict mode these people are OFF
-- (invisible to no-show / auto-clockout). Make sure that's intentional — anyone
-- here who is actually meant to work today was left off the roster.
select count(*) as pickers_off_roster_today
from public.employees e
where e.active = true and e.pin_set = true and e.role = 'picker'
  and not exists (
    select 1 from public.scheduled_shifts ss
    where ss.employee_id = e.id
      and ss.date = (now() + interval '4 hours')::date
      and ss.status = 'scheduled'
  );

-- Who they are (so you can catch anyone wrongly omitted):
select
  e.employee_number,
  trim(e.first_name || ' ' || e.last_name) as name,
  l.name as assigned_location
from public.employees e
left join public.locations l on l.id = e.location_id
where e.active = true and e.pin_set = true and e.role = 'picker'
  and not exists (
    select 1 from public.scheduled_shifts ss
    where ss.employee_id = e.id
      and ss.date = (now() + interval '4 hours')::date
      and ss.status = 'scheduled'
  )
order by name;


-- ── Part E — Verify ────────────────────────────────────────────────────────
-- Live per-location aggregate from the new view:
-- select * from public.today_attendance order by location_name;

-- Dry-run the detector (inserts alerts for genuine no-shows; safe — deduped):
-- select public.detect_noshows() as alerts_inserted;

-- Cross-check the detector's candidate set without writing (who WOULD flag now):
-- select trim(e.first_name||' '||e.last_name) as name, l.name as location,
--        to_char(ss.start_time,'HH24:MI') as start_gst
-- from public.scheduled_shifts ss
-- join public.employees e on e.id = ss.employee_id
-- join public.locations l on l.id = ss.location_id
-- where ss.date = (now() + interval '4 hours')::date
--   and ss.status = 'scheduled'
--   and e.active and e.pin_set and e.role='picker'
--   and (now() + interval '4 hours')::time > ss.start_time + interval '15 minutes'
--   and not exists (select 1 from public.clock_events ce
--                   where ce.employee_id=e.id and ce.event_type='clock_in'
--                     and (ce.timestamp + interval '4 hours')::date = (now() + interval '4 hours')::date)
-- order by location, name;
