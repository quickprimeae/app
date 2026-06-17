// src/app/api/clock-in/face-match/route.ts
// Picker punch face match (no session auth, same trust model as /clock-in).
// POST { clock_event_id, descriptor: number[128] }
//
// The live frame's descriptor is computed ON-DEVICE and only the numbers are
// sent here. The server holds the reference descriptor (never sent to the
// client), computes the euclidean distance, and returns the AUTHORITATIVE,
// gateable verdict (pass | flag | block) from the server-config thresholds —
// so Sub-step 3 can reuse this to gate the punch before commit.
//
// Sub-step 2 scope: also records the raw score on the clock_event for
// calibration. It does NOT yet flag the review queue or gate the punch.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { FACE_DESCRIPTOR_LENGTH, euclideanDistance, faceVerdict, faceThresholds } from '@/lib/face-config'

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient()

  try {
    const { clock_event_id, descriptor } = await req.json()
    if (!clock_event_id) return NextResponse.json({ error: 'clock_event_id required' }, { status: 400 })
    if (
      !Array.isArray(descriptor) ||
      descriptor.length !== FACE_DESCRIPTOR_LENGTH ||
      !descriptor.every((n) => typeof n === 'number' && Number.isFinite(n))
    ) {
      return NextResponse.json({ error: `descriptor must be ${FACE_DESCRIPTOR_LENGTH} finite numbers` }, { status: 400 })
    }

    // Resolve the punch -> employee, then the employee's stored reference.
    const { data: ev } = await supabase
      .from('clock_events')
      .select('id, employee_id')
      .eq('id', clock_event_id)
      .maybeSingle()
    if (!ev) return NextResponse.json({ error: 'Clock event not found' }, { status: 404 })

    const { data: emp } = await supabase
      .from('employees')
      .select('id, face_descriptor')
      .eq('id', ev.employee_id)
      .maybeSingle()

    const stored = emp?.face_descriptor as number[] | null | undefined

    // No reference on file -> cannot verify. Capture still happened; downstream
    // (Sub-step 3) auto-flags for review rather than silently passing.
    if (!stored || !Array.isArray(stored) || stored.length !== FACE_DESCRIPTOR_LENGTH) {
      return NextResponse.json({
        verdict: 'flag',
        reason: 'no_reference',
        distance: null,
        thresholds: faceThresholds(),
      })
    }

    const distance = euclideanDistance(descriptor, stored)
    const verdict = faceVerdict(distance)

    // Record the raw score for calibration (not gating / not flagging yet).
    await supabase
      .from('clock_events')
      .update({ face_match_score: distance, face_match_passed: verdict === 'pass' })
      .eq('id', clock_event_id)

    return NextResponse.json({ verdict, distance, thresholds: faceThresholds() })
  } catch (err) {
    console.error('Face match error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
