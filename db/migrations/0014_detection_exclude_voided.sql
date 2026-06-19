-- ============================================================================
-- Migration 0014 — Exclude voided clock-ins from detection
-- Run this in the Supabase SQL editor (Database → SQL Editor → New query),
-- AFTER 0013 (the voided columns) is applied.
--
-- A clock-in voided by a rejected face-flag must drop out of attendance: the
-- picker becomes a no-show again and is never auto-clocked-out. The ONLY change
-- vs the 0009 definitions is adding the voided filter on the clock_events read:
--   today_attendance     -> todays_clock_ins CTE: + and voided = false
--   detect_noshows()     -> the "no clock-in today" NOT EXISTS: + and ce.voided = false
--   auto_clockout_missed -> the cursor's clock-in filter: + and not ce.voided
-- Everything else (strict scheduled_shifts logic, GST math, hours math, the
-- inserts) is byte-for-byte the 0009 version. No payroll/threshold/geofence
-- change.
--
-- Run the parts in order.
--   A. auto_clockout_missed()  B. today_attendance  C. detect_noshows()
-- ============================================================================


-- ── Part A — auto_clockout_missed() (+ and not ce.voided) ──────────────────
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
        ss.end_time    as shift_end,
        e.hourly_rate,
        e.first_name,
        e.last_name
      from clock_events ce
      join locations l on l.id = ce.location_id
      join employees  e on e.id = ce.employee_id
      join scheduled_shifts ss
        on ss.employee_id = ce.employee_id
       and ss.date        = (now() + interval '4 hours')::date
       and ss.status      = 'scheduled'
      where
        ce.event_type        = 'clock_in'
        and not ce.voided                              -- 0014: skip voided clock-ins
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
        and (now() + interval '4 hours') > (current_date + ss.end_time + interval '30 minutes')
    loop
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


-- ── Part B — today_attendance (+ and voided = false) ───────────────────────
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
    and voided = false                                 -- 0014: ignore voided clock-ins
    and (timestamp + interval '4 hours')::date = (now() + interval '4 hours')::date
)
select
  l.id                                   as location_id,
  l.name                                 as location_name,
  c.name                                 as client,
  l.shift_start,
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


-- ── Part C — detect_noshows() (+ and ce.voided = false) ────────────────────
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
      and (now() + interval '4 hours')::time > ss.start_time + interval '15 minutes'
      -- no NON-VOIDED clock-in today (GST day)
      and not exists (
        select 1 from public.clock_events ce
        where ce.employee_id = e.id
          and ce.event_type = 'clock_in'
          and ce.voided = false                        -- 0014: a voided clock-in doesn't count
          and (ce.timestamp + interval '4 hours')::date = gst_day
      )
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
