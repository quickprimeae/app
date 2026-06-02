// src/app/api/employees/photo/route.ts
// Ops-only. POST (multipart): { employee_id, file } — stores a reference
// photo in the private `reference-photos` bucket and marks has_photo=true.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getOpsContext } from '@/lib/ops'

const BUCKET = 'reference-photos'

export async function POST(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  const supabase = createServerSupabaseClient()

  try {
    const form = await req.formData()
    const employeeId = form.get('employee_id')
    const file = form.get('file')
    if (typeof employeeId !== 'string' || !(file instanceof File)) {
      return NextResponse.json({ error: 'employee_id and file required' }, { status: 400 })
    }

    const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
    const path = `${employeeId}.${ext}`
    const bytes = Buffer.from(await file.arrayBuffer())

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: file.type || 'image/jpeg', upsert: true })
    if (uploadErr) {
      console.error('Reference photo upload error:', uploadErr.message)
      return NextResponse.json({ error: 'Failed to store photo' }, { status: 500 })
    }

    const { error: updateErr } = await supabase
      .from('employees')
      .update({ reference_photo_url: path, has_photo: true })
      .eq('id', employeeId)
      .eq('tenant_id', ctx.opsUser.tenant_id)
    if (updateErr) return NextResponse.json({ error: 'Failed to attach photo' }, { status: 500 })

    return NextResponse.json({ success: true, path })
  } catch (err) {
    console.error('Photo route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
