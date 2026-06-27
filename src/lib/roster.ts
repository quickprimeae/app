// src/lib/roster.ts
// SHARED, dependency-free roster + GST-day helpers used by BOTH the live
// dashboard (src/lib/dashboard.ts) and the employee roster page
// (src/lib/employees-data.ts) so their late / no-show computation reads the
// SAME source the SAME way and can never drift apart again.
//
// The roster (scheduled_shifts) is the SINGLE source of a picker's expected
// start/end for "today". There is intentionally NO fallback to
// employees.shift_start or locations.shift_start in the late/no-show path —
// this mirrors the DB-side detect_noshows() (roster-strict) for the app display.
//
// Timezone: shifts are Gulf Standard Time (Asia/Dubai, UTC+4, no DST). The
// "operational day" is the GST calendar day, and scheduled_shifts.date is a GST
// calendar date — so a shift's "today" must be resolved in GST, not UTC, or it
// is wrong for the 20:00–24:00 UTC window (00:00–04:00 GST of the next day).

export const GST_OFFSET_MIN = 240 // UTC+4, no daylight saving in the UAE

export type RosterShift = {
  /** Minutes since GST midnight. */
  startMin: number
  endMin: number
  /** Original "HH:MM:SS" GST wall-clock strings (for display). */
  start: string
  end: string
}

// The operational GST day for `now`, plus the exact UTC instants that bound it.
// Use `date` to look up scheduled_shifts.date, and [startUTC, endUTC) to window
// clock_events so a punch just after GST midnight is matched to the right day.
export function gstDay(now: Date = new Date()): { date: string; startUTC: string; endUTC: string } {
  const date = new Date(now.getTime() + GST_OFFSET_MIN * 60000).toISOString().slice(0, 10)
  const startMs = Date.parse(`${date}T00:00:00Z`) - GST_OFFSET_MIN * 60000
  return {
    date,
    startUTC: new Date(startMs).toISOString(),
    endUTC: new Date(startMs + 86_400_000).toISOString(),
  }
}

// Minutes-since-GST-midnight (0..1439) for an instant. Same convention as the
// roster start/end minutes, so they are directly comparable. No overnight
// shifts, so a same-day comparison is always sufficient.
export function gstMinutesOf(d: Date): number {
  return (d.getUTCHours() * 60 + d.getUTCMinutes() + GST_OFFSET_MIN) % 1440
}

// A "HH:MM[:SS]" GST time column -> minutes since midnight (null-safe).
export function timeToMin(t: string | null): number | null {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return h * 60 + m
}

// employee_id -> today's scheduled shift. The schema enforces ONE row per
// (employee_id, date) [scheduled_shifts_emp_date_uniq], and callers filter
// status='scheduled', so there is at most one shift per picker per day. We still
// guard defensively against duplicates by keeping the earliest start.
export function buildRosterMap(
  rows: { employee_id: string; start_time: string | null; end_time: string | null }[]
): Map<string, RosterShift> {
  const map = new Map<string, RosterShift>()
  for (const r of rows) {
    const startMin = timeToMin(r.start_time)
    const endMin = timeToMin(r.end_time)
    if (startMin == null || endMin == null) continue
    const existing = map.get(r.employee_id)
    if (!existing || startMin < existing.startMin) {
      map.set(r.employee_id, { startMin, endMin, start: r.start_time as string, end: r.end_time as string })
    }
  }
  return map
}
