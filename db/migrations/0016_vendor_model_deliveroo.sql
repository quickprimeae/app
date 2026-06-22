-- ============================================================================
-- Migration 0016 - Vendor model (per-employee) + Deliveroo-only demo repoint
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
-- Tenant: 678151ad-d086-4164-b187-c2804d21cb54
--
-- Verified against live schema before writing:
--   clients   Talabat   = d91c5bb7-88d8-444a-986c-2df67982bab1  (KEPT, 0 assigned)
--             Deliveroo = 18af7dec-ae52-4fdd-add9-45a900d989ab  (existing; reused)
--   client_id columns exist on: locations, invoices. Invoices on Talabat = 0,
--   so only locations are repointed. Detection/payroll views read client via a
--   join on locations.client_id, so they follow automatically.
--   shift_type already populated for all 9 pickers - NOT touched here.
-- ============================================================================

-- -- PART A: Repoint all locations Talabat -> existing Deliveroo row ----------
update public.locations
   set client_id = '18af7dec-ae52-4fdd-add9-45a900d989ab'   -- Deliveroo (existing)
 where tenant_id = '678151ad-d086-4164-b187-c2804d21cb54'
   and client_id = 'd91c5bb7-88d8-444a-986c-2df67982bab1';  -- from Talabat
-- Talabat row itself is left in place (0 locations) for a future internal view.

-- -- PART B: Vendor model (per-employee) -------------------------------------
-- B1. vendors table
create table if not exists public.vendors (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid,
  name            text,
  supervisor_name text,
  created_at      timestamptz default now()
);

-- B2. Seed the two vendors (guarded so a re-run does not duplicate)
insert into public.vendors (tenant_id, name, supervisor_name)
select '678151ad-d086-4164-b187-c2804d21cb54', v.name, v.supervisor_name
from (values
  ('Al Jasar', 'Saad'),     -- note exact spelling: "Al Jasar"
  ('SkillSet', 'Iflaam')
) as v(name, supervisor_name)
where not exists (
  select 1 from public.vendors x
   where x.tenant_id = '678151ad-d086-4164-b187-c2804d21cb54'
     and x.name = v.name
);

-- B3. employees.vendor_id (nullable) + FK -> vendors(id)
alter table public.employees
  add column if not exists vendor_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'employees_vendor_id_fkey'
  ) then
    alter table public.employees
      add constraint employees_vendor_id_fkey
      foreign key (vendor_id) references public.vendors(id);
  end if;
end $$;

-- B4. Backfill vendor_id by employee_number (scoped to tenant)
update public.employees e
   set vendor_id = (select id from public.vendors
                     where tenant_id = '678151ad-d086-4164-b187-c2804d21cb54'
                       and name = 'Al Jasar')
 where e.tenant_id = '678151ad-d086-4164-b187-c2804d21cb54'
   and e.employee_number in ('QP-0001','QP-0002','QP-0003','QP-0005','QP-0006');

update public.employees e
   set vendor_id = (select id from public.vendors
                     where tenant_id = '678151ad-d086-4164-b187-c2804d21cb54'
                       and name = 'SkillSet')
 where e.tenant_id = '678151ad-d086-4164-b187-c2804d21cb54'
   and e.employee_number in ('QP-0004','QP-0007');
-- QP-0010, QP-0011 intentionally left vendor_id NULL (test users).

-- -- VERIFICATION (run after; expected results in comments) ------------------
-- A: expect Talabat 0, Deliveroo 4
select c.name, count(l.id) as locations
  from public.clients c
  left join public.locations l
    on l.client_id = c.id
   and l.tenant_id = '678151ad-d086-4164-b187-c2804d21cb54'
 where c.tenant_id = '678151ad-d086-4164-b187-c2804d21cb54'
 group by c.name
 order by c.name;

-- B: expect Al Jasar 5, SkillSet 2, (null) 2
select coalesce(v.name, '(null)') as vendor, count(e.id) as pickers
  from public.employees e
  left join public.vendors v on v.id = e.vendor_id
 where e.tenant_id = '678151ad-d086-4164-b187-c2804d21cb54'
 group by v.name
 order by v.name nulls last;
