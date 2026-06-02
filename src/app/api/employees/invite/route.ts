// src/app/api/employees/invite/route.ts
// Ops-only. POST { employee_id } — mints a FRESH PIN-setup token for an
// employee (rotating any previous one), stores its hash + 24h expiry, and
// returns the full setup URL for ops to copy / send manually.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getOpsContext } from '@/lib/ops'
import { generateSetupToken, buildSetupUrl } from '@/lib/pin'

export async function POST(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  try {
    const { employee_id } = await req.json()
    if (!employee_id) return NextResponse.json({ error: 'employee_id required' }, { status: 400 })

    const supabase = createServerSupabaseClient()
    const { data: emp } = await supabase
      .from('employees')
      .select('id, first_name, last_name, phone, pin_set')
      .eq('id', employee_id)
      .eq('tenant_id', ctx.opsUser.tenant_id)
      .maybeSingle()

    if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    if (emp.pin_set) {
      return NextResponse.json({ error: 'This employee has already set their PIN.' }, { status: 409 })
    }

    const { token, hash, expires } = generateSetupToken()
    const { error } = await supabase
      .from('employees')
      .update({ pin_setup_token_hash: hash, pin_setup_expires: expires.toISOString() })
      .eq('id', employee_id)
      .eq('tenant_id', ctx.opsUser.tenant_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({
      setup_url: buildSetupUrl(token),
      expires: expires.toISOString(),
      first_name: emp.first_name,
      last_name: emp.last_name,
      phone: emp.phone,
    })
  } catch (err) {
    console.error('Invite generation error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
