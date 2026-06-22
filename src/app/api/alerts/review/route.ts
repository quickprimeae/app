// src/app/api/alerts/review/route.ts
// Ops-only. POST { alert_id, action: 'approve' | 'reject', note? }
// The single write path for reviewing a face-flag, keeping the alert (the source
// of truth) and the clock_event/shift in sync.
//   approve (it IS them) -> resolved=true, review_result='approved'; clear the
//     event's face_match_flagged and the linked shift's needs_review.
//   reject  (NOT them)   -> review_result='rejected', kept OPEN/escalated; the
//     event flag stays (or there is none, for the 3-block lockout alert).
// Both stamp reviewed_by/reviewed_at and write an audit_logs before/after row.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getOpsContext } from '@/lib/ops'

export const preferredRegion = 'bom1' // colocate with ap-south-1 Supabase DB

export async function POST(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  const tenantId = ctx.opsUser.tenant_id
  const supabase = createServerSupabaseClient()

  try {
    const { alert_id, action, note } = await req.json()
    if (!alert_id || (action !== 'approve' && action !== 'reject')) {
      return NextResponse.json({ error: 'alert_id and action (approve|reject) required' }, { status: 400 })
    }

    const { data: before } = await supabase
      .from('alerts')
      .select('id, type, employee_id, clock_event_id, resolved, review_result, severity')
      .eq('id', alert_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!before) return NextResponse.json({ error: 'Alert not found' }, { status: 404 })

    const now = new Date().toISOString()
    let after: any = null

    if (action === 'approve') {
      const { data, error } = await supabase
        .from('alerts')
        .update({
          resolved: true, resolved_at: now, resolved_by: ctx.opsUser.id,
          review_result: 'approved', reviewed_by: ctx.opsUser.id, reviewed_at: now,
          resolution_note: note || 'Approved — identity confirmed',
        })
        .eq('id', alert_id).eq('tenant_id', tenantId)
        .select('*').single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      after = data

      // Clear the event flag + linked shift review so legacy reads stay clean.
      if (before.clock_event_id) {
        await supabase.from('clock_events').update({ face_match_flagged: false }).eq('id', before.clock_event_id).then(() => {}, () => {})
        await supabase.from('shifts').update({ needs_review: false })
          .eq('tenant_id', tenantId)
          .or(`clock_in_event_id.eq.${before.clock_event_id},clock_out_event_id.eq.${before.clock_event_id}`)
          .then(() => {}, () => {})
      }
    } else {
      const { data, error } = await supabase
        .from('alerts')
        .update({
          review_result: 'rejected', reviewed_by: ctx.opsUser.id, reviewed_at: now,
          resolution_note: note || 'Rejected — identity not confirmed; escalated',
        })
        .eq('id', alert_id).eq('tenant_id', tenantId)
        .select('*').single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      after = data

      // Reject VOIDS the punch: the picker is un-clocked and the hours don't
      // count. The 3-block lockout alert has no clock_event_id — it just
      // escalates (nothing to void).
      if (before.clock_event_id) {
        const { data: ceBefore } = await supabase
          .from('clock_events')
          .select('id, employee_id, event_type, voided')
          .eq('id', before.clock_event_id)
          .maybeSingle()
        await supabase.from('clock_events')
          .update({ voided: true, voided_at: now, voided_by: ctx.opsUser.id, void_reason: 'face review: rejected' })
          .eq('id', before.clock_event_id).eq('tenant_id', tenantId)
          .then(() => {}, () => {})
        // Void any shift the event belongs to (hours not counted).
        await supabase.from('shifts')
          .update({ voided: true, voided_at: now, voided_by: ctx.opsUser.id })
          .eq('tenant_id', tenantId)
          .or(`clock_in_event_id.eq.${before.clock_event_id},clock_out_event_id.eq.${before.clock_event_id}`)
          .then(() => {}, () => {})
        await supabase.from('audit_logs').insert({
          tenant_id: tenantId, actor_user_id: ctx.opsUser.id,
          entity_type: 'clock_event', entity_id: before.clock_event_id, action: 'void',
          before: ceBefore, after: { voided: true, void_reason: 'face review: rejected', by_alert: alert_id },
        }).then(() => {}, () => {})
      }
    }

    await supabase.from('audit_logs').insert({
      tenant_id: tenantId, actor_user_id: ctx.opsUser.id,
      entity_type: 'alert', entity_id: alert_id, action: `review_${action}`,
      before, after,
    }).then(() => {}, () => {})

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Alert review error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
