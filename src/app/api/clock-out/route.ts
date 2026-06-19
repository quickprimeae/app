// src/app/api/clock-out/route.ts
// Step 2 of the gated clock-out (multipart): writes the clock_out event + the
// shift (hours) ONLY after the live selfie + face match. Requires the token
// from /api/clock-out/verify. Verdict gate is identical to clock-in; a flagged
// punch (or a flagged clock-in) marks the resulting shift needs_review.
//
// PAYROLL: the hours math + shift insert below are byte-for-byte the same as the
// pre-split route — this change only moves WHEN the event is written and gates
// it on the face verdict.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { isWithinGeofence } from '@/lib/geofence'
import { verifyPunchToken, faceGate, isValidDescriptor } from '@/lib/punch'
import { faceThresholds } from '@/lib/face-config'

const SELFIE_BUCKET = 'selfies'

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient()
  try {
    // Gated COMMIT — multipart only (live selfie). A JSON body means a stale
    // client calling the pre-gating contract; return a clear 400, not a 500.
    const contentType = req.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { error: 'This step needs the live selfie. Fully reload the app (you may be on an old version) and clock out again.' },
        { status: 400 }
      )
    }
    const form = await req.formData()
    const get = (k: string) => form.get(k)
    const employee_id = String(get('employee_id') ?? '')
    const location_id = String(get('location_id') ?? '')
    const token = get('token')
    const lat = Number(get('lat'))
    const lng = Number(get('lng'))
    const gps_accuracy = get('gps_accuracy') != null ? Number(get('gps_accuracy')) : null
    const device_fingerprint = get('device_fingerprint') ? String(get('device_fingerprint')) : null
    const blockCountIn = Number(get('block_count') ?? 0) || 0
    const file = get('file')
    let descriptor: any = null
    try { descriptor = JSON.parse(String(get('descriptor') ?? 'null')) } catch { descriptor = null }

    if (!employee_id || !location_id || Number.isNaN(lat) || Number.isNaN(lng)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (!verifyPunchToken(typeof token === 'string' ? token : null, { employee_id, location_id, action: 'out' })) {
      return NextResponse.json({ error: 'Verification expired — please start again.' }, { status: 401 })
    }
    if (!isValidDescriptor(descriptor)) {
      return NextResponse.json({ error: 'No face captured — retake the selfie.' }, { status: 400 })
    }

    const [{ data: employee }, { data: location }] = await Promise.all([
      supabase.from('employees').select('id, tenant_id, active, first_name, last_name, face_descriptor, hourly_rate').eq('id', employee_id).single(),
      supabase.from('locations').select('id, name, lat, lng, geofence_radius').eq('id', location_id).single(),
    ])
    if (!employee || !location) return NextResponse.json({ error: 'Employee or location not found' }, { status: 404 })
    if (!employee.active) return NextResponse.json({ error: 'Account inactive' }, { status: 403 })

    const geo = isWithinGeofence(lat, lng, location.lat, location.lng, location.geofence_radius)
    if (!geo.passed) return NextResponse.json({ error: `You are ${geo.distanceMetres}m from ${location.name}.` }, { status: 403 })

    const today = new Date().toISOString().split('T')[0]
    const { data: clockIn } = await supabase
      .from('clock_events').select('id, timestamp, face_match_flagged').eq('employee_id', employee_id).eq('event_type', 'clock_in').eq('voided', false)
      .gte('timestamp', `${today}T00:00:00Z`).maybeSingle()
    if (!clockIn) return NextResponse.json({ error: 'No clock-in found for today' }, { status: 409 })

    const { data: existingOut } = await supabase
      .from('clock_events').select('id').eq('employee_id', employee_id).eq('event_type', 'clock_out').eq('voided', false)
      .gte('timestamp', `${today}T00:00:00Z`).maybeSingle()
    if (existingOut) return NextResponse.json({ error: 'Already clocked out today' }, { status: 409 })

    // ── Face gate ─────────────────────────────────────────────────────────
    const gate = faceGate(employee.face_descriptor, descriptor)
    if (gate.verdict === 'block') {
      const blockCount = blockCountIn + 1
      if (blockCount >= 3) {
        await supabase.from('alerts').insert({
          tenant_id: employee.tenant_id, type: 'faceflag', severity: 'warning',
          title: `Repeated face mismatch — ${employee.first_name} ${employee.last_name}`,
          body: `${blockCount} failed face checks at ${location.name} during clock-out. Review.`,
          employee_id, location_id, resolved: false,
        }).then(() => {}, () => {})
      }
      return NextResponse.json({ verdict: 'block', distance: gate.distance, blockCount, thresholds: faceThresholds() })
    }

    const flagged = gate.verdict !== 'pass'

    // ── Commit the clock_out event ────────────────────────────────────────
    const { data: clockOutEvent, error: outErr } = await supabase
      .from('clock_events')
      .insert({
        tenant_id: employee.tenant_id,
        employee_id, location_id,
        event_type: 'clock_out',
        lat, lng, gps_accuracy,
        geofence_passed: true,
        pin_verified: true, verification_method: 'pin',
        selfie_triggered: true,
        face_match_score: gate.distance,
        face_match_passed: gate.verdict === 'pass',
        face_match_flagged: flagged,
        device_fingerprint,
      })
      .select('id, timestamp')
      .single()
    if (outErr || !clockOutEvent) return NextResponse.json({ error: 'Failed to record clock-out' }, { status: 500 })

    if (file instanceof File) {
      const path = `${clockOutEvent.id}.jpg`
      const bytes = Buffer.from(await file.arrayBuffer())
      const { error: upErr } = await supabase.storage.from(SELFIE_BUCKET).upload(path, bytes, { contentType: 'image/jpeg', upsert: true })
      if (!upErr) await supabase.from('clock_events').update({ selfie_url: path }).eq('id', clockOutEvent.id)
    }

    // ── Hours + shift (UNCHANGED math) ────────────────────────────────────
    const clockInTime = new Date(clockIn.timestamp)
    const clockOutTime = new Date(clockOutEvent.timestamp)
    const hoursRaw = Math.round(
      ((clockOutTime.getTime() - clockInTime.getTime()) / 3600000) * 100
    ) / 100

    const needsReview = flagged || !!clockIn.face_match_flagged
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
      hourly_rate: employee.hourly_rate || 0,
      needs_review: needsReview,
      status: 'pending',
    })

    if (flagged) {
      await supabase.from('alerts').insert({
        tenant_id: employee.tenant_id, type: 'faceflag', severity: 'warning',
        title: `Face check flagged — ${employee.first_name} ${employee.last_name}`,
        body: gate.reason === 'no_reference'
          ? `Clock-out with no reference photo on file — verify manually.`
          : `Borderline face match on clock-out (distance ${gate.distance?.toFixed(3)}). Verify the selfie.`,
        employee_id, location_id, clock_event_id: clockOutEvent.id, resolved: false,
      }).then(() => {}, () => {})
    }

    await supabase.from('audit_logs').insert({
      tenant_id: employee.tenant_id, actor_user_id: null,
      entity_type: 'clock_event', entity_id: clockOutEvent.id, action: 'clock_out',
      before: null, after: { verdict: gate.verdict, distance: gate.distance, flagged, hours_raw: hoursRaw },
    }).then(() => {}, () => {})

    return NextResponse.json({
      success: true,
      verdict: gate.verdict,
      flagged,
      clock_event_id: clockOutEvent.id,
      timestamp: clockOutEvent.timestamp,
      hours_worked: hoursRaw,
    })
  } catch (err) {
    console.error('Clock-out commit error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
