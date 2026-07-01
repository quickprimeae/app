// src/lib/sessions.ts
// Pure, shared "currently clocked in" (OPEN SESSION) derivation, so the live
// dashboard, the Locations page, and the employees roster all agree on who is
// IN *right now* (not merely "clocked in at some point today").
//
// event_type is ONLY 'clock_in' | 'clock_out'. Breaks are COLUMNS on the
// clock_in row (break_started_at / break_ended_at), never their own events — so
// a break NEVER closes a session; only a real clock_out does. Auto-clockout
// (12h) inserts a real clock_out, so those sessions close correctly. Callers
// must pass voided=false events only (consistent with detect_noshows).
//
// OPEN session = a clock_in in the queried GST day with NO clock_out in that
// same day. One clock-in per picker per day is enforced by the clock-in guard,
// so "any clock_out today closes it" matches the DB detect_noshows /
// auto_clockout definition exactly.

export type SessionEvent = {
  employee_id: string
  event_type: 'clock_in' | 'clock_out'
  timestamp: string
  face_match_flagged?: boolean | null
}

export type SessionState = {
  /** Earliest clock_in today; null if the picker never clocked in. */
  clockInAt: string | null
  /** Latest clock_out today; null if none. */
  clockOutAt: string | null
  /** Face-match flag carried on the clock_in event. */
  flagged: boolean
  /** Clocked in and NOT clocked out => currently IN. */
  open: boolean
  /** Clocked in AND clocked out => session closed (worked, then left). */
  clockedOut: boolean
}

// employee_id -> today's session state. Feed it every clock_in/clock_out row for
// the GST day (voided already excluded upstream).
export function sessionsByEmployee(events: SessionEvent[]): Map<string, SessionState> {
  const m = new Map<string, SessionState>()
  const get = (id: string): SessionState => {
    let s = m.get(id)
    if (!s) { s = { clockInAt: null, clockOutAt: null, flagged: false, open: false, clockedOut: false }; m.set(id, s) }
    return s
  }
  for (const e of events) {
    const s = get(e.employee_id)
    if (e.event_type === 'clock_in') {
      if (s.clockInAt == null || e.timestamp < s.clockInAt) {
        s.clockInAt = e.timestamp
        s.flagged = !!e.face_match_flagged
      }
    } else if (e.event_type === 'clock_out') {
      if (s.clockOutAt == null || e.timestamp > s.clockOutAt) s.clockOutAt = e.timestamp
    }
  }
  for (const s of m.values()) {
    const clockedIn = s.clockInAt != null
    const closed = s.clockOutAt != null
    s.open = clockedIn && !closed
    s.clockedOut = clockedIn && closed
  }
  return m
}

// Count of employees currently IN (open session) among the given ids. Both the
// "X / Y in" counter and the ACTIVE badge must derive from this, so they agree.
export function openCount(sessions: Map<string, SessionState>, empIds: Iterable<string>): number {
  let n = 0
  for (const id of empIds) if (sessions.get(id)?.open) n++
  return n
}
