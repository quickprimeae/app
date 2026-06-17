// src/app/api/employees/face-descriptor/route.ts
// Ops-only. POST { employee_id, descriptor: number[128] }
// Stores the on-device-computed reference face descriptor for an employee.
// Receives only the array of numbers — never the image.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getOpsContext } from '@/lib/ops'
import { FACE_DESCRIPTOR_LENGTH } from '@/lib/face-config'

export async function POST(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  try {
    const { employee_id, descriptor } = await req.json()
    if (!employee_id) return NextResponse.json({ error: 'employee_id required' }, { status: 400 })
    if (
      !Array.isArray(descriptor) ||
      descriptor.length !== FACE_DESCRIPTOR_LENGTH ||
      !descriptor.every((n) => typeof n === 'number' && Number.isFinite(n))
    ) {
      return NextResponse.json({ error: `descriptor must be ${FACE_DESCRIPTOR_LENGTH} finite numbers` }, { status: 400 })
    }

    const supabase = createServerSupabaseClient()
    const { error } = await supabase
      .from('employees')
      .update({ face_descriptor: descriptor })
      .eq('id', employee_id)
      .eq('tenant_id', ctx.opsUser.tenant_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Store face descriptor error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
