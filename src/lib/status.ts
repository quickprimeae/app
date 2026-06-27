// src/lib/status.ts
// Single source of truth for an employee's derived "today" status, shared by
// the live dashboard, the employee roster table, and the employee drawer so
// the same person never shows two different states in two places.
//
// Precedence (most decisive first):
//   1. deactivated    — employee is inactive; can't clock in at all.
//   2. awaiting_setup  — active but hasn't set a PIN yet. They physically
//                        cannot clock in, so they are NEVER an absence/no-show.
//   3. clocked_in / late — has a clock-in today (late = past shift start + grace).
//   4. ready           — pin set, no clock-in yet, but the shift hasn't started.
//   5. absent          — pin set, shift has started, still no clock-in.

export type DerivedStatus =
  | 'clocked_in'
  | 'late'
  | 'absent'
  | 'ready'
  | 'awaiting_setup'
  | 'deactivated'

export type StatusInput = {
  active: boolean
  pinSet: boolean
  clockedIn: boolean
  /** Only meaningful when clockedIn. */
  late?: boolean
  /** Only meaningful when not clockedIn. Defaults to true (treat as due). */
  shiftStarted?: boolean
}

export function deriveStatus(i: StatusInput): DerivedStatus {
  if (!i.active) return 'deactivated'
  if (!i.pinSet) return 'awaiting_setup'
  if (i.clockedIn) return i.late ? 'late' : 'clocked_in'
  return i.shiftStarted === false ? 'ready' : 'absent'
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
  awaiting_setup: { label: 'Awaiting setup', short: 'awaiting setup', tone: 'grey' },
  deactivated: { label: 'Terminated', short: 'deactivated', tone: 'grey' },
}
