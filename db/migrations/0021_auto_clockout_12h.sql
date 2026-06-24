-- ============================================================================
-- Migration 0021 - Auto clock-out at clock_in + 12h (drop shift-end dependency)
-- Run this in the Supabase SQL editor. Pure ASCII. Idempotent (create or
-- replace). Only the auto_clockout_missed() body changes - the existing
-- "auto-clockout-missed-hourly" cron job (0 * * * *, calls this function) is
-- left exactly as-is.
--
-- What changes vs the previous version (migration 0014):
--   * Trigger source is now the CLOCK-IN time, not the roster. A clock-in with
--     no matching clock-out is auto-closed once 12h have elapsed since clock-in.
--   * The recorded clock-out timestamp is clock_in + 12h (was: scheduled shift
--     end).
--   * The join to scheduled_shifts is removed entirely - auto clock-out no
--     longer depends on a roster row existing.
--
-- Unchanged: still security definer; still writes a clock_out event + a pending
-- shifts row (needs_review) + a warning alert; still skips voided clock-ins and
-- anything already clocked out / already closed into a shift. The break columns
-- (0020) are NOT touched here.
--
-- Safety bound: only clock-ins from the last 36h are considered, so the hourly
-- job reliably catches the 12h mark without ever resurrecting ancient orphaned
-- punches.
-- ============================================================================

create or replace function public.auto_clockout_missed()
 returns void
 language plpgsql
 security definer
as $function$
  declare
    r               record;
    auto_out_time   timestamptz;
    shift_date      date;
    new_clockout_id uuid;
  begin
    for r in
      select
        ce.id          as clock_in_event_id,
        ce.employee_id,
        ce.location_id,
        ce.tenant_id,
        ce.timestamp   as clock_in_time,
        e.hourly_rate,
        e.first_name,
        e.last_name
      from clock_events ce
      join employees e on e.id = ce.employee_id
      where
        ce.event_type = 'clock_in'
        and not ce.voided
        and ce.timestamp > now() - interval '36 hours'          -- safety bound
        and now() > ce.timestamp + interval '12 hours'          -- 12h since clock-in
        and not exists (
          select 1 from clock_events co
          where co.employee_id = ce.employee_id
            and co.event_type  = 'clock_out'
            and co.timestamp   >= ce.timestamp                  -- a clock-out after this clock-in
        )
        and not exists (
          select 1 from shifts s
          where s.clock_in_event_id = ce.id                     -- already closed into a shift
        )
    loop
      auto_out_time := r.clock_in_time + interval '12 hours';
      shift_date    := (r.clock_in_time at time zone 'Asia/Dubai')::date;

      insert into clock_events (
        tenant_id, employee_id, location_id,
        event_type, timestamp,
        is_auto_clockout, auto_clockout_note,
        geofence_passed, pin_verified
      ) values (
        r.tenant_id, r.employee_id, r.location_id,
        'clock_out', auto_out_time,
        true, 'Auto clock-out: no manual clock-out within 12h of clock-in',
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
        shift_date, r.clock_in_event_id, new_clockout_id,
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
        'No clock-out recorded. Auto-closed 12h after clock-in, at ' ||
          to_char(auto_out_time at time zone 'Asia/Dubai', 'HH24:MI') ||
          '. Verify before payroll.'
      );
    end loop;
  end;
  $function$;


-- -- Verify --------------------------------------------------------------------
-- 1) Confirm the new body is in place (should mention '12 hours'):
--    select pg_get_functiondef('public.auto_clockout_missed'::regproc);
-- 2) Confirm the cron job still points at it, unchanged:
--    select jobname, schedule, command, active from cron.job
--    where jobname = 'auto-clockout-missed-hourly';
-- 3) Dry-run preview (no writes) - clock-ins that WOULD auto-close right now:
--    select ce.employee_id, ce.timestamp as clock_in,
--           ce.timestamp + interval '12 hours' as would_close_at
--    from clock_events ce
--    where ce.event_type = 'clock_in' and not ce.voided
--      and ce.timestamp > now() - interval '36 hours'
--      and now() > ce.timestamp + interval '12 hours'
--      and not exists (select 1 from clock_events co
--                      where co.employee_id = ce.employee_id
--                        and co.event_type = 'clock_out' and co.timestamp >= ce.timestamp)
--      and not exists (select 1 from shifts s where s.clock_in_event_id = ce.id);
