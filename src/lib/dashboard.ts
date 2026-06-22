// src/lib/dashboard.ts
// SERVER-ONLY. Assembles the live dashboard payload from base tables so the
// per-picker breakdown stays consistent (today_attendance is aggregate-only).
// Used by the /dashboard server component and the /api/attendance refresh route.

import { createServerSupabaseClient } from './supabase'
import { deriveStatus, type DerivedStatus } from './status'

export type PickerStatus = DerivedStatus
export type LocationStatus = 'active' | 'late' | 'noshow' | 'noshift'

export type DashPicker = {
  id: string
  name: string
  status: PickerStatus
  clockedInAt: string | null
  flagged: boolean
  // Vendor model: shift_type is read DIRECTLY from employees (never derived from
  // roster duration); rosterShift is today's scheduled time (null = none yet);
  // supervisor is the picker's VENDOR supervisor (null when vendor_id is null).
  shiftType: string | null
  rosterShift: string | null
  supervisor: string | null
}
export type DashLocation = {
  id: string
  name: string
  client: string | null
  area: string | null
  supervisor: string | null
  status: LocationStatus
  total: number
  clockedIn: number
  shiftStart: string | null
  shiftEnd: string | null
  pickers: DashPicker[]
}
export type DashAlert = {
  id: string
  type: 'red' | 'amber'
  icon: string
  title: string
  sub: string
  time: string
}
export type DashKpis = {
  active: number
  totalLocations: number
  clockedIn: number
  totalPickers: number
  noshow: number
  late: number
  flagged: number
}
export type DashboardData = {
  locations: DashLocation[]
  alerts: DashAlert[]
  kpis: DashKpis
}

const ALERT_ICON: Record<string, string> = {
  noshow: '🚨',
  late: '⚠️',
  faceflag: '🔍',
  clockout: '⏹',
  system: '🔔',
}

