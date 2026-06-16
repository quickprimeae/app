// src/lib/employees-data.ts
// SERVER-ONLY. Assembles the employee roster with today's clock status and
// this month's hours/earnings (joined from clock_events + monthly_hours view).

import { createServerSupabaseClient } from './supabase'
import { deriveStatus, type DerivedStatus } from './status'

export type EmployeeStatus = DerivedStatus
export type EmployeeRow = {
  id: string // uuid
  empId: string // employee_number
  firstName: string
  lastName: string
  name: string
  initials: string
  nationality: string | null
  phone: string
  locationId: string | null
  location: string
  branch: string | null
  client: string | null
  supervisor: string | null
  startDate: string | null
  hourlyRate: number
  shiftDays: string | null
  shiftHours: string
  personalShift: boolean
  status: DerivedStatus
  clockedInAt: string | null
  hoursThisMonth: number
  earnedThisMonth: number
  hasPhoto: boolean
  flagged: boolean
  active: boolean
  pinSet: boolean
}

function timeToMinutes(t: string | null): number | null {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export async function getEmployeesList(tenantId: string): Promise<EmployeeRow[]> {
  const supabase = createServerSupabaseClient()
  const today = new Date().toISOString().split('T')[0]
  const month = new Date().getMonth() + 1
  const year = new Date().getFullYear()

  const [empRes, locRes, evtRes, hoursRes] = await Promise.all([
    supabase
      .from('employees')
      .select('id, employee_number, first_name, last_name, phone, nationality, location_id, branch, hourly_rate, shift_days, shift_start, shift_end, has_photo, active, pin_set, start_date, supervisor:ops_users(name)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    supabase
      .from('locations')
      .select('id, name, shift_start, shift_end, client:clients(name)')
      .eq('tenant_id', tenantId),
    supabase
      .from('clock_events')
      .select('employee_id, timestamp, face_match_flagged')
      .eq('tenant_id', tenantId)
      .eq('event_type', 'clock_in')
      .gte('timestamp', `${today}T00:00:00Z`)
      .lte('timestamp', `${today}T23:59:59Z`),
    supabase
      .from('monthly_hours')
      .select('employee_id, total_hours, gross_pay')
      .eq('month', month)
      .eq('year', year),
  ])

  const employees = (empRes.data ?? []) as any[]
  const locById = new Map(((locRes.data ?? []) as any[]).map((l) => [l.id, l]))
  const events = (evtRes.data ?? []) as any[]
  const hoursByEmp = new Map(((hoursRes.data ?? []) as any[]).map((h) => [h.employee_id, h]))

  // Current time-of-day in Gulf Standard Time (UTC+4) to decide whether a
  // shift has started — same convention as the live dashboard. No overnight
  // shifts, so a same-day minutes-since-midnight comparison is sufficient.
  const nowD = new Date()
  const nowMin = (nowD.getUTCHours() * 60 + nowD.getUTCMinutes() + 240) % 1440

  const clockByEmp = new Map<string, { timestamp: string; flagged: boolean }>()
  for (const e of events) {
    const existing = clockByEmp.get(e.employee_id)
    if (!existing || e.timestamp < existing.timestamp) {
      clockByEmp.set(e.employee_id, { timestamp: e.timestamp, flagged: !!e.face_match_flagged })
    }
  }

  return employees.map((e) => {
    const loc = e.location_id ? locById.get(e.location_id) : null
    const ev = clockByEmp.get(e.id)
    const hours = hoursByEmp.get(e.id)

    // Effective shift = employee's own times if set, else the location default.
    const effStart: string | null = e.shift_start ?? loc?.shift_start ?? null
    const effEnd: string | null = e.shift_end ?? loc?.shift_end ?? null

    // Derived status: deactivated > awaiting_setup > clocked_in/late > ready/absent.
    // A shift with no start time is treated as already due (shiftStarted = true).
    const shiftStartMin = timeToMinutes(effStart)
    let late = false
    if (ev) {
      // Compare clock-in against the shift start in GST (UTC+4); shifts never
      // cross midnight.
      const d = new Date(ev.timestamp)
      const clockMin = (d.getUTCHours() * 60 + d.getUTCMinutes() + 240) % 1440
      late = shiftStartMin != null && clockMin > shiftStartMin + 5
    }
    const status = deriveStatus({
      active: !!e.active,
      pinSet: !!e.pin_set,
      clockedIn: !!ev,
      late,
      shiftStarted: shiftStartMin == null ? true : nowMin >= shiftStartMin,
    })

    const rate = Number(e.hourly_rate) || 0
    const hoursThisMonth = Number(hours?.total_hours) || 0
    const earned = hours?.gross_pay != null ? Number(hours.gross_pay) : Math.round(hoursThisMonth * rate * 100) / 100

    return {
      id: e.id,
      empId: e.employee_number || e.id.slice(0, 8),
      firstName: e.first_name,
      lastName: e.last_name,
      name: `${e.first_name} ${e.last_name}`.trim(),
      initials: `${e.first_name?.[0] ?? ''}${e.last_name?.[0] ?? ''}`.toUpperCase(),
      nationality: e.nationality ?? null,
      phone: e.phone,
      locationId: e.location_id ?? null,
      location: loc?.name ?? 'Unassigned',
      branch: e.branch ?? null,
      client: loc?.client?.name ?? null,
      supervisor: e.supervisor?.name ?? null,
      startDate: e.start_date ?? null,
      hourlyRate: rate,
      shiftDays: e.shift_days ?? null,
      shiftHours: effStart && effEnd ? `${effStart.slice(0, 5)}–${effEnd.slice(0, 5)}` : '—',
      personalShift: !!(e.shift_start && e.shift_end),
      status,
      clockedInAt: ev?.timestamp ?? null,
      hoursThisMonth,
      earnedThisMonth: earned,
      hasPhoto: !!e.has_photo,
      flagged: !!ev?.flagged,
      active: !!e.active,
      pinSet: !!e.pin_set,
    }
  })
}
