-- ============================================================================
-- Migration 0008 — Grant the API service role access to the Phase 4 tables
-- Run this in the Supabase SQL editor (Database → SQL Editor → New query).
--
-- Why: migration 0007 created scheduled_shifts / schedule_templates /
-- audit_logs and enabled RLS deny-by-default. The app reaches them only through
-- the secret-key server client (createServerSupabaseClient), which resolves to
-- the `service_role`. service_role has BYPASSRLS, so RLS is not the blocker —
-- the tables were just never granted to it, which is why every read/write hit
-- "permission denied for table scheduled_shifts".
--
-- This grants exactly that role the table privileges it needs. RLS stays
-- enabled (so the browser/publishable key remains locked out); service_role
-- bypasses RLS, so the server routes and the roster page reads start working.
-- Idempotent: GRANT is a no-op if the privilege already exists.
-- ============================================================================

grant select, insert, update, delete
  on public.scheduled_shifts,
     public.schedule_templates,
     public.audit_logs
  to service_role;


-- ── Verify ──────────────────────────────────────────────────────────────────
-- Expect service_role rows with SELECT/INSERT/UPDATE/DELETE for all 3 tables.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('scheduled_shifts', 'schedule_templates', 'audit_logs')
  and grantee = 'service_role'
order by table_name, privilege_type;
