-- ============================================================================
-- Migration 0013 — Soft-void for rejected punches
-- Run this in the Supabase SQL editor (Database → SQL Editor → New query).
--
-- When a face-flag is REJECTED in review (not the right person), the committed
-- punch must be voided: the picker is no longer clocked in and the hours are
-- not counted — but the row stays for audit (payroll source data, never
-- deleted). These columns mark that state; the app + detection read paths will
-- exclude voided rows.
--
-- Additive + idempotent. No change to existing columns or to payroll/hours math
-- (a voided shift is simply excluded, not recomputed).
-- ============================================================================

alter table public.clock_events
  add column if not exists voided      boolean not null default false,
  add column if not exists voided_at   timestamptz,
  add column if not exists voided_by   uuid references public.ops_users(id) on delete set null,
  add column if not exists void_reason text;

alter table public.shifts
  add column if not exists voided      boolean not null default false,
  add column if not exists voided_at   timestamptz,
  add column if not exists voided_by   uuid references public.ops_users(id) on delete set null;

-- Verify:
-- select column_name from information_schema.columns
-- where table_schema='public' and table_name='clock_events' and column_name like 'void%';
-- select column_name from information_schema.columns
-- where table_schema='public' and table_name='shifts' and column_name='voided';
