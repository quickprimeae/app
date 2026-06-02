// src/app/api/employees/bulk/route.ts
// Ops-only. POST { rows: [...] } — creates many employees from a parsed CSV,
// resolving location names -> ids, then sends each a PIN-setup WhatsApp invite.
// Returns per-row results so the UI can report successes/failures.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getOpsContext } from '@/lib/ops'
import { generateSetupToken, buildSetupUrl } from '@/lib/pin'
import { sendPinSetupInvite } from '@/lib/whatsapp'

type InRow = {
  first_name?: string
  last_name?: string
  phone?: string
  employee_id?: string
  nationality?: string
  start_date?: string
  location?: string
  shift_days?: string
  hourly_rate?: string | number
  supervisor?: string
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

    // Resolve lookups once.
    const [{ data: locs }, { data: sups }, { data: existing }] = await Promise.all([
      supabase.from('locations').select('id, name').eq('tenant_id', tenantId),
      supabase.from('ops_users').select('id, name').eq('tenant_id', tenantId),
      supabase.from('employees').select('phone').eq('tenant_id', tenantId),
    ])
    const locByName = new Map((locs ?? []).map((l) => [l.name.trim().toLowerCase(), l.id]))
    const supByName = new Map((sups ?? []).map((s) => [(s.name ?? '').trim().toLowerCase(), s.id]))
    const takenPhones = new Set((existing ?? []).map((e) => e.phone))

    const results: { row: number; phone?: string; ok: boolean; error?: string; whatsapp_sent?: boolean }[] = []
    let created = 0

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const phone = r.phone?.trim()
      if (!r.first_name?.trim() || !r.last_name?.trim() || !phone) {
        results.push({ row: i + 1, phone, ok: false, error: 'Missing required fields' })
        continue
      }
      if (takenPhones.has(phone)) {
        results.push({ row: i + 1, phone, ok: false, error: 'Phone already registered' })
        continue
      }
      const location_id = r.location ? locByName.get(r.location.trim().toLowerCase()) ?? null : null
      if (r.location && !location_id) {
        results.push({ row: i + 1, phone, ok: false, error: `Unknown location: ${r.location}` })
        continue
      }
      const supervisor_id = r.supervisor ? supByName.get(r.supervisor.trim().toLowerCase()) ?? null : null

      const { token, hash: tokenHash, expires } = generateSetupToken()
      const { data: emp, error } = await supabase
        .from('employees')
        .insert({
          tenant_id: tenantId,
          first_name: r.first_name.trim(),
          last_name: r.last_name.trim(),
          phone,
          nationality: r.nationality?.trim() || null,
          role: 'picker',
          location_id,
          supervisor_id,
          hourly_rate: r.hourly_rate ? Number(r.hourly_rate) : 0,
          shift_days: r.shift_days?.trim() || null,
          start_date: r.start_date?.trim() || new Date().toISOString().split('T')[0],
          pin_setup_token_hash: tokenHash,
          pin_setup_expires: expires.toISOString(),
          employee_number: r.employee_id?.trim() || '',
          active: true,
        })
        .select('id')
        .single()

      if (error || !emp) {
        results.push({ row: i + 1, phone, ok: false, error: error?.message || 'Insert failed' })
        continue
      }
      takenPhones.add(phone)
      created++

      const { success: waSent } = await sendPinSetupInvite({
        firstName: r.first_name.trim(),
        phone,
        setupUrl: buildSetupUrl(token),
      })
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
