-- ============================================================================
-- Migration 0003 — Branch label on employees
-- Run in the Supabase SQL editor.
-- Free-text branch identifier captured at onboarding / CSV upload.
-- ============================================================================

alter table public.employees
  add column if not exists branch text;
