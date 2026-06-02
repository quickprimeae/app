// src/app/api/clock-in/selfie/route.ts
// POST (multipart): { clock_event_id, file } — stores the selfie in the
// private `selfies` bucket and attaches its path to the clock event.
//
// NOTE: AWS Rekognition face-matching is NOT wired here yet. This captures
// and stores the selfie and flags it for manual review; automated matching
// (face_match_score / face_match_passed) is a follow-up.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

const BUCKET = 'selfies'

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient()

  try {
    const form = await req.formData()
    const clockEventId = form.get('clock_event_id')
    const file = form.get('file')

    if (typeof clockEventId !== 'string' || !(file instanceof File)) {
      return NextResponse.json({ error: 'clock_event_id and file required' }, { status: 400 })
    }

    const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
    const path = `${clockEventId}.${ext}`
    const bytes = Buffer.from(await file.arrayBuffer())

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: file.type || 'image/jpeg', upsert: true })

    if (uploadErr) {
      console.error('Selfie upload error:', uploadErr.message)
      return NextResponse.json({ error: 'Failed to store selfie' }, { status: 500 })
    }

    const { error: updateErr } = await supabase
      .from('clock_events')
      .update({ selfie_url: path })
      .eq('id', clockEventId)

    if (updateErr) {
      console.error('Selfie attach error:', updateErr.message)
      return NextResponse.json({ error: 'Failed to attach selfie' }, { status: 500 })
    }

    return NextResponse.json({ success: true, path })
  } catch (err) {
    console.error('Selfie route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
