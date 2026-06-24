// src/app/api/employees/lookup/route.ts
// GET /api/employees/lookup?phone=+9715...
// Resolves a picker by phone for the clock-in flow: returns their identity,
// assigned location + shift times, and today's clock-in/out state.
// Never returns the PIN hash.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { PILOT_TENANT_ID } from '@/lib/config'
import { normalizePhone } from '@/lib/phone'
import { resolveBreakState, type BreakRow } from '@/lib/break'

export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient()
  const { searchParams } = new URL(req.url)
  const phoneRaw = searchParams.get('phone')
  const tenant_id = searchParams.get('tenant_id') || PILOT_TENANT_ID

  if (!phoneRaw) {
    return NextResponse.json({ error: 'phone is required' }, { status: 400 })
  }
  // Accept whatever format the picker typed; match against the stored E.164 value.
  const phone = normalizePhone(phoneRaw)
  if (!phone) {
    return NextResponse.json(
      { error: 'Enter a valid UAE mobile number (e.g. 05XXXXXXXX).' },
      { status: 400 }
    )
  }

  const { data: employee, error } = await supabase
    .from('employees')
    .select(
      'id, first_name, last_name, employee_number, location_id, pin_set, active'
    )
    .eq('tenant_id', tenant_id)
    .eq('phone', phone)
    .maybeSingle()

  if (error) {
    console.error('Lookup error:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }
  if (!employee || !employee.active) {
    return NextResponse.json(
      { error: 'No active employee found for that number.' },
      { status: 404 }
    )
  }

  // Resolve the assigned location (needed to clock in/out).
  let location = null
  if (employee.location_id) {
    const { data: loc } = await supabase
      .from('locations')
      .select('id, name, chain, area, address, shift_start, shift_end, active')
      .eq('id', employee.location_id)
      .maybeSingle()
    if (loc && loc.active) location = loc
  }

  // Determine today's clock state.
  const today = new Date().toISOString().split('T')[0]
  const { data: events } = await supabase
    .from('clock_events')
    .select('id, event_type, timestamp, break_started_at, break_ended_at, break_ended_reason')
    .eq('employee_id', employee.id)
    .eq('voided', false)
    .gte('timestamp', `${today}T00:00:00Z`)
    .lte('timestamp', `${today}T23:59:59Z`)
    .order('timestamp', { ascending: true })

  const clockIn = events?.find((e) => e.event_type === 'clock_in')
  const clockOut = events?.find((e) => e.event_type === 'clock_out')

  // Break state lives on the open clock_in row. Resolve it (auto-ends on read)
  // only while still clocked in, so the picker screen restores exact state.
  let breakState = null
  if (clockIn && !clockOut) {
    breakState = await resolveBreakState(supabase, clockIn as BreakRow)
  }

  return NextResponse.json({
    employee: {
      id: employee.id,
      first_name: employee.first_name,
      last_name: employee.last_name,
      employee_number: employee.employee_number,
      pin_set: employee.pin_set,
    },
    location,
    today: {
      clocked_in: !!clockIn,
      clocked_out: !!clockOut,
      clock_in_time: clockIn?.timestamp ?? null,
      break_started_at: breakState?.break_started_at ?? null,
      break_ended_at: breakState?.break_ended_at ?? null,
      break_ended_reason: breakState?.break_ended_reason ?? null,
    },
  })
}
