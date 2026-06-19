-- ============================================================================
-- Migration 0015 — Exclude voided shifts from monthly_hours
-- Run this in the Supabase SQL editor (Database → SQL Editor → New query),
-- AFTER 0013 (shifts.voided) is applied.
--
-- monthly_hours is the payroll/hours aggregate (feeds the roster's monthly
-- hours/earnings and the payroll summary). A shift voided by a rejected
-- face-flag must not count toward monthly totals.
--
-- This re-issues the view BYTE-FOR-BYTE from its current definition
-- (pg_get_viewdef) with ONE addition: a WHERE clause between the JOIN and the
-- GROUP BY. Same SELECT list, same COALESCE(s.hours_final, s.hours_raw, 0)
-- logic, same FILTER counts, same GROUP BY. voided is NOT NULL DEFAULT false,
-- so plain "= false" is safe (consistent with 0014).
-- ============================================================================

create or replace view public.monthly_hours as
 SELECT s.employee_id,
    (e.first_name || ' '::text) || e.last_name AS employee_name,
    e.employee_number,
    s.hourly_rate,
    e.location_id,
    EXTRACT(month FROM s.date)::integer AS month,
    EXTRACT(year FROM s.date)::integer AS year,
    count(s.id) AS shifts_worked,
    sum(COALESCE(s.hours_final, s.hours_raw, 0::numeric)) AS total_hours,
    sum(COALESCE(s.hours_final, s.hours_raw, 0::numeric)) * s.hourly_rate AS gross_pay,
    count(s.id) FILTER (WHERE s.is_auto_clockout) AS auto_clockouts,
    count(s.id) FILTER (WHERE s.needs_review) AS pending_reviews
   FROM shifts s
     JOIN employees e ON e.id = s.employee_id
  WHERE s.voided = false                                 -- 0015: exclude voided shifts
  GROUP BY s.employee_id, e.first_name, e.last_name, e.employee_number, s.hourly_rate, e.location_id, (EXTRACT(month FROM s.date)), (EXTRACT(year FROM s.date));
