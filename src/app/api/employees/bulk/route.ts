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
import { normalizePhone } from '@/lib/phone'

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

// Trim and collapse repeated internal whitespace in a cell.
function clean(v: unknown): string {
  return String(v ?? '').trim().replace(/\s+/g, ' ')
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.split(' ')
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') }
}

// Accepts YYYY-MM-DD or DD/MM/YYYY; returns canonical YYYY-MM-DD, else null.
function parseDate(raw: string): string | null {
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const [, d, mo, y] = m
    const dd = Number(d), mm = Number(mo)
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    }
  }
  return null
}

type ResultRow = {
  row: number
  phone?: string
  status: 'added' | 'skipped' | 'error'
  reason?: string
  whatsapp_sent?: boolean
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
    // Case-insensitive lookups; collapse internal whitespace on the keys too.
    const locByName = new Map(
      ((locs ?? []) as any[]).map((l) => [clean(l.name).toLowerCase(), { id: l.id, client: clean(l.client?.name).toLowerCase() }])
    )
    const supByName = new Map((sups ?? []).map((s) => [clean(s.name).toLowerCase(), s.id]))
    // Existing phones are normalized in the DB (migration 0004) — match on E.164.
    const takenPhones = new Set((existing ?? []).map((e) => e.phone))

    const results: ResultRow[] = []
    let added = 0
    let skipped = 0
    const seenInFile = new Set<string>() // de-dupe rows within this same upload

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const rowNum = i + 2 // account for the header row when reporting
      const err = (reason: string, phone?: string) => results.push({ row: rowNum, phone, status: 'error', reason })
      const skip = (reason: string, phone?: string) => { results.push({ row: rowNum, phone, status: 'skipped', reason }); skipped++ }

      const name = clean(r.name)
      if (!name) { err('Missing name'); continue }
      const { first, last } = splitName(name)
      if (!first) { err('Invalid name'); continue }

      const rawPhone = clean(r.phone)
      if (!rawPhone) { err('Missing phone'); continue }
      const phone = normalizePhone(rawPhone)
      if (!phone) { err(`Invalid UAE phone: ${rawPhone}`); continue }

      // Dedupe / upsert: already in the DB or earlier in this file → skip, not error.
      if (takenPhones.has(phone) || seenInFile.has(phone)) { skip('already exists', phone); continue }

      const shiftType = clean(r.shift_type).toLowerCase()
      if (shiftType !== '8h' && shiftType !== '10h') { err('shift_type must be 8h or 10h', phone); continue }

      const monthlyRaw = clean(r.monthly_salary)
      const hourly_rate = hourlyRateFromSalary(monthlyRaw as any, shiftType)
      if (hourly_rate == null) { err('monthly_salary must be a positive number', phone); continue }

      const locName = clean(r.location)
      if (!locName) { err('Missing location', phone); continue }
      const loc = locByName.get(locName.toLowerCase())
      if (!loc) { err(`Unknown location: ${locName}`, phone); continue }

      // vendor maps to the client; if given it must match the location's client (case-insensitive).
      const vendor = clean(r.vendor).toLowerCase()
      if (vendor && loc.client && vendor !== loc.client) {
        err(`Vendor "${clean(r.vendor)}" doesn't match location's client "${loc.client}"`, phone)
        continue
      }

      const joiningRaw = clean(r.joining_date)
      if (!joiningRaw) { err('Missing joining_date', phone); continue }
      const startDate = parseDate(joiningRaw)
      if (!startDate) { err(`Invalid joining_date: ${joiningRaw} (use YYYY-MM-DD or DD/MM/YYYY)`, phone); continue }

      const supKey = clean(r.supervisor).toLowerCase()
      const supervisor_id = supKey ? supByName.get(supKey) ?? null : null

      const { token, hash: tokenHash, expires } = generateSetupToken()
      const { data: emp, error } = await supabase
        .from('employees')
        .insert({
          tenant_id: tenantId,
          first_name: first,
          last_name: last,
          phone,
          nationality: clean(r.nationality) || null,
          role: 'picker',
          location_id: loc.id,
          supervisor_id,
          hourly_rate,
          monthly_salary: Number(monthlyRaw),
          shift_type: shiftType,
          shift_days: clean(r.shift_days) || null,
          branch: clean(r.branch) || null,
          // shift_start/shift_end intentionally unset — inherit location defaults.
          start_date: startDate,
          pin_setup_token_hash: tokenHash,
          pin_setup_expires: expires.toISOString(),
          employee_number: '',
          active: true,
        })
        .select('id')
        .single()

      if (error || !emp) { err(error?.message || 'Insert failed', phone); continue }
      takenPhones.add(phone)
      seenInFile.add(phone)
      added++

      const { success: waSent } = await sendPinSetupInvite({ firstName: first, phone, setupUrl: buildSetupUrl(token) })
      results.push({ row: rowNum, phone, status: 'added', whatsapp_sent: waSent })
    }

    return NextResponse.json({
      success: true,
      added,
      skipped,
      errors: results.filter((r) => r.status === 'error').length,
      results,
    })
  } catch (err) {
    console.error('Bulk create error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
