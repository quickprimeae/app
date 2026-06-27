// src/lib/status.ts
// Single source of truth for an employee's derived "today" status, shared by
// the live dashboard, the employee roster table, and the employee drawer so
// the same person never shows two different states in two places.
//
// Late / no-show are measured off TODAY'S ROSTER (scheduled_shifts.start_time),
// resolved in GST — never employee/location store hours. See src/lib/roster.ts.
//
// Precedence (most decisive first):
//   1. deactivated    — employee is inactive; can't clock in at all.
//   2. awaiting_setup  — active but hasn't set a PIN yet. They physically
//                        cannot clock in, so they are NEVER an absence/no-show.
//   3. clocked_in / late — has a clock-in today (late = clocked in more than
//                        LATE_GRACE_MIN after the roster start).
//   4. no_schedule     — pin set, NOT clocked in, and NO roster row today. They
//                        are OFF: never late, never a no-show. Surfaced so an
//                        admin knows to add a schedule entry.
//   5. ready           — rostered, not clocked in, still inside the no-show
//                        grace window (less than NOSHOW_AFTER_MIN past start).
//   6. absent          — rostered, not clocked in, NOSHOW_AFTER_MIN past start.

// Thresholds, in minutes from the ROSTER start_time (GST). A clock-in within the
// grace is on time; beyond it is late. A picker who has not clocked in by the
// no-show cutoff is a no-show. (A clock-in later than the cutoff still counts as
// 'late' rather than a no-show — they did show up, just very late.)
export const LATE_GRACE_MIN = 10   // 0–10 min after start = on time; >10 = late
export const NOSHOW_AFTER_MIN = 60 // not in by 60 min (1 hr) past start = no-show

export type DerivedStatus =
  | 'clocked_in'
  | 'late'
  | 'absent'
  | 'ready'
  | 'no_schedule'
  | 'awaiting_setup'
  | 'deactivated'

export type StatusInput = {
  active: boolean
  pinSet: boolean
  /** Earliest clock-in today, minutes since GST midnight. null = not clocked in. */
  clockInMin: number | null
  /** Today's roster start, minutes since GST midnight. null = NO roster row today. */
  rosterStartMin: number | null
  /** Current time, minutes since GST midnight. */
  nowMin: number
}

export function deriveStatus(i: StatusInput): DerivedStatus {
  if (!i.active) return 'deactivated'
  if (!i.pinSet) return 'awaiting_setup'
  if (i.clockInMin != null) {
    // Present. Lateness is measured off the roster; with no roster row we can't
    // judge lateness, so a clocked-in picker is simply 'clocked_in'.
    const late = i.rosterStartMin != null && i.clockInMin - i.rosterStartMin > LATE_GRACE_MIN
    return late ? 'late' : 'clocked_in'
  }
  // Not clocked in. With NO roster row the picker is OFF today — never a no-show,
  // never late. No fallback to store hours: surface "needs schedule" instead.
  if (i.rosterStartMin == null) return 'no_schedule'
  // Rostered but not in yet: a no-show only once the grace window has elapsed.
  return i.nowMin - i.rosterStartMin >= NOSHOW_AFTER_MIN ? 'absent' : 'ready'
}

// True when a status should count toward the "absent / no-show" tallies.
// awaiting_setup and deactivated are excluded by design — neither can clock in.
export function isAbsence(s: DerivedStatus): boolean {
  return s === 'absent'
}

export type StatusTone = 'green' | 'amber' | 'red' | 'grey'

export const STATUS_META: Record<
  DerivedStatus,
  { label: string; short: string; tone: StatusTone }
> = {
  clocked_in: { label: 'Clocked in', short: '✓ in', tone: 'green' },
  late: { label: 'Late', short: '⏱ late', tone: 'amber' },
  absent: { label: 'No-Show', short: '✗ absent', tone: 'red' },
  ready: { label: 'Ready', short: 'ready', tone: 'grey' },
  no_schedule: { label: 'No schedule', short: '◷ no schedule', tone: 'grey' },
  awaiting_setup: { label: 'Awaiting setup', short: 'awaiting setup', tone: 'grey' },
  deactivated: { label: 'Terminated', short: 'deactivated', tone: 'grey' },
}
