-- ============================================================================
-- Migration 0002 — Monthly salary + shift type on employees
-- Run in the Supabase SQL editor.
--
-- hourly_rate is derived on the backend as monthly_salary / 26 / shift_hours
-- (shift_hours = 8 for '8h', 10 for '10h') and still stored on employees +
-- snapshotted onto shifts. We also persist the source values for payroll
-- display.
-- ============================================================================

alter table public.employees
  add column if not exists monthly_salary numeric,
  add column if not exists shift_type     text;   -- '8h' | '10h'

-- Constrain shift_type to the supported values (nulls allowed for legacy rows).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'employees_shift_type_check'
  ) then
    alter table public.employees
      add constraint employees_shift_type_check
      check (shift_type is null or shift_type in ('8h', '10h'));
  end if;
end $$;
