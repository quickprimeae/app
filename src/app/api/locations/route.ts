// src/app/api/locations/route.ts
// Ops-only. GET: list (with today's attendance) · POST: create · PATCH: update.
// Tenant is derived from the ops session, never trusted from the client.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getOpsContext } from '@/lib/ops'
import { getLocationsList } from '@/lib/locations-data'

export async function GET() {
  const ctx = await getOpsContext()
  if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!ctx.opsUser) return NextResponse.json({ error: 'No ops profile' }, { status: 403 })
  const locations = await getLocationsList(ctx.opsUser.tenant_id)
  return NextResponse.json({ locations })
}

export async function POST(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  const supabase = createServerSupabaseClient()

  try {
    const b = await req.json()
    if (!b.name || !b.client_id || b.lat == null || b.lng == null) {
      return NextResponse.json({ error: 'name, client_id, lat, lng are required' }, { status: 400 })
    }
    const { data, error } = await supabase
      .from('locations')
      .insert({
        tenant_id: ctx.opsUser.tenant_id,
        client_id: b.client_id,
        name: b.name,
        chain: b.chain ?? null,
        area: b.area ?? null,
        address: b.address ?? null,
        lat: b.lat,
        lng: b.lng,
        geofence_radius: b.geofence_radius ?? 150,
        shift_start: b.shift_start || '08:00:00',
        shift_end: b.shift_end || '19:00:00',
        shift_days: b.shift_days || 'Mon-Sat',
        active: true,
      })
      .select('id')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, location_id: data.id })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  const supabase = createServerSupabaseClient()

  try {
    const { location_id, ...rest } = await req.json()
    if (!location_id) return NextResponse.json({ error: 'location_id required' }, { status: 400 })

    // Whitelist updatable columns.
    const allowed = ['name', 'chain', 'area', 'address', 'lat', 'lng', 'geofence_radius', 'shift_start', 'shift_end', 'shift_days', 'active', 'client_id']
    const updates: Record<string, any> = {}
    for (const k of allowed) if (k in rest) updates[k] = rest[k]
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const { error } = await supabase
      .from('locations')
      .update(updates)
      .eq('id', location_id)
      .eq('tenant_id', ctx.opsUser.tenant_id) // scope to tenant
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
