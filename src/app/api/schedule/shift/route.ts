// src/app/api/schedule/shift/route.ts
// Ops-only single-shift mutations for the roster grid, each audited.
//   POST   { employee_id, location_id, date, start_time, end_time }
//          → create or revive a 'scheduled' shift for that picker+date (manual)
//   PATCH  { id, start_time, end_time }  → edit a shift's times
//   DELETE { id }                        → cancel a shift (status='cancelled';
//          the row stays so it is auditable and is NOT a no-show for anyone)
//
// Upsert key is (employee_id, date): creating over a cancelled/reassigned row
// revives it. Every mutation writes an append-only audit_logs row.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getOpsContext } from '@/lib/ops'
import { isValidShiftWindow } from '@/lib/shift'

const SHIFT_COLS = 'id, tenant_id, employee_id, location_id, date, start_time, end_time, status, origin, reassigned_to_employee_id, assigned_by, created_at'

async function audit(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  tenantId: string,
  actorId: string,
  action: string,
  entityId: string | null,
  before: any,
  after: any
) {
  await supabase.from('audit_logs').insert({
    tenant_id: tenantId,
    actor_user_id: actorId,
    entity_type: 'scheduled_shift',
    entity_id: entityId,
    action,
    before,
    after,
  })
}

export async function POST(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  const tenantId = ctx.opsUser.tenant_id
  const supabase = createServerSupabaseClient()

  try {
    const { employee_id, location_id, date, start_time, end_time } = await req.json()
    if (!employee_id || !location_id || !date || !start_time || !end_time) {
      return NextResponse.json({ error: 'employee_id, location_id, date, start_time, end_time required' }, { status: 400 })
    }
    if (!isValidShiftWindow(start_time, end_time)) {
      return NextResponse.json({ error: 'End time must be after start time (no overnight shifts).' }, { status: 400 })
    }

    // Prior row (if any) for this picker+date, for the audit before-state and to
    // decide create vs update.
    const { data: prior } = await supabase
      .from('scheduled_shifts')
      .select(SHIFT_COLS)
      .eq('tenant_id', tenantId)
      .eq('employee_id', employee_id)
      .eq('date', date)
      .maybeSingle()

    const { data: after, error } = await supabase
      .from('scheduled_shifts')
      .upsert(
        {
          tenant_id: tenantId,
          employee_id,
          location_id,
          date,
          start_time,
          end_time,
          status: 'scheduled',
          origin: 'manual',
          reassigned_to_employee_id: null,
          assigned_by: ctx.opsUser.id,
        },
        { onConflict: 'employee_id,date' }
      )
      .select(SHIFT_COLS)
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await audit(supabase, tenantId, ctx.opsUser.id, prior ? 'update' : 'create', after.id, prior ?? null, after)
    return NextResponse.json({ success: true, shift: after })
  } catch (err) {
    console.error('Shift create error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  const tenantId = ctx.opsUser.tenant_id
  const supabase = createServerSupabaseClient()

  try {
    const { id, start_time, end_time } = await req.json()
    if (!id || !start_time || !end_time) {
      return NextResponse.json({ error: 'id, start_time, end_time required' }, { status: 400 })
    }
    if (!isValidShiftWindow(start_time, end_time)) {
      return NextResponse.json({ error: 'End time must be after start time (no overnight shifts).' }, { status: 400 })
    }

    const { data: before } = await supabase
      .from('scheduled_shifts')
      .select(SHIFT_COLS)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .maybeSingle()
    if (!before) return NextResponse.json({ error: 'Shift not found' }, { status: 404 })

    const { data: after, error } = await supabase
      .from('scheduled_shifts')
      .update({ start_time, end_time, status: 'scheduled', assigned_by: ctx.opsUser.id })
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select(SHIFT_COLS)
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await audit(supabase, tenantId, ctx.opsUser.id, 'update', id, before, after)
    return NextResponse.json({ success: true, shift: after })
  } catch (err) {
    console.error('Shift edit error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  const tenantId = ctx.opsUser.tenant_id
  const supabase = createServerSupabaseClient()

  try {
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const { data: before } = await supabase
      .from('scheduled_shifts')
      .select(SHIFT_COLS)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .maybeSingle()
    if (!before) return NextResponse.json({ error: 'Shift not found' }, { status: 404 })

    // Cancel = keep the row (auditable, not a no-show) rather than delete it.
    const { data: after, error } = await supabase
      .from('scheduled_shifts')
      .update({ status: 'cancelled' })
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select(SHIFT_COLS)
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await audit(supabase, tenantId, ctx.opsUser.id, 'cancel', id, before, after)
    return NextResponse.json({ success: true, shift: after })
  } catch (err) {
    console.error('Shift cancel error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
