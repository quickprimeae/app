-- ============================================================================
-- Migration 0017 - Grant the API service role access to the vendors table
-- Run this in the Supabase SQL editor. Pure ASCII. Idempotent.
--
-- Why: migration 0016 created public.vendors but never granted it to the
-- `service_role`. The app reaches every table through the secret-key server
-- client (createServerSupabaseClient), which resolves to service_role. Without
-- this grant, the dashboard's employees query (now embedding vendors for the
-- per-picker supervisor) and the bulk-import vendor lookup both fail with
-- "permission denied for table vendors". Same fix pattern as migration 0008.
--
-- service_role bypasses RLS, so a SELECT grant is enough for reads; INSERT is
-- included so vendors can be managed server-side later. Idempotent: GRANT is a
-- no-op if the privilege already exists.
-- ============================================================================

grant select, insert, update, delete
  on public.vendors
  to service_role;


-- -- Verify --------------------------------------------------------------------
-- Expect a service_role row per privilege (SELECT/INSERT/UPDATE/DELETE).
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'vendors'
  and grantee = 'service_role'
order by privilege_type;
