// src/app/api/setup-pin/route.ts
// Called when a picker follows their WhatsApp setup link and sets their PIN

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { hashPin, hashToken } from '@/lib/pin'

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient()

  try {
    const { token, pin } = await req.json()

    if (!token || !pin || pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      return NextResponse.json(
        { error: 'Invalid request. PIN must be exactly 6 digits.' },
        { status: 400 }
      )
    }

    // Hash the incoming token to find the employee
    const tokenHash = hashToken(token)

    const { data: employee, error } = await supabase
      .from('employees')
      .select('id, pin_setup_expires, pin_set, first_name')
      .eq('pin_setup_token_hash', tokenHash)
      .eq('active', true)
      .single()

    if (error || !employee) {
      return NextResponse.json(
        { error: 'Invalid or expired setup link. Ask your supervisor for a new one.' },
        { status: 404 }
      )
    }

    // Check token hasn't expired
    if (!employee.pin_setup_expires || new Date(employee.pin_setup_expires) < new Date()) {
      return NextResponse.json(
        { error: 'This setup link has expired. Ask your supervisor for a new one.' },
        { status: 410 }
      )
    }

    // Hash the PIN
    const pinHash = await hashPin(pin)

    // Save PIN and clear setup token
    const { error: updateErr } = await supabase
      .from('employees')
      .update({
        pin_hash: pinHash,
        pin_set: true,
        pin_setup_token_hash: null,
        pin_setup_expires: null,
        pin_attempts: 0,
      })
      .eq('id', employee.id)

    if (updateErr) {
      console.error('PIN save error:', updateErr)
      return NextResponse.json(
        { error: 'Failed to save PIN. Please try again.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      first_name: employee.first_name,
      message: 'PIN set successfully. You can now clock in.',
    })
  } catch (err) {
    console.error('Setup PIN error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET — validate token without setting PIN (used to pre-check link on page load)
export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient()
  const { searchParams } = new URL(req.url)
  const token = searchParams.get('token')

  if (!token) {
    return NextResponse.json({ valid: false, error: 'No token provided' }, { status: 400 })
  }

  const tokenHash = hashToken(token)

  const { data: employee } = await supabase
    .from('employees')
    .select('id, first_name, pin_setup_expires, pin_set')
    .eq('pin_setup_token_hash', tokenHash)
    .eq('active', true)
    .single()

  if (!employee) {
    return NextResponse.json({ valid: false, error: 'Invalid link' })
  }

  if (employee.pin_set) {
    return NextResponse.json({ valid: false, error: 'PIN already set up' })
  }

  if (!employee.pin_setup_expires || new Date(employee.pin_setup_expires) < new Date()) {
    return NextResponse.json({ valid: false, error: 'Link expired' })
  }

  return NextResponse.json({
    valid: true,
    first_name: employee.first_name,
  })
}
