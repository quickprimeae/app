// src/app/api/employees/location/route.ts
// Ops-only. POST { employee_id, location_id|null } — assign / change / clear an
// employee's location. Writes a before/after audit_logs row (same pattern as
// the schedule mutations).

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getOpsContext } from '@/lib/ops'

export async function POST(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  const tenantId = ctx.opsUser.tenant_id
  const supabase = createServerSupabaseClient()

  try {
    const { employee_id, location_id } = await req.json()
    if (!employee_id) return NextResponse.json({ error: 'employee_id required' }, { status: 400 })
    const newLocation = location_id || null

    // If a location is given, it must be a real active location in this tenant.
    if (newLocation) {
      const { data: loc } = await supabase
        .from('locations')
        .select('id')
        .eq('id', newLocation)
        .eq('tenant_id', tenantId)
        .eq('active', true)
        .maybeSingle()
      if (!loc) return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    const { data: before } = await supabase
      .from('employees')
      .select('id, location_id')
      .eq('id', employee_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!before) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    const { error: updErr } = await supabase
      .from('employees')
      .update({ location_id: newLocation })
      .eq('id', employee_id)
      .eq('tenant_id', tenantId)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    await supabase.from('audit_logs').insert({
      tenant_id: tenantId,
      actor_user_id: ctx.opsUser.id,
      entity_type: 'employee',
      entity_id: employee_id,
      action: 'assign_location',
      before: { location_id: before.location_id },
      after: { location_id: newLocation },
    }).then(() => {}, () => {})

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Assign location error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
