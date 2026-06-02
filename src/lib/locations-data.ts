// src/lib/locations-data.ts
// SERVER-ONLY. Locations list with today's attendance counts + per-picker
// breakdown, plus coords for the map.

import { createServerSupabaseClient } from './supabase'

export type LocStatus = 'active' | 'late' | 'noshow' | 'noshift'
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
  const today = new Date().toISOString().split('T')[0]

  const [locRes, empRes, evtRes] = await Promise.all([
    supabase
      .from('locations')
      .select('id, name, chain, area, address, lat, lng, geofence_radius, shift_start, shift_end, shift_days, client:clients(name)')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('name', { ascending: true }),
    supabase
      .from('employees')
      .select('id, first_name, last_name, location_id, supervisor:ops_users(name)')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .eq('role', 'picker'),
    supabase
      .from('clock_events')
      .select('employee_id')
      .eq('tenant_id', tenantId)
      .eq('event_type', 'clock_in')
      .gte('timestamp', `${today}T00:00:00Z`)
      .lte('timestamp', `${today}T23:59:59Z`),
  ])

  const locations = (locRes.data ?? []) as any[]
  const employees = (empRes.data ?? []) as any[]
  const inSet = new Set(((evtRes.data ?? []) as any[]).map((e) => e.employee_id))

  return locations.map((loc) => {
    const locEmps = employees.filter((e) => e.location_id === loc.id)
    const total = locEmps.length
    const clockedIn = locEmps.filter((e) => inSet.has(e.id)).length
    const status: LocStatus =
      total === 0 ? 'noshift' : clockedIn === 0 ? 'noshow' : clockedIn < total ? 'late' : 'active'
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
