-- ============================================================================
-- Migration 0011 — Employee face descriptor (on-device face matching)
-- Run this in the Supabase SQL editor (Database → SQL Editor → New query).
--
-- Stores the 128-float face descriptor computed ON-DEVICE from the employee's
-- reference photo. It is just an array of numbers, never an image — the face
-- never leaves the device / our own storage and is never sent to a third-party
-- API (UAE data-residency). At punch we compute the live descriptor on-device
-- and compare (euclidean distance) against this stored array.
--
-- Employees with no reference photo have NULL here and are handled downstream
-- (auto-flag for review rather than silently passing).
-- ============================================================================

alter table public.employees
  add column if not exists face_descriptor jsonb;

-- Verify:
-- select count(*) filter (where face_descriptor is not null) as with_descriptor,
--        count(*) filter (where face_descriptor is null)     as without
-- from public.employees where role = 'picker' and active;
