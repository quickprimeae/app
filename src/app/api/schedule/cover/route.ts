// src/app/api/schedule/cover/route.ts
// Ops-only. POST { original_shift_id, cover_employee_id, start_time?, end_time? }
// Assigns a cover for a scheduled shift:
//   1. upsert a cover scheduled_shift for the cover picker (origin='cover',
//      status='scheduled', same date/location, times default to the original's)
//   2. mark the original shift status='reassigned', reassigned_to_employee_id =
//      the cover picker
//   3. write audit_logs for both
// After this, the cover picker's no-show / auto-clockout keys off their new
// shift, and the original picker is no longer a no-show (not 'scheduled').

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getOpsContext } from '@/lib/ops'
import { isValidShiftWindow } from '@/lib/shift'

const SHIFT_COLS = 'id, tenant_id, employee_id, location_id, date, start_time, end_time, status, origin, reassigned_to_employee_id, assigned_by, created_at'

export async function POST(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  const tenantId = ctx.opsUser.tenant_id
  const supabase = createServerSupabaseClient()

  try {
    const { original_shift_id, cover_employee_id, start_time, end_time } = await req.json()
    if (!original_shift_id || !cover_employee_id) {
      return NextResponse.json({ error: 'original_shift_id and cover_employee_id required' }, { status: 400 })
    }

    // The shift being covered must exist and still be an active scheduled shift.
    const { data: original } = await supabase
      .from('scheduled_shifts')
      .select(SHIFT_COLS)
      .eq('tenant_id', tenantId)
      .eq('id', original_shift_id)
      .maybeSingle()
    if (!original) return NextResponse.json({ error: 'Original shift not found' }, { status: 404 })
    if (original.status !== 'scheduled') {
      return NextResponse.json({ error: `This shift is already ${original.status} — nothing to cover.` }, { status: 409 })
    }
    if (cover_employee_id === original.employee_id) {
      return NextResponse.json({ error: 'Pick a different picker to cover.' }, { status: 400 })
    }

    // Cover times default to the original shift's.
    const coverStart = start_time ?? original.start_time
    const coverEnd = end_time ?? original.end_time
    if (!isValidShiftWindow(coverStart, coverEnd)) {
      return NextResponse.json({ error: 'End time must be after start time (no overnight shifts).' }, { status: 400 })
    }

    // Cover picker must be an active picker.
    const { data: cover } = await supabase
      .from('employees')
      .select('id, first_name, last_name, active, role')
      .eq('tenant_id', tenantId)
      .eq('id', cover_employee_id)
      .maybeSingle()
    if (!cover) return NextResponse.json({ error: 'Cover employee not found' }, { status: 404 })
    if (!cover.active) return NextResponse.json({ error: `${cover.first_name} ${cover.last_name} is deactivated.` }, { status: 409 })

    // They must not already be working that day. A non-scheduled row
    // (cancelled/reassigned) is fine — the upsert below revives it as the cover.
    const { data: existingCover } = await supabase
      .from('scheduled_shifts')
      .select(SHIFT_COLS)
      .eq('tenant_id', tenantId)
      .eq('employee_id', cover_employee_id)
      .eq('date', original.date)
      .maybeSingle()
    if (existingCover && existingCover.status === 'scheduled') {
      return NextResponse.json({ error: `${cover.first_name} ${cover.last_name} is already working that day.` }, { status: 409 })
    }

    // 1) Create (or revive) the cover shift.
    const { data: coverShift, error: coverErr } = await supabase
      .from('scheduled_shifts')
      .upsert(
        {
          tenant_id: tenantId,
          employee_id: cover_employee_id,
          location_id: original.location_id,
          date: original.date,
          start_time: coverStart,
          end_time: coverEnd,
          status: 'scheduled',
          origin: 'cover',
          reassigned_to_employee_id: null,
          assigned_by: ctx.opsUser.id,
        },
        { onConflict: 'employee_id,date' }
      )
      .select(SHIFT_COLS)
      .single()
    if (coverErr) return NextResponse.json({ error: `Could not create cover shift: ${coverErr.message}` }, { status: 500 })

    // 2) Mark the original reassigned. If this fails, undo the cover so we never
    // leave a cover shift without the original pointing at it.
    const { data: reassigned, error: reErr } = await supabase
      .from('scheduled_shifts')
      .update({ status: 'reassigned', reassigned_to_employee_id: cover_employee_id })
      .eq('tenant_id', tenantId)
      .eq('id', original.id)
      .eq('status', 'scheduled') // guard against a concurrent change
      .select(SHIFT_COLS)
      .single()
    if (reErr || !reassigned) {
      // Compensate: restore the cover row to its prior state (or remove it).
      if (existingCover) {
        await supabase.from('scheduled_shifts').update({
          status: existingCover.status,
          origin: existingCover.origin,
          start_time: existingCover.start_time,
          end_time: existingCover.end_time,
          reassigned_to_employee_id: existingCover.reassigned_to_employee_id,
        }).eq('id', coverShift.id)
      } else {
        await supabase.from('scheduled_shifts').delete().eq('id', coverShift.id)
      }
      return NextResponse.json({ error: 'Could not reassign the original shift; cover rolled back. Try again.' }, { status: 500 })
    }

    // 3) Audit both sides.
    await supabase.from('audit_logs').insert([
      {
        tenant_id: tenantId,
        actor_user_id: ctx.opsUser.id,
        entity_type: 'scheduled_shift',
        entity_id: original.id,
        action: 'cover',
        before: original,
        after: reassigned,
      },
      {
        tenant_id: tenantId,
        actor_user_id: ctx.opsUser.id,
        entity_type: 'scheduled_shift',
        entity_id: coverShift.id,
        action: 'create',
        before: existingCover ?? null,
        after: coverShift,
      },
    ])

    return NextResponse.json({ success: true, cover: coverShift, original: reassigned })
  } catch (err) {
    console.error('Assign cover error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
