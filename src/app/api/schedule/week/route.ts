// src/app/api/schedule/week/route.ts
// Ops-only BULK week actions for ONE picker + the currently-viewed week, driven
// by the Roster "Add shift" popup. Uses the SAME scheduled_shifts semantics as
// the single-shift route (/api/schedule/shift):
//   • a scheduled day -> upsert a 'scheduled' shift (revives a cancelled row)
//   • an off day       -> soft-cancel any existing scheduled shift (status
//                         'cancelled'; the row stays, so it is auditable and is
//                         NOT a no-show) — matching that route's DELETE path.
//
// The whole week is written in ONE upsert (onConflict employee_id,date), so a
// partial failure can't leave a half-written week.
//
// POST body:
//   { employee_id, location_id, dates:[…ISO], mode:'apply',
//     start_time, end_time, off_date:ISO|null }         // Apply to whole week
//   { employee_id, location_id, dates:[…ISO], mode:'copy_prior' }  // Copy last week
//
// copy_prior copies THIS picker's prior-week (each viewed date − 7d) SCHEDULED
// shifts onto the matching weekdays; a prior day off stays off. GUARD: if the
// picker has no scheduled shift in the prior week, nothing is written (400).

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getOpsContext } from '@/lib/ops'
import { isValidShiftWindow } from '@/lib/shift'
import { addDaysISO, isDateHeader } from '@/lib/schedule'

const hhmm = (t: string) => String(t).slice(0, 5)

export async function POST(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  const tenantId = ctx.opsUser.tenant_id
  const supabase = createServerSupabaseClient()

  try {
    const body = await req.json()
    const { employee_id, location_id, dates, mode } = body as {
      employee_id?: string; location_id?: string; dates?: string[]; mode?: string
    }
    if (!employee_id || !location_id) {
      return NextResponse.json({ error: 'employee_id and location_id required' }, { status: 400 })
    }
    if (!Array.isArray(dates) || dates.length === 0 || !dates.every(isDateHeader)) {
      return NextResponse.json({ error: 'dates must be a non-empty array of YYYY-MM-DD' }, { status: 400 })
    }

    // The picker must belong to this tenant and this exact location, so a stray id
    // can never be used to write shifts for someone else / somewhere else.
    const { data: emp } = await supabase
      .from('employees')
      .select('id, location_id, active')
      .eq('tenant_id', tenantId)
      .eq('id', employee_id)
      .maybeSingle()
    if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    if (!emp.active) return NextResponse.json({ error: 'Employee is deactivated' }, { status: 400 })
    if (emp.location_id !== location_id) {
      return NextResponse.json({ error: 'Location does not match the employee' }, { status: 400 })
    }

    // Current viewed-week rows for this picker — needed to know which off days
    // actually have an active shift to clear.
    const { data: curRows } = await supabase
      .from('scheduled_shifts')
      .select('id, date, start_time, end_time, status, origin')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employee_id)
      .in('date', dates)
    const current = new Map<string, any>()
    for (const r of (curRows ?? []) as any[]) current.set(r.date, r)

    // Per viewed date: a scheduled target {start,end}, or null = off.
    const target = new Map<string, { start: string; end: string } | null>()

    if (mode === 'apply') {
      const { start_time, end_time, off_date } = body as { start_time?: string; end_time?: string; off_date?: string | null }
      if (!start_time || !end_time) return NextResponse.json({ error: 'start_time and end_time required' }, { status: 400 })
      if (!isValidShiftWindow(start_time, end_time)) {
        return NextResponse.json({ error: 'End time must be after start time (no overnight shifts).' }, { status: 400 })
      }
      if (off_date != null && !dates.includes(off_date)) {
        return NextResponse.json({ error: 'off_date must be one of the viewed-week dates' }, { status: 400 })
      }
      for (const d of dates) target.set(d, d === off_date ? null : { start: start_time, end: end_time })
    } else if (mode === 'copy_prior') {
      const priorToViewed = new Map<string, string>() // priorDate -> viewedDate
      const priorDates: string[] = []
      for (const d of dates) { const p = addDaysISO(d, -7); priorDates.push(p); priorToViewed.set(p, d) }
      const { data: priorRows } = await supabase
        .from('scheduled_shifts')
        .select('date, start_time, end_time, status')
        .eq('tenant_id', tenantId)
        .eq('employee_id', employee_id)
        .in('date', priorDates)
        .eq('status', 'scheduled') // a cancelled prior day = off, so it stays off
      const prior = (priorRows ?? []) as any[]
      // GUARD: nothing to copy -> do NOT wipe the current week.
      if (prior.length === 0) {
        return NextResponse.json({ error: 'No prior-week schedule to copy' }, { status: 400 })
      }
      for (const d of dates) target.set(d, null) // default every day off
      for (const p of prior) {
        const viewed = priorToViewed.get(p.date)
        if (viewed) target.set(viewed, { start: hhmm(p.start_time), end: hhmm(p.end_time) })
      }
    } else {
      return NextResponse.json({ error: "mode must be 'apply' or 'copy_prior'" }, { status: 400 })
    }

    // ONE upsert for the whole week (onConflict employee_id,date):
    //   scheduled day                         -> status 'scheduled' with the times
    //   off day with an existing active shift -> same row flipped to 'cancelled'
    //   off day with no active shift          -> omitted (nothing to do)
    const rows: any[] = []
    let scheduled = 0, cleared = 0
    for (const d of dates) {
      const t = target.get(d) ?? null
      if (t) {
        rows.push({
          tenant_id: tenantId, employee_id, location_id, date: d,
          start_time: t.start, end_time: t.end,
          status: 'scheduled', origin: 'manual', reassigned_to_employee_id: null, assigned_by: ctx.opsUser.id,
        })
        scheduled++
      } else {
        const cur = current.get(d)
        if (cur && cur.status !== 'cancelled') {
          rows.push({
            tenant_id: tenantId, employee_id, location_id, date: d,
            start_time: cur.start_time, end_time: cur.end_time,
            status: 'cancelled', origin: cur.origin ?? 'manual', reassigned_to_employee_id: null, assigned_by: ctx.opsUser.id,
          })
          cleared++
        }
      }
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from('scheduled_shifts')
        .upsert(rows, { onConflict: 'employee_id,date' })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await supabase.from('audit_logs').insert({
      tenant_id: tenantId,
      actor_user_id: ctx.opsUser.id,
      entity_type: 'schedule_week',
      entity_id: employee_id,
      action: mode === 'copy_prior' ? 'copy_prior_week' : 'apply_week',
      before: null,
      after: { employee_id, dates, mode, scheduled, cleared, by: ctx.opsUser.name },
    })

    return NextResponse.json({ success: true, scheduled, cleared })
  } catch (err) {
    console.error('Schedule week error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
