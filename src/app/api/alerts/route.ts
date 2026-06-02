// src/app/api/alerts/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

// GET /api/alerts — fetch alerts for ops dashboard
export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient()
  const { searchParams } = new URL(req.url)
  const tenant_id = searchParams.get('tenant_id')
  const resolved = searchParams.get('resolved')
  const limit = parseInt(searchParams.get('limit') || '50')

  let query = supabase
    .from('alerts')
    .select(`
      *,
      employee:employees(id, first_name, last_name, employee_number),
      location:locations(id, name)
    `)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (tenant_id) query = query.eq('tenant_id', tenant_id)
  if (resolved !== null) query = query.eq('resolved', resolved === 'true')

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ alerts: data })
}

// PATCH /api/alerts — resolve an alert
export async function PATCH(req: NextRequest) {
  const supabase = createServerSupabaseClient()

  try {
    const { alert_id, resolved_by, resolution_note } = await req.json()

    if (!alert_id) {
      return NextResponse.json({ error: 'alert_id required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('alerts')
      .update({
        resolved: true,
        resolved_at: new Date().toISOString(),
        resolved_by: resolved_by || null,
        resolution_note: resolution_note || null,
      })
      .eq('id', alert_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
