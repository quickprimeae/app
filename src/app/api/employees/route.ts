// src/app/api/employees/route.ts
// GET: list employees | POST: create employee + send WhatsApp invite

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { generateSetupToken, buildSetupUrl } from '@/lib/pin'
import { sendPinSetupInvite } from '@/lib/whatsapp'

// ── GET /api/employees ─────────────────────────────────────
export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient()
  const { searchParams } = new URL(req.url)
  const tenant_id = searchParams.get('tenant_id')
  const location_id = searchParams.get('location_id')
  const active = searchParams.get('active')

  let query = supabase
    .from('employees')
    .select(`
      *,
      location:locations(id, name, client_id),
      supervisor:ops_users(id, name)
    `)
    .order('created_at', { ascending: false })

  if (tenant_id) query = query.eq('tenant_id', tenant_id)
  if (location_id) query = query.eq('location_id', location_id)
  if (active !== null) query = query.eq('active', active === 'true')

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ employees: data })
}

// ── POST /api/employees ────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient()

  try {
    const body = await req.json()
    const {
      tenant_id,
      first_name,
      last_name,
      phone,
      nationality,
      location_id,
      supervisor_id,
      hourly_rate,
      shift_days,
      start_date,
      iban,
      bank_account_name,
    } = body

    // Validate required fields
    if (!tenant_id || !first_name || !last_name || !phone || !hourly_rate) {
      return NextResponse.json(
        { error: 'Missing required fields: first_name, last_name, phone, hourly_rate' },
        { status: 400 }
      )
    }

    // Check phone not already registered for this tenant
    const { data: existing } = await supabase
      .from('employees')
      .select('id')
      .eq('tenant_id', tenant_id)
      .eq('phone', phone)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: `Phone number ${phone} is already registered to another employee.` },
        { status: 409 }
      )
    }

    // Generate PIN setup token
    const { token, hash: tokenHash, expires } = generateSetupToken()

    // Create employee record
    const { data: employee, error: insertErr } = await supabase
      .from('employees')
      .insert({
        tenant_id,
        first_name,
        last_name,
        phone,
        nationality,
        location_id: location_id || null,
        supervisor_id: supervisor_id || null,
        hourly_rate,
        shift_days,
        start_date: start_date || new Date().toISOString().split('T')[0],
        iban: iban || null,
        bank_account_name: bank_account_name || null,
        pin_setup_token_hash: tokenHash,
        pin_setup_expires: expires.toISOString(),
        employee_number: '', // trigger will set this
      })
      .select('id, employee_number, first_name')
      .single()

    if (insertErr || !employee) {
      console.error('Employee insert error:', insertErr)
      return NextResponse.json(
        { error: 'Failed to create employee record' },
        { status: 500 }
      )
    }

    // Send WhatsApp invite
    const setupUrl = buildSetupUrl(token)
    const { success: waSent, error: waError } = await sendPinSetupInvite({
      firstName: first_name,
      phone,
      setupUrl,
    })

    return NextResponse.json({
      success: true,
      employee_id: employee.id,
      employee_number: employee.employee_number,
      whatsapp_sent: waSent,
      whatsapp_error: waError || null,
      // In development, return the setup URL directly for testing
      ...(process.env.NODE_ENV === 'development' ? { setup_url: setupUrl } : {}),
    })
  } catch (err) {
    console.error('Employee create error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
