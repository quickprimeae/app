-- ============================================================================
-- Migration 0012 — Alert review outcome (face-flag Approve / Reject)
-- Run this in the Supabase SQL editor (Database → SQL Editor → New query).
--
-- The face-flag review queue needs to record HOW a flag was reviewed, distinct
-- from the generic `resolved`:
--   • Approve (it IS them) -> resolved = true, review_result = 'approved'
--   • Reject  (NOT them)   -> review_result = 'rejected', kept OPEN/escalated
--     (resolved stays false so it remains actionable in the queue)
-- plus who reviewed it and when.
--
-- Additive + idempotent. No change to existing columns, payroll, or anything
-- else. (The born-resolved insert bug is already fixed in code, separately.)
-- ============================================================================

alter table public.alerts
  add column if not exists review_result text
    check (review_result in ('approved', 'rejected')),
  add column if not exists reviewed_by uuid references public.ops_users(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

-- Verify:
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'alerts'
--   and column_name in ('review_result', 'reviewed_by', 'reviewed_at');
