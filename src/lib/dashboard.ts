// src/lib/dashboard.ts
// SERVER-ONLY. Assembles the live dashboard payload from base tables so the
// per-picker breakdown stays consistent (today_attendance is aggregate-only).
// Used by the /dashboard server component and the /api/attendance refresh route.

import { createServerSupabaseClient } from './supabase'

export type PickerStatus = 'in' | 'absent' | 'expected'
export type LocationStatus = 'active' | 'late' | 'noshow' | 'noshift'

export type DashPicker = {
  id: string
  name: string
  status: PickerStatus
  clockedInAt: string | null
  flagged: boolean
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

export async function getDashboardData(tenantId: string): Promise<DashboardData> {
  const supabase = createServerSupabaseClient()
  const today = new Date().toISOString().split('T')[0]

  const [locRes, empRes, evtRes, alertRes] = await Promise.all([
    supabase
      .from('locations')
      .select('id, name, chain, area, shift_start, shift_end, client:clients(name)')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('name', { ascending: true }),
    supabase
      .from('employees')
      .select('id, first_name, last_name, employee_number, location_id, supervisor:ops_users(name)')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .eq('role', 'picker'),
    supabase
      .from('clock_events')
      .select('employee_id, timestamp, face_match_flagged')
      .eq('tenant_id', tenantId)
      .eq('event_type', 'clock_in')
      .gte('timestamp', `${today}T00:00:00Z`)
      .lte('timestamp', `${today}T23:59:59Z`),
    supabase
      .from('alerts')
      .select('id, type, severity, title, body, created_at')
      .eq('tenant_id', tenantId)
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(25),
  ])

  // Cast embedded relations to any: without generated DB types, supabase-js
  // infers to-one embeds (client, supervisor) as arrays.
  const locations = (locRes.data ?? []) as any[]
  const employees = (empRes.data ?? []) as any[]
  const events = (evtRes.data ?? []) as { employee_id: string; timestamp: string; face_match_flagged: boolean | null }[]
  const alertRows = (alertRes.data ?? []) as any[]

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

  const dashLocations: DashLocation[] = locations.map((loc: any) => {
    const locEmps = employees.filter((e: any) => e.location_id === loc.id)
    const total = locEmps.length
    let clockedIn = 0

    // Provisional status pass to label individual pickers.
    const inCount = locEmps.filter((e: any) => byEmployee.has(e.id)).length
    const status: LocationStatus =
      total === 0 ? 'noshift' : inCount === 0 ? 'noshow' : inCount < total ? 'late' : 'active'

    const pickers: DashPicker[] = locEmps.map((e: any) => {
      const ev = byEmployee.get(e.id)
      if (ev) clockedIn++
      return {
        id: e.employee_number || e.id.slice(0, 8),
        name: `${e.first_name} ${e.last_name}`.trim(),
        status: ev ? 'in' : status === 'noshow' ? 'absent' : 'expected',
        clockedInAt: ev?.timestamp ?? null,
        flagged: !!ev?.flagged,
      }
    })

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
    flagged: dashLocations.reduce(
      (s, l) => s + l.pickers.filter((p) => p.flagged).length,
      0
    ),
  }

  return { locations: dashLocations, alerts, kpis }
}
