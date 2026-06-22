// src/app/api/clock-in/verify/route.ts
// Step 1 of the gated clock-in: GPS + PIN (+ lockout/attempts) + duplicate
// check. Does NOT write a clock_event. On success returns a short-lived token
// the commit step requires — so the punch is only ever recorded after the
// selfie + face match. PIN/GPS failures stop here, before the camera opens.

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

    // Duplicate clock-in today?
    const today = new Date().toISOString().split('T')[0]
    const { data: existing } = await supabase
      .from('clock_events')
      .select('id')
      .eq('employee_id', employee_id)
      .eq('event_type', 'clock_in')
      .eq('voided', false)
      .gte('timestamp', `${today}T00:00:00Z`)
      .lte('timestamp', `${today}T23:59:59Z`)
      .maybeSingle()
    if (existing) return NextResponse.json({ error: 'Already clocked in today' }, { status: 409 })

    return NextResponse.json({
      ok: true,
      token: newToken(employee_id, location_id, 'in'),
      employee_name: `${pre.employee.first_name} ${pre.employee.last_name}`,
    })
  } catch (err) {
    console.error('Clock-in verify error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
