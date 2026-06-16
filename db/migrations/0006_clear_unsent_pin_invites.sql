-- ============================================================================
-- Migration 0006 — Clear stale PIN-setup stamps (invites page is now the only
-- invite source)
-- Run this in the Supabase SQL editor (Database → SQL Editor → New query).
--
-- Background: employee creation used to auto-mint a PIN-setup token + 24h
-- expiry (and auto-send a WhatsApp invite) at signup. That made the Pending
-- invites page show "Link expired" for anyone created > 24h ago who was never
-- actively re-invited — when it should read "Not sent yet". The app no longer
-- stamps a token at creation; the invite is generated/sent explicitly from the
-- Pending invites page.
--
-- This migration backfills the existing data to match: for employees who have
-- NOT set a PIN and whose stamped link has already EXPIRED, clear the stamp so
-- they reset to "Not sent yet". Employees with a still-valid (future) link are
-- left untouched, so an in-progress setup is not broken.
--
-- Idempotent: re-running is a no-op once the rows are cleared.
-- ============================================================================


-- ── Part A — Inspect what WILL be cleared (run this first) ──────────────────
-- These pin_set = false employees have an expired setup stamp and will reset
-- to "Not sent yet".
select id, employee_number, first_name, last_name, phone, pin_setup_expires
from public.employees
where pin_set = false
  and pin_setup_expires is not null
  and pin_setup_expires < now()
order by created_at;


-- ── Part B — (reference) rows that will be LEFT ALONE ──────────────────────
-- pin_set = false with a still-valid link (future expiry) — a real pending
-- invite, kept as-is.
-- select id, employee_number, first_name, last_name, pin_setup_expires
-- from public.employees
-- where pin_set = false
--   and pin_setup_expires is not null
--   and pin_setup_expires >= now()
-- order by created_at;


-- ── Part C — Clear the expired stamps ──────────────────────────────────────
update public.employees
set pin_setup_token_hash = null,
    pin_setup_expires = null
where pin_set = false
  and pin_setup_expires is not null
  and pin_setup_expires < now();


-- ── Part D — Verify ────────────────────────────────────────────────────────
-- Expect every pin_set = false employee to now have either a NULL expiry
-- ("Not sent yet") or a future expiry ("Active, expires in Xh") — none in the past.
select
  count(*) filter (where pin_setup_expires is null)               as not_sent_yet,
  count(*) filter (where pin_setup_expires >= now())              as active_link,
  count(*) filter (where pin_setup_expires < now())               as still_expired
from public.employees
where pin_set = false;
