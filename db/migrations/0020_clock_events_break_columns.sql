-- ============================================================================
-- Migration 0020 - Break columns on clock_events (one break per shift)
-- Run this in the Supabase SQL editor. Pure ASCII. Idempotent; safe to re-run.
--
-- Why: a picker can take ONE break per shift. The break is recorded live, while
-- the shift is still open - at that moment only the clock_in row exists in
-- clock_events (the paired public.shifts row is not created until clock-out), so
-- the break must live on clock_events. These columns hang off the day's
-- clock_in event.
--
-- All three are nullable and additive: existing rows are unaffected and existing
-- punch / attendance / detection / auto-clockout logic keeps working untouched
-- (nothing reads these columns yet - app wiring is a later step).
--
--   break_started_at    timestamptz - when the break began (null = no break yet)
--   break_ended_at      timestamptz - when the break ended (null = still on break
--                                     or never started)
--   break_ended_reason  text        - how it ended: 'auto' | 'manual' | 'clockout'
-- ============================================================================

alter table public.clock_events
  add column if not exists break_started_at   timestamptz null;

alter table public.clock_events
  add column if not exists break_ended_at      timestamptz null;

alter table public.clock_events
  add column if not exists break_ended_reason  text null;


-- -- Verify --------------------------------------------------------------------
-- Expect three rows, all is_nullable = YES.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'clock_events'
  and column_name in ('break_started_at', 'break_ended_at', 'break_ended_reason')
order by column_name;
