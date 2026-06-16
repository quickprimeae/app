// src/app/dashboard/roster/page.tsx
// The week roster grid (schedule source of truth). Loads the active pickers,
// locations, and every scheduled_shift for the selected Mon–Sun week, then
// hands them to RosterClient for display + inline editing.

import { redirect } from 'next/navigation'
import { getOpsContext } from '@/lib/ops'
import { createServerSupabaseClient } from '@/lib/supabase'
import { mondayOfISO, weekDatesISO, addDaysISO } from '@/lib/schedule'
import RosterClient, { type RosterEmployee, type RosterLocation, type RosterShift } from './RosterClient'

export const dynamic = 'force-dynamic'

export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>
}) {
  const ctx = await getOpsContext()
  if (!ctx) redirect('/login')
  if (!ctx.opsUser) redirect('/dashboard')
  const tenantId = ctx.opsUser.tenant_id

  const { week } = await searchParams
  // Default to the current week in GST (UTC+4). Snap any provided date to Monday.
  const gstTodayIso = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10)
  const base = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : gstTodayIso
  const weekStart = mondayOfISO(base)
  const dates = weekDatesISO(weekStart)

  const supabase = createServerSupabaseClient()
  const [locRes, empRes, shiftRes] = await Promise.all([
    supabase
      .from('locations')
      .select('id, name, shift_start, shift_end')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('name', { ascending: true }),
    supabase
      .from('employees')
      .select('id, employee_number, first_name, last_name, location_id, branch')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .eq('role', 'picker')
      .order('first_name', { ascending: true }),
    supabase
      .from('scheduled_shifts')
      .select('id, employee_id, location_id, date, start_time, end_time, status, origin, reassigned_to_employee_id')
      .eq('tenant_id', tenantId)
      .gte('date', dates[0])
      .lte('date', dates[6]),
  ])

  const locations: RosterLocation[] = ((locRes.data ?? []) as any[]).map((l) => ({
    id: l.id,
    name: l.name,
    shiftStart: l.shift_start ?? null,
    shiftEnd: l.shift_end ?? null,
  }))
  const employees: RosterEmployee[] = ((empRes.data ?? []) as any[]).map((e) => ({
    id: e.id,
    empId: e.employee_number || e.id.slice(0, 8),
    name: `${e.first_name} ${e.last_name}`.trim(),
    locationId: e.location_id ?? null,
    branch: e.branch ?? null,
  }))
  const shifts: RosterShift[] = ((shiftRes.data ?? []) as any[]).map((s) => ({
    id: s.id,
    employeeId: s.employee_id,
    locationId: s.location_id,
    date: s.date,
    start: (s.start_time ?? '').slice(0, 5),
    end: (s.end_time ?? '').slice(0, 5),
    status: s.status,
    origin: s.origin,
    reassignedTo: s.reassigned_to_employee_id ?? null,
  }))

  return (
    <RosterClient
      weekStart={weekStart}
      dates={dates}
      prevWeek={addDaysISO(weekStart, -7)}
      nextWeek={addDaysISO(weekStart, 7)}
      employees={employees}
      locations={locations}
      shifts={shifts}
    />
  )
}
