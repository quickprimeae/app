// src/lib/break.ts
// SERVER-ONLY. One break per shift, persisted on the day's OPEN clock_in event
// row (columns added in migration 0020). State is derived from timestamps so it
// survives refresh; the only client-visible "timer" is a countdown derived from
// break_started_at, never a client-incremented counter.

export const BREAK_DURATION_MS = 60 * 60 * 1000 // a break is exactly one hour

export type BreakRow = {
  id: string
  break_started_at: string | null
  break_ended_at: string | null
  break_ended_reason: string | null
}

export type BreakState = {
  break_started_at: string | null
  break_ended_at: string | null
  break_ended_reason: string | null
  on_break: boolean // a break is open right now
  break_used: boolean // a break has been started this shift (one per shift)
  break_remaining_ms: number // ms left in an open break, else 0
}

// Resolve the break state for a clock_in row, applying the "auto-end on read"
// rule: if a break has been open for >= 1h, persist its end (reason 'auto') so
// the DB and every later read agree. No cron needed. The .is(...) guard keeps it
// idempotent and avoids clobbering a manual/clockout end that landed first.
export async function resolveBreakState(
  supabase: { from: (t: string) => any },
  row: BreakRow
): Promise<BreakState> {
  let { break_started_at, break_ended_at, break_ended_reason } = row

  if (break_started_at && !break_ended_at) {
    const endsAtMs = new Date(break_started_at).getTime() + BREAK_DURATION_MS
    if (Date.now() >= endsAtMs) {
      const autoEnd = new Date(endsAtMs).toISOString()
      await supabase
        .from('clock_events')
        .update({ break_ended_at: autoEnd, break_ended_reason: 'auto' })
        .eq('id', row.id)
        .is('break_ended_at', null)
      break_ended_at = autoEnd
      break_ended_reason = 'auto'
    }
  }

  const onBreak = !!break_started_at && !break_ended_at
  const remaining = onBreak
    ? Math.max(0, new Date(break_started_at as string).getTime() + BREAK_DURATION_MS - Date.now())
    : 0

  return {
    break_started_at,
    break_ended_at,
    break_ended_reason,
    on_break: onBreak,
    break_used: !!break_started_at,
    break_remaining_ms: remaining,
  }
}
