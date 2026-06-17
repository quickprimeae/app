// src/app/api/clock-in/route.ts
// Handles picker clock-in: GPS geofence → PIN verify → optional selfie → record event

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { isWithinGeofence } from '@/lib/geofence'
import { verifyPin, hashToken } from '@/lib/pin'

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient()

  try {
    const body = await req.json()
    const {
      employee_id,
      location_id,
      lat,
      lng,
      gps_accuracy,
      pin,
      device_fingerprint,
      user_agent,
    } = body

    // ── 1. Validate required fields ────────────────────────
    if (!employee_id || !location_id || lat == null || lng == null || !pin) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // ── 2. Fetch employee and location ─────────────────────
    const [{ data: employee, error: empErr }, { data: location, error: locErr }] =
      await Promise.all([
        supabase
          .from('employees')
          .select('id, tenant_id, pin_hash, pin_set, pin_attempts, pin_locked_until, active, first_name, last_name, location_id')
          .eq('id', employee_id)
          .single(),
        supabase
          .from('locations')
          .select('id, tenant_id, name, lat, lng, geofence_radius, shift_start, shift_end, active')
          .eq('id', location_id)
          .single(),
      ])

    if (empErr || !employee) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    }
    if (locErr || !location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    // ── 3. Check employee is active ────────────────────────
    if (!employee.active) {
      return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
    }

    // ── 4. Check PIN is set up ─────────────────────────────
    if (!employee.pin_set || !employee.pin_hash) {
      return NextResponse.json(
        { error: 'PIN not set up. Check your WhatsApp for setup link.' },
        { status: 403 }
      )
    }

    // ── 5. Check PIN lockout ───────────────────────────────
    if (employee.pin_locked_until && new Date(employee.pin_locked_until) > new Date()) {
      const minutesLeft = Math.ceil(
        (new Date(employee.pin_locked_until).getTime() - Date.now()) / 60000
      )
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${minutesLeft} minute(s).` },
        { status: 429 }
      )
    }

    // ── 6. Verify PIN ──────────────────────────────────────
    const pinValid = await verifyPin(pin, employee.pin_hash)

    if (!pinValid) {
      // Register failure and potentially lock
      await supabase.rpc('register_pin_failure', { emp_id: employee_id })
      const attempts = (employee.pin_attempts || 0) + 1
      const remaining = Math.max(0, 5 - attempts)
      return NextResponse.json(
        {
          error: 'Incorrect PIN',
          attempts,
          remaining,
          locked: attempts >= 5,
        },
        { status: 401 }
      )
    }

    // Reset attempt counter on success
    await supabase.rpc('register_pin_success', { emp_id: employee_id })

    // ── 7. GPS geofence check (server-side) ───────────────
    const { passed: geofencePassed, distanceMetres } = isWithinGeofence(
      lat, lng,
      location.lat, location.lng,
      location.geofence_radius
    )

    if (!geofencePassed) {
      return NextResponse.json(
        {
          error: `You are ${distanceMetres}m from ${location.name}. You must be within ${location.geofence_radius}m to clock in.`,
          distance: distanceMetres,
          required: location.geofence_radius,
        },
        { status: 403 }
      )
    }

    // ── 8. Check for duplicate clock-in today ──────────────
    const today = new Date().toISOString().split('T')[0]
    const { data: existingClockIn } = await supabase
      .from('clock_events')
      .select('id')
      .eq('employee_id', employee_id)
      .eq('event_type', 'clock_in')
      .gte('timestamp', `${today}T00:00:00Z`)
      .lte('timestamp', `${today}T23:59:59Z`)
      .single()

    if (existingClockIn) {
      return NextResponse.json(
        { error: 'Already clocked in today' },
        { status: 409 }
      )
    }

    // ── 9. Selfie check is MANDATORY on every punch ───────
    // A live-camera selfie is required for every clock-in (anti-fraud: a random
    // check can't catch buddy-punching — the face must be verified every time).
    const selfieTriggered = true

    // ── 10. Record clock-in event ─────────────────────────
    const { data: clockEvent, error: insertErr } = await supabase
      .from('clock_events')
      .insert({
        tenant_id: employee.tenant_id,
        employee_id,
        location_id,
        event_type: 'clock_in',
        lat,
        lng,
        gps_accuracy,
        geofence_passed: true,
        verification_method: 'pin',
        pin_verified: true,
        selfie_triggered: selfieTriggered,
        device_fingerprint,
        user_agent,
      })
      .select('id, timestamp')
      .single()

    if (insertErr || !clockEvent) {
      console.error('Clock-in insert error:', insertErr)
      return NextResponse.json(
        { error: 'Failed to record clock-in' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      clock_event_id: clockEvent.id,
      timestamp: clockEvent.timestamp,
      selfie_required: selfieTriggered,
      employee_name: `${employee.first_name} ${employee.last_name}`,
    })
  } catch (err) {
    console.error('Clock-in error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
