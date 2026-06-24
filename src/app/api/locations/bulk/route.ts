// src/app/api/locations/bulk/route.ts
// Ops-only. POST { rows: [...] } - creates many locations from a parsed CSV,
// mirroring api/employees/bulk. Columns: name, latitude, longitude, chain,
// area, address, geofence_m, store_days, store_start, store_end.
//
// MANDATORY: name, latitude, longitude (rejected if missing/invalid).
// AUTO-DEFAULT when blank: geofence_m / store_days / store_start / store_end
// come from the shared LOCATION_DEFAULTS (same source the Add-location form
// uses, so the two paths never drift). No client column - client_id is inserted
// NULL (locations are client-optional). Inserts use the same shape as the
// single create in ../route.ts.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getOpsContext } from '@/lib/ops'
import { isValidShiftWindow } from '@/lib/shift'
import { LOCATION_DEFAULTS, LAT_RANGE, LNG_RANGE } from '@/lib/locations-defaults'

type InRow = {
  name?: string
  latitude?: string | number
  longitude?: string | number
  chain?: string
  area?: string
  address?: string
  geofence_m?: string | number
  store_days?: string
  store_start?: string
  store_end?: string
}

function clean(v: unknown): string {
  return String(v ?? '').trim().replace(/\s+/g, ' ')
}

// Coerce "8:00" / "08:00" / "08:00:00" to a stable "HH:MM:SS" the DB expects.
function toTime(raw: string): string {
  const [h = '0', m = '0', s = '0'] = raw.trim().split(':')
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`
}

type ResultRow = { row: number; name?: string; status: 'added' | 'error'; reason?: string }

export async function POST(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  const tenantId = ctx.opsUser.tenant_id
  const supabase = createServerSupabaseClient()

  try {
    const { rows } = (await req.json()) as { rows: InRow[] }
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'rows array required' }, { status: 400 })
    }
    if (rows.length > 500) {
      return NextResponse.json({ error: 'Max 500 rows per upload' }, { status: 400 })
    }

    const results: ResultRow[] = []
    let added = 0

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const rowNum = i + 2 // account for the header row when reporting
      const err = (reason: string, name?: string) => results.push({ row: rowNum, name, status: 'error', reason })

      const name = clean(r.name)
      if (!name) { err('Missing name'); continue }

      const latRaw = clean(r.latitude)
      const lngRaw = clean(r.longitude)
      if (!latRaw || !lngRaw) { err('Missing latitude/longitude', name); continue }
      const lat = Number(latRaw)
      const lng = Number(lngRaw)
      if (!Number.isFinite(lat) || lat < LAT_RANGE.min || lat > LAT_RANGE.max) {
        err(`latitude must be a number between ${LAT_RANGE.min} and ${LAT_RANGE.max}`, name); continue
      }
      if (!Number.isFinite(lng) || lng < LNG_RANGE.min || lng > LNG_RANGE.max) {
        err(`longitude must be a number between ${LNG_RANGE.min} and ${LNG_RANGE.max}`, name); continue
      }

      // Defaults applied when a cell is blank - shared with the Add form.
      const geofenceRaw = clean(r.geofence_m)
      const geofence_radius = geofenceRaw ? Number(geofenceRaw) : LOCATION_DEFAULTS.geofence_m
      if (!Number.isFinite(geofence_radius) || geofence_radius <= 0) {
        err('geofence_m must be a positive number', name); continue
      }
      const shift_days = clean(r.store_days) || LOCATION_DEFAULTS.store_days
      const startTime = toTime(clean(r.store_start) || LOCATION_DEFAULTS.store_start)
      const endTime = toTime(clean(r.store_end) || LOCATION_DEFAULTS.store_end)
      if (!isValidShiftWindow(startTime, endTime)) {
        err('store_end must be after store_start (no overnight window)', name); continue
      }

      const { error } = await supabase
        .from('locations')
        .insert({
          tenant_id: tenantId,
          // client-optional: bulk never sets a client.
          client_id: null,
          name,
          chain: clean(r.chain) || null,
          area: clean(r.area) || null,
          address: clean(r.address) || null,
          lat,
          lng,
          geofence_radius,
          shift_start: startTime,
          shift_end: endTime,
          shift_days,
          active: true,
        })
        .select('id')
        .single()

      if (error) { err(error.message, name); continue }
      added++
      results.push({ row: rowNum, name, status: 'added' })
    }

    return NextResponse.json({
      success: true,
      added,
      errors: results.filter((r) => r.status === 'error').length,
      results,
    })
  } catch (e) {
    console.error('Bulk location create error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
