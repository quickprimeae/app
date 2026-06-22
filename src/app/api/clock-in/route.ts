// src/app/api/clock-in/route.ts
// Step 2 of the gated clock-in (multipart): the clock_event is written HERE,
// only after the live selfie + face match. Requires the token from
// /api/clock-in/verify (proves GPS + PIN passed). Verdict gate:
//   pass            -> commit
//   flag (0.5-0.6)  -> commit, but face_match_flagged + faceflag alert
//   no reference    -> commit, but face_match_flagged + alert (never silent)
//   block (>0.6)    -> DO NOT commit; after 3 blocks raise an alert
// The captured frame + match score are stored on the committed event as
// evidence. GPS/PIN/dup logic is unchanged from the pre-split route.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { isWithinGeofence } from '@/lib/geofence'
import { verifyPunchToken, faceGate, isValidDescriptor } from '@/lib/punch'
import { faceThresholds } from '@/lib/face-config'

const SELFIE_BUCKET = 'selfies'

export const preferredRegion = 'bom1' // colocate with ap-south-1 Supabase DB

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient()
  try {
    // This is the gated COMMIT: it only accepts the multipart form produced by
    // the live-selfie capture. A JSON body here means a stale client bundle is
    // calling the pre-gating contract — return a clear 400, never a raw 500.
    const contentType = req.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { error: 'This step needs the live selfie. Fully reload the app (you may be on an old version) and clock in again.' },
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
    const user_agent = get('user_agent') ? String(get('user_agent')) : null
    const blockCountIn = Number(get('block_count') ?? 0) || 0
    const file = get('file')
    let descriptor: any = null
    try { descriptor = JSON.parse(String(get('descriptor') ?? 'null')) } catch { descriptor = null }

    if (!employee_id || !location_id || Number.isNaN(lat) || Number.isNaN(lng)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    // The token proves PIN + GPS were verified moments ago for this punch.
    if (!verifyPunchToken(typeof token === 'string' ? token : null, { employee_id, location_id, action: 'in' })) {
      return NextResponse.json({ error: 'Verification expired — please start again.' }, { status: 401 })
    }
    if (!isValidDescriptor(descriptor)) {
      return NextResponse.json({ error: 'No face captured — retake the selfie.' }, { status: 400 })
    }

    // Re-fetch + re-check (state may have changed between verify and commit).
    const [{ data: employee }, { data: location }] = await Promise.all([
      supabase.from('employees').select('id, tenant_id, active, first_name, last_name, face_descriptor').eq('id', employee_id).single(),
      supabase.from('locations').select('id, name, lat, lng, geofence_radius').eq('id', location_id).single(),
    ])
    if (!employee || !location) return NextResponse.json({ error: 'Employee or location not found' }, { status: 404 })
    if (!employee.active) return NextResponse.json({ error: 'Account inactive' }, { status: 403 })

    const geo = isWithinGeofence(lat, lng, location.lat, location.lng, location.geofence_radius)
    if (!geo.passed) {
      return NextResponse.json({ error: `You are ${geo.distanceMetres}m from ${location.name}.` }, { status: 403 })
    }

    const today = new Date().toISOString().split('T')[0]
    const { data: dup } = await supabase
      .from('clock_events').select('id').eq('employee_id', employee_id).eq('event_type', 'clock_in').eq('voided', false)
      .gte('timestamp', `${today}T00:00:00Z`).lte('timestamp', `${today}T23:59:59Z`).maybeSingle()
    if (dup) return NextResponse.json({ error: 'Already clocked in today' }, { status: 409 })

    // ── Face gate (server-authoritative) ──────────────────────────────────
    const gate = faceGate(employee.face_descriptor, descriptor)

    if (gate.verdict === 'block') {
      const blockCount = blockCountIn + 1
      if (blockCount >= 3) {
        await supabase.from('alerts').insert({
          tenant_id: employee.tenant_id, type: 'faceflag', severity: 'warning',
          title: `Repeated face mismatch — ${employee.first_name} ${employee.last_name}`,
          body: `${blockCount} failed face checks at ${location.name} during clock-in. Possible buddy-punch, or a bad reference photo — review.`,
          employee_id, location_id, resolved: false,
        }).then(() => {}, () => {})
      }
      return NextResponse.json({ verdict: 'block', distance: gate.distance, blockCount, thresholds: faceThresholds() })
    }

    const flagged = gate.verdict !== 'pass' // 'flag' or no-reference

    // ── Commit the clock_event ────────────────────────────────────────────
    const { data: clockEvent, error: insErr } = await supabase
      .from('clock_events')
      .insert({
        tenant_id: employee.tenant_id,
        employee_id, location_id,
        event_type: 'clock_in',
        lat, lng, gps_accuracy,
        geofence_passed: true,
        verification_method: 'pin', pin_verified: true,
        selfie_triggered: true,
        face_match_score: gate.distance,
        face_match_passed: gate.verdict === 'pass',
        face_match_flagged: flagged,
        device_fingerprint, user_agent,
      })
      .select('id, timestamp')
      .single()
    if (insErr || !clockEvent) {
      console.error('Clock-in commit insert error:', insErr)
      return NextResponse.json({ error: 'Failed to record clock-in' }, { status: 500 })
    }

    // Store the captured frame as evidence and link it to the event.
    if (file instanceof File) {
      const path = `${clockEvent.id}.jpg`
      const bytes = Buffer.from(await file.arrayBuffer())
      const { error: upErr } = await supabase.storage.from(SELFIE_BUCKET).upload(path, bytes, { contentType: 'image/jpeg', upsert: true })
      if (!upErr) await supabase.from('clock_events').update({ selfie_url: path }).eq('id', clockEvent.id)
    }

    // Flagged punch -> review queue (best-effort; clock_event_id from 0010).
    if (flagged) {
      await supabase.from('alerts').insert({
        tenant_id: employee.tenant_id, type: 'faceflag', severity: 'warning',
        title: `Face check flagged — ${employee.first_name} ${employee.last_name}`,
        body: gate.reason === 'no_reference'
          ? `Clock-in with no reference photo on file — verify manually.`
          : `Borderline face match on clock-in (distance ${gate.distance?.toFixed(3)}). Verify the selfie.`,
        employee_id, location_id, clock_event_id: clockEvent.id, resolved: false,
      }).then(() => {}, () => {})
    }

    await supabase.from('audit_logs').insert({
      tenant_id: employee.tenant_id, actor_user_id: null,
      entity_type: 'clock_event', entity_id: clockEvent.id, action: 'clock_in',
      before: null, after: { verdict: gate.verdict, distance: gate.distance, flagged },
    }).then(() => {}, () => {})

    return NextResponse.json({
      success: true,
      verdict: gate.verdict,
      flagged,
      clock_event_id: clockEvent.id,
      timestamp: clockEvent.timestamp,
    })
  } catch (err) {
    console.error('Clock-in commit error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
