// src/app/api/employees/bulk/route.ts
// Ops-only. POST { rows: [...] } — creates many employees from a parsed CSV.
// Columns: name, phone, nationality, shift_type, monthly_salary, shift_days,
// joining_date, location, supervisor, vendor, branch. hourly_rate is derived
// (monthly_salary / 26 / shift_hours). Shift start/end are NOT set — pickers
// inherit the location defaults. Sends each a PIN-setup WhatsApp invite.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getOpsContext } from '@/lib/ops'
import { generateSetupToken, buildSetupUrl } from '@/lib/pin'
import { sendPinSetupInvite } from '@/lib/whatsapp'
import { hourlyRateFromSalary } from '@/lib/salary'

type InRow = {
  name?: string
  phone?: string
  nationality?: string
  shift_type?: string
  monthly_salary?: string | number
  shift_days?: string
  joining_date?: string
  location?: string
  supervisor?: string
  vendor?: string
  branch?: string
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/)
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') }
}

// UAE mobile "5xxxxxxxx" (also tolerates 0-prefix or existing +971) -> +9715xxxxxxxx
function normPhone(phone: string): string {
  let d = phone.replace(/\D/g, '')
  if (d.startsWith('971')) d = d.slice(3)
  if (d.startsWith('0')) d = d.slice(1)
  return `+971${d}`
}

export async function POST(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  const tenantId = ctx.opsUser.tenant_id
  const supabase = createServerSupabaseClient()

  try {
    const { rows } = (await req.json()) as { rows: InRow[] }
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'rows array required' }, { status: 400 })
    }
    if (rows.length > 500) {
      return NextResponse.json({ error: 'Max 500 rows per upload' }, { status: 400 })
    }

    // Resolve lookups once. Locations carry their client name for vendor checks.
    const [{ data: locs }, { data: sups }, { data: existing }] = await Promise.all([
      supabase.from('locations').select('id, name, client:clients(name)').eq('tenant_id', tenantId),
      supabase.from('ops_users').select('id, name').eq('tenant_id', tenantId),
      supabase.from('employees').select('phone').eq('tenant_id', tenantId),
    ])
    const locByName = new Map(
      ((locs ?? []) as any[]).map((l) => [l.name.trim().toLowerCase(), { id: l.id, client: (l.client?.name ?? '').toLowerCase() }])
    )
    const supByName = new Map((sups ?? []).map((s) => [(s.name ?? '').trim().toLowerCase(), s.id]))
    const takenPhones = new Set((existing ?? []).map((e) => e.phone))

    const results: { row: number; phone?: string; ok: boolean; error?: string; whatsapp_sent?: boolean }[] = []
    let created = 0

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const fail = (error: string, phone?: string) => results.push({ row: i + 1, phone, ok: false, error })

      if (!r.name?.trim()) { fail('Missing name'); continue }
      const { first, last } = splitName(r.name)
      if (!first) { fail('Invalid name'); continue }

      if (!r.phone?.trim()) { fail('Missing phone'); continue }
      const phone = normPhone(r.phone)
      if (!/^\+9715\d{8}$/.test(phone)) { fail(`Invalid UAE phone: ${r.phone}`, phone); continue }
      if (takenPhones.has(phone)) { fail('Phone already registered', phone); continue }

      const shiftType = r.shift_type?.trim()
      if (shiftType !== '8h' && shiftType !== '10h') { fail('shift_type must be 8h or 10h', phone); continue }

      const hourly_rate = hourlyRateFromSalary(r.monthly_salary as any, shiftType)
      if (hourly_rate == null) { fail('monthly_salary must be a positive number', phone); continue }

      if (!r.location?.trim()) { fail('Missing location', phone); continue }
      const loc = locByName.get(r.location.trim().toLowerCase())
      if (!loc) { fail(`Unknown location: ${r.location}`, phone); continue }

      // vendor maps to the client; if given it must match the location's client.
      const vendor = r.vendor?.trim().toLowerCase()
      if (vendor && loc.client && vendor !== loc.client) {
        fail(`Vendor "${r.vendor}" doesn't match location's client "${loc.client}"`, phone)
        continue
      }

      const supervisor_id = r.supervisor ? supByName.get(r.supervisor.trim().toLowerCase()) ?? null : null

      const { token, hash: tokenHash, expires } = generateSetupToken()
      const { data: emp, error } = await supabase
        .from('employees')
        .insert({
          tenant_id: tenantId,
          first_name: first,
          last_name: last,
          phone,
          nationality: r.nationality?.trim() || null,
          role: 'picker',
          location_id: loc.id,
          supervisor_id,
          hourly_rate,
          monthly_salary: Number(r.monthly_salary),
          shift_type: shiftType,
          shift_days: r.shift_days?.trim() || null,
          branch: r.branch?.trim() || null,
          // shift_start/shift_end intentionally unset — inherit location defaults.
          start_date: r.joining_date?.trim() || new Date().toISOString().split('T')[0],
          pin_setup_token_hash: tokenHash,
          pin_setup_expires: expires.toISOString(),
          employee_number: '',
          active: true,
        })
        .select('id')
        .single()

      if (error || !emp) { fail(error?.message || 'Insert failed', phone); continue }
      takenPhones.add(phone)
      created++

      const { success: waSent } = await sendPinSetupInvite({ firstName: first, phone, setupUrl: buildSetupUrl(token) })
      results.push({ row: i + 1, phone, ok: true, whatsapp_sent: waSent })
    }

    return NextResponse.json({
      success: true,
      created,
      failed: results.filter((r) => !r.ok).length,
      results,
    })
  } catch (err) {
    console.error('Bulk create error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
