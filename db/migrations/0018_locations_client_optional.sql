-- ============================================================================
-- Migration 0018 - Make locations.client_id optional (nullable)
-- Run this in the Supabase SQL editor. Pure ASCII. Idempotent; safe to re-run.
--
-- Why: the Add/Edit Location form is dropping its required "Client" field. A
-- location no longer has to belong to a client, so client_id must be nullable.
-- The API (api/locations) stops requiring client_id and inserts NULL when none
-- is given; this migration removes the matching NOT NULL constraint on the
-- column so those inserts succeed.
--
-- Safe for existing data: rows that already have a client_id keep it untouched
-- (this only drops the NOT NULL constraint, it does not clear any values).
--
-- Safe for downstream reads: every view/query that uses the client joins it with
-- LEFT JOIN public.clients c ON c.id = l.client_id (see migrations 0001, 0009,
-- 0014), so a NULL client_id simply yields NULL client columns - no row is lost.
--
-- The foreign key on client_id (if present) is unaffected: a FK permits NULL
-- once the column is nullable. Idempotent: DROP NOT NULL is a no-op if the
-- column is already nullable.
-- ============================================================================

alter table public.locations
  alter column client_id drop not null;


-- -- Verify --------------------------------------------------------------------
-- Expect is_nullable = YES for client_id after running.
select column_name, is_nullable, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'locations'
  and column_name = 'client_id';
