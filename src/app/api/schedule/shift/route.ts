// src/app/api/schedule/shift/route.ts
// Ops-only single-shift mutations for the roster grid, each audited.
//   POST   { employee_id, location_id, date, start_time, end_time }
//          → create or revive a 'scheduled' shift for that picker+date (manual)
//   PATCH  { id, start_time, end_time }  → edit a shift's times
//   DELETE { id }  OR  { employee_id, location_id, date }
//          → mark that picker+day OFF (status='cancelled'). The row stays so it
//            is auditable and is NOT a no-show for anyone. With {id} an existing
//            shift is flipped; with {employee_id, location_id, date} an OFF row
//            is created even when the day was empty (no prior shift).
//
// Upsert key is (employee_id, date): creating over a cancelled/reassigned row
// revives it. Every mutation writes an append-only audit_logs row.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getOpsContext } from '@/lib/ops'
import { isValidShiftWindow } from '@/lib/shift'

const SHIFT_COLS = 'id, tenant_id, employee_id, location_id, date, start_time, end_time, status, origin, reassigned_to_employee_id, assigned_by, created_at'

// Placeholder times for an OFF row created on a previously-empty day. status is
// 'cancelled', so these are never read by detection / late / the counter (all
// filter status='scheduled') nor shown in the grid; they only satisfy the
// NOT NULL + end_time>start_time constraints. Existing shifts keep their times.
const OFF_START = '00:00:00'
const OFF_END = '00:01:00'

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
    const { id, employee_id, location_id, date } = await req.json()
    if (!id && !(employee_id && location_id && date)) {
      return NextResponse.json({ error: 'id, or employee_id + location_id + date, required' }, { status: 400 })
    }

    // Locate the prior row: by id (flip an existing shift) or by (employee, date)
    // (mark an empty/known day off). Either way we end at one 'cancelled' row.
    const priorQuery = supabase
      .from('scheduled_shifts')
      .select(SHIFT_COLS)
      .eq('tenant_id', tenantId)
    const { data: before } = id
      ? await priorQuery.eq('id', id).maybeSingle()
      : await priorQuery.eq('employee_id', employee_id).eq('date', date).maybeSingle()

    // With {id} the row must exist; with {employee_id,date} an empty day is fine —
    // we create the OFF row. An already-cancelled day is a no-op success.
    if (id && !before) return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
    if (before?.status === 'cancelled') {
      return NextResponse.json({ success: true, shift: before })
    }

    // Mark OFF = keep/create a 'cancelled' row (auditable, not a no-show) rather
    // than delete. Flipping an existing shift preserves its real times; a brand
    // new OFF day gets placeholder times (never surfaced — see OFF_START/END).
    const empId = before?.employee_id ?? employee_id
    const offDate = before?.date ?? date
    const { data: after, error } = await supabase
      .from('scheduled_shifts')
      .upsert(
        {
          tenant_id: tenantId,
          employee_id: empId,
          location_id: before?.location_id ?? location_id,
          date: offDate,
          start_time: before?.start_time ?? OFF_START,
          end_time: before?.end_time ?? OFF_END,
          status: 'cancelled',
          origin: before?.origin ?? 'manual',
          reassigned_to_employee_id: null,
          assigned_by: ctx.opsUser.id,
        },
        { onConflict: 'employee_id,date' }
      )
      .select(SHIFT_COLS)
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Retract any no-show alert already raised for this picker on the OFF'd GST
    // day. detect_noshows() can't fire for a cancelled shift, but an alert raised
    // BEFORE the cancel (while status='scheduled') would otherwise hang unresolved
    // forever. GST day = the shift's `date`; that day spans UTC
    // [date 00:00+04:00, next 00:00+04:00). Only noshow, only this picker+day,
    // only still-open — other alert types are untouched.
    const gstStart = `${offDate}T00:00:00+04:00`
    const nextDay = new Date(`${offDate}T00:00:00Z`)
    nextDay.setUTCDate(nextDay.getUTCDate() + 1)
    const gstEnd = `${nextDay.toISOString().slice(0, 10)}T00:00:00+04:00`
    await supabase
      .from('alerts')
      .update({
        resolved: true,
        resolved_at: new Date().toISOString(),
        resolved_by: ctx.opsUser.id,
        resolution_note: 'Auto-resolved: marked day off',
      })
      .eq('tenant_id', tenantId)
      .eq('employee_id', empId)
      .eq('type', 'noshow')
      .eq('resolved', false)
      .gte('created_at', gstStart)
      .lt('created_at', gstEnd)

    await audit(supabase, tenantId, ctx.opsUser.id, 'cancel', after.id, before ?? null, after)
    return NextResponse.json({ success: true, shift: after })
  } catch (err) {
    console.error('Shift mark-off error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
