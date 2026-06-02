// src/app/api/clock-out/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { isWithinGeofence } from '@/lib/geofence'
import { verifyPin } from '@/lib/pin'

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient()

  try {
    const body = await req.json()
    const { employee_id, location_id, lat, lng, pin, device_fingerprint } = body

    if (!employee_id || !location_id || lat == null || lng == null || !pin) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Fetch employee
    const { data: employee } = await supabase
      .from('employees')
      .select('id, tenant_id, pin_hash, pin_set, pin_locked_until, pin_attempts, active')
      .eq('id', employee_id)
      .single()

    if (!employee?.active) {
      return NextResponse.json({ error: 'Employee not found or inactive' }, { status: 404 })
    }

    // Check lockout
    if (employee.pin_locked_until && new Date(employee.pin_locked_until) > new Date()) {
      return NextResponse.json({ error: 'Account locked. Try again later.' }, { status: 429 })
    }

    // Verify PIN
    const pinValid = await verifyPin(pin, employee.pin_hash || '')
    if (!pinValid) {
      await supabase.rpc('register_pin_failure', { emp_id: employee_id })
      return NextResponse.json({ error: 'Incorrect PIN' }, { status: 401 })
    }
    await supabase.rpc('register_pin_success', { emp_id: employee_id })

    // Fetch location
    const { data: location } = await supabase
      .from('locations')
      .select('id, lat, lng, geofence_radius, shift_end, name')
      .eq('id', location_id)
      .single()

    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    // GPS check
    const { passed, distanceMetres } = isWithinGeofence(
      lat, lng, location.lat, location.lng, location.geofence_radius
    )
    if (!passed) {
      return NextResponse.json({
        error: `You are ${distanceMetres}m from ${location.name}. Must be within ${location.geofence_radius}m to clock out.`,
      }, { status: 403 })
    }

    // Find today's clock-in event
    const today = new Date().toISOString().split('T')[0]
    const { data: clockIn } = await supabase
      .from('clock_events')
      .select('id, timestamp')
      .eq('employee_id', employee_id)
      .eq('event_type', 'clock_in')
      .gte('timestamp', `${today}T00:00:00Z`)
      .single()

    if (!clockIn) {
      return NextResponse.json({ error: 'No clock-in found for today' }, { status: 409 })
    }

    // Check no duplicate clock-out
    const { data: existingOut } = await supabase
      .from('clock_events')
      .select('id')
      .eq('employee_id', employee_id)
      .eq('event_type', 'clock_out')
      .gte('timestamp', `${today}T00:00:00Z`)
      .single()

    if (existingOut) {
      return NextResponse.json({ error: 'Already clocked out today' }, { status: 409 })
    }

    const now = new Date().toISOString()

    // Record clock-out
    const { data: clockOutEvent, error: outErr } = await supabase
      .from('clock_events')
      .insert({
        tenant_id: employee.tenant_id,
        employee_id,
        location_id,
        event_type: 'clock_out',
        lat, lng,
        geofence_passed: true,
        pin_verified: true,
        verification_method: 'pin',
        device_fingerprint,
      })
      .select('id, timestamp')
      .single()

    if (outErr || !clockOutEvent) {
      return NextResponse.json({ error: 'Failed to record clock-out' }, { status: 500 })
    }

    // Calculate hours and create shift record
    const clockInTime = new Date(clockIn.timestamp)
    const clockOutTime = new Date(clockOutEvent.timestamp)
    const hoursRaw = Math.round(
      ((clockOutTime.getTime() - clockInTime.getTime()) / 3600000) * 100
    ) / 100

    // Fetch hourly rate for snapshot
    const { data: emp } = await supabase
      .from('employees')
      .select('hourly_rate')
      .eq('id', employee_id)
      .single()

    await supabase.from('shifts').insert({
      tenant_id: employee.tenant_id,
      employee_id,
      location_id,
      date: today,
      clock_in_event_id: clockIn.id,
      clock_out_event_id: clockOutEvent.id,
      clock_in_time: clockIn.timestamp,
      clock_out_time: clockOutEvent.timestamp,
      hours_raw: hoursRaw,
      hours_final: hoursRaw,
      hourly_rate: emp?.hourly_rate || 0,
      status: 'pending',
    })

    return NextResponse.json({
      success: true,
      clock_event_id: clockOutEvent.id,
      timestamp: clockOutEvent.timestamp,
      hours_worked: hoursRaw,
    })
  } catch (err) {
    console.error('Clock-out error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
