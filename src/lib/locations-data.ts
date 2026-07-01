// src/lib/locations-data.ts
// SERVER-ONLY. Locations list with today's attendance counts + per-picker
// breakdown, plus coords for the map.

import { createServerSupabaseClient } from './supabase'
import { deriveLocationStatus, isRunningLate, type LocationStatus } from './status'
import { gstDay, gstMinutesOf, buildRosterMap } from './roster'
import { sessionsByEmployee, type SessionEvent } from './sessions'

// Canonical location status (shared with the dashboard grid + map pins).
export type LocStatus = LocationStatus
export type LocPicker = { name: string; status: 'in' | 'absent' | 'expected' }
export type LocationRow = {
  id: string
  name: string
  chain: string | null
  area: string | null
  address: string | null
  client: string | null
  supervisor: string | null
  status: LocStatus
  total: number
  clockedIn: number
  geofenceRadius: number
  lat: number
  lng: number
  shiftHours: string
  shiftDays: string | null
  pickers: LocPicker[]
}

export async function getLocationsList(tenantId: string): Promise<LocationRow[]> {
  const supabase = createServerSupabaseClient()
  // Operational day + clock-in window in GST (the roster's calendar day) — the
  // same convention the dashboard uses, so both pages agree on "today".
  const gst = gstDay()

  const [locRes, empRes, evtRes, schedRes, alertRes] = await Promise.all([
    supabase
      .from('locations')
      .select('id, name, chain, area, address, lat, lng, geofence_radius, shift_start, shift_end, shift_days, client:clients(name)')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('name', { ascending: true }),
    supabase
      .from('employees')
      .select('id, first_name, last_name, location_id, pin_set, supervisor:ops_users(name)')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .eq('role', 'picker'),
    // BOTH punch types — "in" = OPEN session (clock_in, no later clock_out).
    supabase
      .from('clock_events')
      .select('employee_id, event_type, timestamp')
      .eq('tenant_id', tenantId)
      .in('event_type', ['clock_in', 'clock_out'])
      .eq('voided', false)
      .gte('timestamp', gst.startUTC)
      .lt('timestamp', gst.endUTC),
    // Today's roster — SINGLE source for late (see src/lib/roster.ts).
    supabase
      .from('scheduled_shifts')
      .select('employee_id, start_time, end_time')
      .eq('tenant_id', tenantId)
      .eq('date', gst.date)
      .eq('status', 'scheduled'),
    // No-show = the SAME alert rows the dashboard KPI card / feed count, so the
    // pin/list badge never diverges from them.
    supabase
      .from('alerts')
      .select('employee_id')
      .eq('tenant_id', tenantId)
      .eq('type', 'noshow')
      .eq('resolved', false)
      .gte('created_at', gst.startUTC)
      .lt('created_at', gst.endUTC),
  ])

  const locations = (locRes.data ?? []) as any[]
  const employees = (empRes.data ?? []) as any[]
  // "in" = currently clocked in (open session), NOT merely a clock_in today.
  const sessions = sessionsByEmployee((evtRes.data ?? []) as SessionEvent[])
  const inSet = new Set([...sessions].filter(([, s]) => s.open).map(([id]) => id))
  const rosterByEmp = buildRosterMap((schedRes.data ?? []) as any[])
  const noshowEmpIds = new Set(((alertRes.data ?? []) as any[]).map((a) => a.employee_id).filter(Boolean))
  const nowMin = gstMinutesOf(new Date())

  return locations.map((loc) => {
    const locEmps = employees.filter((e) => e.location_id === loc.id)
    const total = locEmps.length
    const clockedIn = locEmps.filter((e) => inSet.has(e.id)).length
    // ONE canonical derivation — identical to the dashboard grid + map pins.
    const status: LocStatus = deriveLocationStatus({
      clockedIn,
      noshowAlert: locEmps.some((e) => noshowEmpIds.has(e.id)),
      latePicker: locEmps.some((e) => {
        const r = rosterByEmp.get(e.id)
        return !!r && !inSet.has(e.id) && !!e.pin_set && isRunningLate(r.startMin, nowMin)
      }),
      hasRoster: locEmps.some((e) => rosterByEmp.has(e.id)),
    })
    const pickers: LocPicker[] = locEmps.map((e) => ({
      name: `${e.first_name} ${e.last_name}`.trim(),
      status: inSet.has(e.id) ? 'in' : status === 'noshow' ? 'absent' : 'expected',
    }))
    const supervisor = (locEmps.find((e) => e.supervisor?.name)?.supervisor?.name as string) ?? null

    return {
      id: loc.id,
      name: loc.name,
      chain: loc.chain ?? null,
      area: loc.area ?? null,
      address: loc.address ?? null,
      client: loc.client?.name ?? null,
      supervisor,
      status,
      total,
      clockedIn,
      geofenceRadius: Number(loc.geofence_radius) || 0,
      lat: Number(loc.lat),
      lng: Number(loc.lng),
      shiftHours:
        loc.shift_start && loc.shift_end ? `${loc.shift_start.slice(0, 5)}–${loc.shift_end.slice(0, 5)}` : '—',
      shiftDays: loc.shift_days ?? null,
      pickers,
    }
  })
}
