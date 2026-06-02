// src/app/api/shifts/route.ts
// Ops-only. GET: list shifts (filter by month/status/employee) for hours
// verification · PATCH: verify or adjust a shift's hours.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getOpsContext } from '@/lib/ops'

export async function GET(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  const supabase = createServerSupabaseClient()
  const { searchParams } = new URL(req.url)
  const month = searchParams.get('month')
  const year = searchParams.get('year')
  const status = searchParams.get('status')
  const employeeId = searchParams.get('employee_id')
  const needsReview = searchParams.get('needs_review')

  let query = supabase
    .from('shifts')
    .select(`
      id, date, clock_in_time, clock_out_time, hours_raw, hours_adjusted, hours_final,
      hourly_rate, gross_pay, is_auto_clockout, needs_review, review_note, status,
      employee:employees(id, first_name, last_name, employee_number),
      location:locations(id, name)
    `)
    .eq('tenant_id', ctx.opsUser.tenant_id)
    .order('date', { ascending: false })

  if (month && year) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const endDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0]
    query = query.gte('date', startDate).lte('date', endDate)
  }
  if (status) query = query.eq('status', status)
  if (employeeId) query = query.eq('employee_id', employeeId)
  if (needsReview != null) query = query.eq('needs_review', needsReview === 'true')

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ shifts: data })
}

export async function PATCH(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  const supabase = createServerSupabaseClient()

  try {
    const { shift_id, action, hours_adjusted, review_note } = await req.json()
    if (!shift_id || !action) {
      return NextResponse.json({ error: 'shift_id and action required' }, { status: 400 })
    }

    // Load the shift (scoped to tenant) to recompute pay on adjust.
    const { data: shift, error: loadErr } = await supabase
      .from('shifts')
      .select('id, hourly_rate')
      .eq('id', shift_id)
      .eq('tenant_id', ctx.opsUser.tenant_id)
      .maybeSingle()
    if (loadErr || !shift) return NextResponse.json({ error: 'Shift not found' }, { status: 404 })

    const updates: Record<string, any> = {
      review_note: review_note ?? null,
      verified_by: ctx.opsUser.id,
      verified_at: new Date().toISOString(),
      needs_review: false,
    }

    if (action === 'verify') {
      updates.status = 'verified'
    } else if (action === 'adjust') {
      const hrs = Number(hours_adjusted)
      if (!Number.isFinite(hrs) || hrs < 0) {
        return NextResponse.json({ error: 'hours_adjusted must be a non-negative number' }, { status: 400 })
      }
      updates.status = 'adjusted'
      updates.hours_adjusted = hrs
      updates.hours_final = hrs
      updates.gross_pay = Math.round(hrs * (Number(shift.hourly_rate) || 0) * 100) / 100
    } else if (action === 'dispute') {
      updates.status = 'disputed'
      updates.needs_review = true
      updates.verified_by = null
      updates.verified_at = null
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }

    const { error } = await supabase.from('shifts').update(updates).eq('id', shift_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