function hhmm(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

// "Muhammad Hassan" -> "Muhammad H." so duplicate first names are distinguishable
// on the dashboard chips.
function shortName(first: string, last: string | null): string {
  const f = (first ?? '').trim()
  const li = (last ?? '').trim()[0]
  return li ? `${f} ${li.toUpperCase()}.` : f
}

export async function getDashboardData(tenantId: string): Promise<DashboardData> {
  const supabase = createServerSupabaseClient()
  const today = new Date().toISOString().split('T')[0]

  const [locRes, empRes, evtRes, alertRes, schedRes] = await Promise.all([
    supabase
      .from('locations')
      .select('id, name, chain, area, shift_start, shift_end, client:clients(name)')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('name', { ascending: true }),
    supabase
      .from('employees')
      .select('id, first_name, last_name, employee_number, location_id, shift_start, shift_end, pin_set, shift_type, supervisor:ops_users(name), vendor:vendors(supervisor_name)')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .eq('role', 'picker'),
    supabase
      .from('clock_events')
      .select('employee_id, timestamp, face_match_flagged')
      .eq('tenant_id', tenantId)
      .eq('event_type', 'clock_in')
      .eq('voided', false)
      .gte('timestamp', `${today}T00:00:00Z`)
      .lte('timestamp', `${today}T23:59:59Z`),
    supabase
      .from('alerts')
      .select('id, type, severity, title, body, created_at, employee_id, review_result')
      .eq('tenant_id', tenantId)
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(100),
    // Today's rostered shift per picker (concrete schedule, not store timings).
    supabase
      .from('scheduled_shifts')
      .select('employee_id, start_time, end_time')
      .eq('tenant_id', tenantId)
      .eq('date', today)
      .eq('status', 'scheduled'),
  ])

  // Cast embedded relations to any: without generated DB types, supabase-js
  // infers to-one embeds (client, supervisor) as arrays.
  const locations = (locRes.data ?? []) as any[]
  const employees = (empRes.data ?? []) as any[]
  const events = (evtRes.data ?? []) as { employee_id: string; timestamp: string; face_match_flagged: boolean | null }[]
  const alertRows = (alertRes.data ?? []) as any[]
  const scheduled = (schedRes.data ?? []) as { employee_id: string; start_time: string; end_time: string }[]

  // employee_id -> today's rostered "HH:MM-HH:MM" (unique per employee+date).
  const hm = (t: string | null) => (t ? t.slice(0, 5) : null)
  const rosterByEmployee = new Map<string, string>()
  for (const s of scheduled) {
    rosterByEmployee.set(s.employee_id, `${hm(s.start_time)}–${hm(s.end_time)}`)
  }

  // Face-flag is sourced from the alerts table (single source). "Flagged" =
  // a PENDING face flag (open + un-reviewed); a rejected/escalated flag does
  // not count toward the pending KPI.
  const pendingFace = alertRows.filter((a) => a.type === 'faceflag' && a.review_result == null)
  const flaggedEmpIds = new Set<string>(pendingFace.map((a) => a.employee_id).filter(Boolean))

  // employee_id -> earliest clock-in today
  const byEmployee = new Map<string, { timestamp: string; flagged: boolean }>()
  for (const e of events) {
    const existing = byEmployee.get(e.employee_id)
    if (!existing || e.timestamp < existing.timestamp) {
      byEmployee.set(e.employee_id, {
        timestamp: e.timestamp,
        flagged: !!e.face_match_flagged,
      })
    }
  }

  // Current time-of-day in Gulf Standard Time (UTC+4) to decide whether a
  // shift has started. Shift `time` columns are GST. No overnight shifts, so a
  // same-day minutes-since-midnight comparison is sufficient.
  const nowD = new Date()
  const nowMin = (nowD.getUTCHours() * 60 + nowD.getUTCMinutes() + 240) % 1440
  const toMin = (t: string | null): number | null => {
    if (!t) return null
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }

  const dashLocations: DashLocation[] = locations.map((loc: any) => {
    const locEmps = employees.filter((e: any) => e.location_id === loc.id)
    const total = locEmps.length
    let clockedIn = 0
    let missing = 0 // shift has started but no clock-in

    const pickers: DashPicker[] = locEmps.map((e: any) => {
      const ev = byEmployee.get(e.id)
      // Effective shift = the employee's own time if set, else the location's.
      const startMin = toMin(e.shift_start ?? loc.shift_start ?? null)
      const shiftStarted = startMin == null ? true : nowMin >= startMin
      let late = false
      if (ev) {
        clockedIn++
        const d = new Date(ev.timestamp)
        const clockMin = (d.getUTCHours() * 60 + d.getUTCMinutes() + 240) % 1440
        late = startMin != null && clockMin > startMin + 5
      }
      const pstatus = deriveStatus({
        active: true, // query already filters active = true
        pinSet: !!e.pin_set,
        clockedIn: !!ev,
        late,
        shiftStarted,
      })
      // Only a genuinely-due, PIN-ready picker who hasn't clocked in is a no-show.
      // awaiting_setup can't clock in, so it is never counted as missing.
      if (pstatus === 'absent') missing++
      return {
        id: e.employee_number || e.id.slice(0, 8),
        name: shortName(e.first_name, e.last_name),
        status: pstatus,
        clockedInAt: ev?.timestamp ?? null,
        flagged: flaggedEmpIds.has(e.id),
        shiftType: e.shift_type ?? null,
        rosterShift: rosterByEmployee.get(e.id) ?? null,
        supervisor: e.vendor?.supervisor_name ?? null,
      }
    })

    // Location status from shift-aware counts: pickers not yet due don't count
    // as no-shows.
    const status: LocationStatus =
      total === 0 ? 'noshift'
      : clockedIn === total ? 'active'
      : missing === 0 ? 'active'        // everyone due is in; rest not due yet
      : clockedIn === 0 ? 'noshow'      // nobody who's due has shown up
      : 'late'                          // some due pickers still missing

    const supervisor =
      (locEmps.find((e: any) => e.supervisor?.name)?.supervisor?.name as string) ?? null

    return {
      id: loc.id,
      name: loc.name,
      client: loc.client?.name ?? loc.chain ?? null,
      area: loc.area ?? null,
      supervisor,
      status,
      total,
      clockedIn,
      shiftStart: loc.shift_start ?? null,
      shiftEnd: loc.shift_end ?? null,
      pickers,
    }
  })

  const alerts: DashAlert[] = alertRows.map((a: any) => ({
    id: a.id,
    type: a.severity === 'critical' ? 'red' : 'amber',
    icon: ALERT_ICON[a.type] ?? '🔔',
    title: a.title,
    sub: a.body ?? '',
    time: hhmm(a.created_at),
  }))

  const kpis: DashKpis = {
    active: dashLocations.filter((l) => l.status === 'active').length,
    totalLocations: dashLocations.length,
    clockedIn: dashLocations.reduce((s, l) => s + l.clockedIn, 0),
    totalPickers: dashLocations.reduce((s, l) => s + l.total, 0),
    noshow: dashLocations.filter((l) => l.status === 'noshow').length,
    late: dashLocations.filter((l) => l.status === 'late').length,
    // Pending face flags tenant-wide (single source: the alerts table).
    flagged: pendingFace.length,
  }

  return { locations: dashLocations, alerts, kpis }
}
