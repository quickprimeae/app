// src/app/api/clock-in/break/route.ts
// Break on the picker's OPEN shift (one per shift), persisted on today's
// clock_in event row (migration 0020). Does NOT touch geofence/PIN/face/hours.
//
//   GET  ?employee_id=...            -> current break state (auto-ends on read)
//   POST { employee_id, action }     -> 'start' | 'end' | 'clockout'
//        'start'    : begin the break (rejected if one was already taken)
//        'end'      : end early, reason 'manual'
//        'clockout' : end because the picker is clocking out, reason 'clockout'
//
// The actual clock-out flow is unchanged and handled elsewhere; 'clockout' only
// closes the break row first so the work-timer display is correct.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { resolveBreakState, type BreakRow } from '@/lib/break'

// Today's open clock_in event (not voided, no clock_out yet) for this employee.
async function findOpenClockIn(supabase: any, employeeId: string): Promise<BreakRow | null> {
  const today = new Date().toISOString().split('T')[0]
  const { data: events } = await supabase
    .from('clock_events')
    .select('id, event_type, timestamp, break_started_at, break_ended_at, break_ended_reason')
    .eq('employee_id', employeeId)
    .eq('voided', false)
    .gte('timestamp', `${today}T00:00:00Z`)
    .lte('timestamp', `${today}T23:59:59Z`)
    .order('timestamp', { ascending: true })

  const clockIn = (events ?? []).find((e: any) => e.event_type === 'clock_in')
  const clockOut = (events ?? []).find((e: any) => e.event_type === 'clock_out')
  if (!clockIn || clockOut) return null // not clocked in, or already clocked out
  return clockIn as BreakRow
}

// Today's clock_in row regardless of whether a clock_out exists. Used only by
// the 'clockout' action, which fires AFTER the clock-out event is written (so
// findOpenClockIn would return null) to close an open break for the record.
async function findTodayClockIn(supabase: any, employeeId: string): Promise<BreakRow | null> {
  const today = new Date().toISOString().split('T')[0]
  const { data: events } = await supabase
    .from('clock_events')
    .select('id, event_type, timestamp, break_started_at, break_ended_at, break_ended_reason')
    .eq('employee_id', employeeId)
    .eq('voided', false)
    .gte('timestamp', `${today}T00:00:00Z`)
    .lte('timestamp', `${today}T23:59:59Z`)
    .order('timestamp', { ascending: true })

  const clockIn = (events ?? []).find((e: any) => e.event_type === 'clock_in')
  return (clockIn as BreakRow) ?? null
}

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient()
  const employeeId = new URL(req.url).searchParams.get('employee_id')
  if (!employeeId) return NextResponse.json({ error: 'employee_id is required' }, { status: 400 })

  const clockIn = await findOpenClockIn(supabase, employeeId)
  if (!clockIn) return NextResponse.json({ error: 'No open shift' }, { status: 409 })

  const state = await resolveBreakState(supabase, clockIn)
  return NextResponse.json({ success: true, ...state })
}

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient()
  let body: { employee_id?: string; action?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { employee_id, action } = body
  if (!employee_id || !action) {
    return NextResponse.json({ error: 'employee_id and action are required' }, { status: 400 })
  }

  // 'clockout' runs after the clock-out event exists, so it must locate the
  // clock_in row even though the shift is no longer "open".
  const clockIn =
    action === 'clockout'
      ? await findTodayClockIn(supabase, employee_id)
      : await findOpenClockIn(supabase, employee_id)
  if (!clockIn) return NextResponse.json({ error: 'No open shift to take a break on' }, { status: 409 })

  // Auto-end first so we read consistent state, then act on the action.
  const state = await resolveBreakState(supabase, clockIn)

  if (action === 'start') {
    // One break per shift: refuse if a break was already started.
    if (state.break_used) {
      return NextResponse.json({ error: 'Break already taken this shift' }, { status: 409 })
    }
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('clock_events')
      .update({ break_started_at: now })
      .eq('id', clockIn.id)
      .is('break_started_at', null) // guard against a double-tap race
    if (error) return NextResponse.json({ error: 'Could not start break' }, { status: 500 })
    const fresh = await resolveBreakState(supabase, { ...clockIn, break_started_at: now })
    return NextResponse.json({ success: true, ...fresh })
  }

  if (action === 'end' || action === 'clockout') {
    // Idempotent: if it already ended (manual/auto/clockout), just return state.
    if (!state.on_break) return NextResponse.json({ success: true, ...state })
    const reason = action === 'clockout' ? 'clockout' : 'manual'
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('clock_events')
      .update({ break_ended_at: now, break_ended_reason: reason })
      .eq('id', clockIn.id)
      .is('break_ended_at', null)
    if (error) return NextResponse.json({ error: 'Could not end break' }, { status: 500 })
    return NextResponse.json({
      success: true,
      ...(await resolveBreakState(supabase, {
        ...clockIn,
        break_started_at: state.break_started_at,
        break_ended_at: now,
        break_ended_reason: reason,
      })),
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
