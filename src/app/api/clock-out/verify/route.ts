// src/app/api/clock-out/verify/route.ts
// Step 1 of the gated clock-out: GPS + PIN, plus "has a clock-in today" and
// "not already clocked out" — all before the camera. No write. Returns the
// short-lived token the commit step requires.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { preCheck, newToken } from '@/lib/punch'

export const preferredRegion = 'bom1' // colocate with ap-south-1 Supabase DB

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient()
  try {
    const { employee_id, location_id, lat, lng, pin } = await req.json()
    if (!employee_id || !location_id || lat == null || lng == null || !pin) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const pre = await preCheck(supabase, { employee_id, location_id, lat, lng, pin, countPin: true })
    if (!pre.ok) return NextResponse.json(pre.body, { status: pre.status })

    const today = new Date().toISOString().split('T')[0]
    const { data: clockIn } = await supabase
      .from('clock_events').select('id').eq('employee_id', employee_id).eq('event_type', 'clock_in').eq('voided', false)
      .gte('timestamp', `${today}T00:00:00Z`).maybeSingle()
    if (!clockIn) return NextResponse.json({ error: 'No clock-in found for today' }, { status: 409 })

    const { data: existingOut } = await supabase
      .from('clock_events').select('id').eq('employee_id', employee_id).eq('event_type', 'clock_out').eq('voided', false)
      .gte('timestamp', `${today}T00:00:00Z`).maybeSingle()
    if (existingOut) return NextResponse.json({ error: 'Already clocked out today' }, { status: 409 })

    return NextResponse.json({
      ok: true,
      token: newToken(employee_id, location_id, 'out'),
      employee_name: `${pre.employee.first_name} ${pre.employee.last_name}`,
    })
  } catch (err) {
    console.error('Clock-out verify error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
