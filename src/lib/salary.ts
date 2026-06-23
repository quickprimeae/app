// src/lib/salary.ts
// Pay model: a picker has a monthly salary and a shift length (8h or 10h).
// hourly_rate = monthly_salary / 26 working days / shift_hours.

export type ShiftType = '8h' | '10h'

// Onboarding writes an intentionally-flagged stand-in salary; the real figure is
// entered post-onboarding in the super-admin dashboard. 1 (not a realistic value
// like 2080) makes these placeholder rows obvious and easy to find later. The
// API still requires a positive salary, so this satisfies that without leaking a
// believable number. Used by BOTH onboarding paths (single + bulk CSV import).
export const BULK_PLACEHOLDER_SALARY = 1

export function shiftHours(shiftType: string | null | undefined): number | null {
  if (shiftType === '8h') return 8
  if (shiftType === '10h') return 10
  return null
}

// Returns the rounded hourly rate, or null if inputs are invalid.
export function hourlyRateFromSalary(
  monthlySalary: number | null | undefined,
  shiftType: string | null | undefined
): number | null {
  const hours = shiftHours(shiftType)
  const salary = Number(monthlySalary)
  if (!hours || !Number.isFinite(salary) || salary <= 0) return null
  return Math.round((salary / 26 / hours) * 100) / 100
}
