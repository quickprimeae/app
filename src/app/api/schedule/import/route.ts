// src/app/api/schedule/import/route.ts
// Ops-only. POST { rows: [{ identifier, cells: { [date]: cellText } }], dates }
// Imports a weekly schedule grid into scheduled_shifts. `identifier` is the
// picker's Picker ID (employee_number, e.g. OP-0001) — the SOLE match key.
//
// Per cell (one picker on one date):
//   • a time range  → upsert a 'scheduled' shift (origin 'csv') for that date
//   • blank / OFF   → ensure the picker is OFF that date (delete any existing row)
// Upsert key is (employee_id, date), so re-importing a corrected week updates
// rather than duplicates. Location is derived from the employee's assigned
// location. One audit_logs summary row is written per import.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getOpsContext } from '@/lib/ops'
import { parseCell, isDateHeader } from '@/lib/schedule'

type InRow = { identifier?: string; cells?: Record<string, string> }

type RowResult = {
  row: number
  identifier: string
  name?: string
  added: number
  updated: number
  removed: number
  skipped: number
  skippedCancelled: number
  errors: { date: string; reason: string }[]
}

const clean = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ')

export async function POST(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  const tenantId = ctx.opsUser.tenant_id
  const supabase = createServerSupabaseClient()

  try {
    const { rows, dates } = (await req.json()) as { rows: InRow[]; dates: string[] }
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'rows array required' }, { status: 400 })
    }
    if (!Array.isArray(dates) || dates.length === 0 || !dates.every(isDateHeader)) {
      return NextResponse.json({ error: 'dates must be a non-empty array of YYYY-MM-DD headers' }, { status: 400 })
    }
    if (rows.length > 1000) {
      return NextResponse.json({ error: 'Max 1000 rows per import' }, { status: 400 })
    }

    // Resolve all employees for this tenant once; match SOLELY by Picker ID
    // (employee_number, e.g. OP-0001), case-insensitive. Phone matching was
    // removed — the Picker ID is now the one key.
    const { data: emps } = await supabase
      .from('employees')
      .select('id, employee_number, location_id, active, first_name, last_name')
      .eq('tenant_id', tenantId)
    const byNumber = new Map<string, any>()
    for (const e of (emps ?? []) as any[]) {
      if (e.employee_number) byNumber.set(String(e.employee_number).toUpperCase(), e)
    }

    // Match each row to an employee first, so we can preload existing shifts for
    // exactly the matched employees over the imported dates.
    const seen = new Set<string>()
    type Matched = { row: number; identifier: string; emp: any | null; reason?: string }
    const matched: Matched[] = rows.map((r, i) => {
      const identifier = clean(r.identifier)
      const rowNum = i + 2 // +1 header, +1 to 1-base
      if (!identifier) return { row: rowNum, identifier, emp: null, reason: 'Missing Picker ID' }
      const emp = byNumber.get(identifier.toUpperCase())
      if (!emp) return { row: rowNum, identifier, emp: null, reason: `No active picker has Picker ID "${identifier}"` }
      if (!emp.active) return { row: rowNum, identifier, emp: null, reason: `${emp.first_name} ${emp.last_name} is deactivated` }
      if (!emp.location_id) return { row: rowNum, identifier, emp: null, reason: `${emp.first_name} ${emp.last_name} has no assigned location` }
      if (seen.has(emp.id)) return { row: rowNum, identifier, emp: null, reason: 'Duplicate employee — already listed earlier in this file' }
      seen.add(emp.id)
      return { row: rowNum, identifier, emp }
    })

    const matchedIds = matched.filter((m) => m.emp).map((m) => m.emp.id)

    // Preload existing shifts for these employees over the imported dates so we
    // can classify each cell as added / updated / unchanged, and find rows to
    // delete for OFF cells.
    const existing = new Map<string, any>() // `${employee_id}|${date}` -> row
    if (matchedIds.length > 0) {
      const { data: ex } = await supabase
        .from('scheduled_shifts')
        .select('id, employee_id, date, start_time, end_time, status')
        .eq('tenant_id', tenantId)
        .in('employee_id', matchedIds)
        .in('date', dates)
      for (const s of (ex ?? []) as any[]) existing.set(`${s.employee_id}|${s.date}`, s)
    }

    const toUpsert: any[] = []
    const toDelete: string[] = [] // scheduled_shift ids
    const results: RowResult[] = []
    const hhmm = (t: string) => String(t).slice(0, 5)

    for (const m of matched) {
      const rr: RowResult = { row: m.row, identifier: m.identifier, name: m.emp ? `${m.emp.first_name} ${m.emp.last_name}`.trim() : undefined, added: 0, updated: 0, removed: 0, skipped: 0, skippedCancelled: 0, errors: [] }
      if (!m.emp) {
        rr.errors.push({ date: '*', reason: m.reason || 'Unmatched' })
        results.push(rr)
        continue
      }
      const cells = rows[m.row - 2]?.cells ?? {}
      for (const date of dates) {
        const key = `${m.emp.id}|${date}`
        const prior = existing.get(key)
        // A manually cancelled shift is protected: re-import never overwrites it.
        // Reviving it stays a deliberate grid action.
        if (prior && prior.status === 'cancelled') {
          rr.skippedCancelled++
          continue
        }
        const parsed = parseCell(cells[date] ?? '')
        if (parsed.kind === 'error') {
          rr.errors.push({ date, reason: parsed.reason })
          continue
        }
        if (parsed.kind === 'off') {
          if (prior) { toDelete.push(prior.id); rr.removed++ } else rr.skipped++
          continue
        }
        // shift
        if (prior && prior.status === 'scheduled' && hhmm(prior.start_time) === hhmm(parsed.start) && hhmm(prior.end_time) === hhmm(parsed.end)) {
          rr.skipped++ // identical — no write
          continue
        }
        toUpsert.push({
          tenant_id: tenantId,
          employee_id: m.emp.id,
          location_id: m.emp.location_id,
          date,
          start_time: parsed.start,
          end_time: parsed.end,
          status: 'scheduled',
          origin: 'csv',
          reassigned_to_employee_id: null, // a re-import resets any prior cover
          assigned_by: ctx.opsUser!.id,
        })
        if (prior) rr.updated++
        else rr.added++
      }
      results.push(rr)
    }

    // Apply deletes then upserts.
    if (toDelete.length > 0) {
      const { error: delErr } = await supabase.from('scheduled_shifts').delete().in('id', toDelete)
      if (delErr) return NextResponse.json({ error: `Delete failed: ${delErr.message}` }, { status: 500 })
    }
    if (toUpsert.length > 0) {
      const { error: upErr } = await supabase
        .from('scheduled_shifts')
        .upsert(toUpsert, { onConflict: 'employee_id,date' })
      if (upErr) return NextResponse.json({ error: `Upsert failed: ${upErr.message}` }, { status: 500 })
    }

    const totals = results.reduce(
      (a, r) => ({
        added: a.added + r.added,
        updated: a.updated + r.updated,
        removed: a.removed + r.removed,
        skipped: a.skipped + r.skipped,
        skippedCancelled: a.skippedCancelled + r.skippedCancelled,
        errors: a.errors + r.errors.length,
      }),
      { added: 0, updated: 0, removed: 0, skipped: 0, skippedCancelled: 0, errors: 0 }
    )

    // One append-only audit row summarizing the import.
    await supabase.from('audit_logs').insert({
      tenant_id: tenantId,
      actor_user_id: ctx.opsUser.id,
      entity_type: 'schedule_import',
      entity_id: null,
      action: 'import',
      before: null,
      after: { dates, ...totals, rows: rows.length, by: ctx.opsUser.name },
    })

    return NextResponse.json({ success: true, ...totals, results })
  } catch (err) {
    console.error('Schedule import error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
