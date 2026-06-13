-- ============================================================================
-- Migration 0004 — Phone normalization + E.164 CHECK, and shift-window fix
-- Run this in the Supabase SQL editor (Database → SQL Editor → New query).
--
-- IMPORTANT — run the parts IN ORDER and inspect between them:
--   Part A: create the normalizer function (safe, idempotent)
--   Part B: SELECT rows that WON'T normalize cleanly — hand-fix these first
--   Part C: normalize all existing phones to E.164
--   Part D: add the CHECK constraint (will FAIL if any row is still off-format,
--           which is exactly why Part B must be clean first)
--   Part E: fix any location whose shift_end <= shift_start (e.g. GH_MJN @ 00:00)
--
-- The app's src/lib/phone.ts mirrors normalize_uae_phone() exactly.
-- ============================================================================

-- ── Part A — Normalizer function ───────────────────────────────────────────
-- Mirrors src/lib/phone.ts: accepts +9715…, 9715…, 05…, 5…, 00971…, tolerating
-- spaces/dashes/parens; returns canonical '+9715XXXXXXXX' or NULL if invalid.
create or replace function public.normalize_uae_phone(raw text)
returns text
language plpgsql
immutable
as $$
declare d text;
begin
  if raw is null then return null; end if;
  d := regexp_replace(raw, '[^0-9]', '', 'g');   -- strip non-digits
  if d = '' then return null; end if;
  if left(d, 2) = '00'  then d := substr(d, 3); end if;  -- intl 00 prefix
  if left(d, 3) = '971' then d := substr(d, 4); end if;  -- country code
  if left(d, 1) = '0'   then d := substr(d, 2); end if;  -- local trunk 0
  if d ~ '^5[0-9]{8}$' then
    return '+971' || d;
  end if;
  return null;
end;
$$;


-- ── Part B — Inspect rows that will NOT normalize (RUN THIS FIRST) ──────────
-- Hand-fix every row this returns BEFORE running Part C/D, otherwise the CHECK
-- in Part D will reject them. (Empty result = you're good to proceed.)
select id, employee_number, first_name, last_name, phone
from public.employees
where normalize_uae_phone(phone) is null
order by created_at;


-- ── Part C — Normalize all existing phones to E.164 ────────────────────────
-- Only touches rows that normalize cleanly AND actually change.
update public.employees
set phone = normalize_uae_phone(phone)
where normalize_uae_phone(phone) is not null
  and phone is distinct from normalize_uae_phone(phone);


-- ── Part D — Enforce E.164 format going forward ────────────────────────────
-- Mirrors the app/regex: ^\+9715[0-9]{8}$
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'employees_phone_e164_chk'
  ) then
    alter table public.employees
      add constraint employees_phone_e164_chk
      check (phone ~ '^\+9715[0-9]{8}$');
  end if;
end $$;


-- ── Part E — Shift-window data fix (no overnight shifts) ───────────────────
-- First inspect any location whose shift_end is not strictly after shift_start
-- (this includes GH_MJN, which has shift_end = 00:00):
select id, name, shift_start, shift_end
from public.locations
where shift_end is not null
  and shift_start is not null
  and shift_end <= shift_start;

-- Then fix each one. Set the correct end time per location. Example — adjust
-- the time to the real end of GH_MJN's shift before running:
--   update public.locations set shift_end = '19:00:00' where name = 'GH_MJN';
