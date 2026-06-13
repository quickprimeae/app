// src/lib/phone.ts
// Single source of truth for UAE mobile phone normalization.
//
// Accepts any of these (with spaces / dashes / parentheses anywhere):
//   +9715XXXXXXXX   9715XXXXXXXX   05XXXXXXXX   5XXXXXXXX   (also tolerates 00971)
// Returns canonical E.164 "+9715XXXXXXXX", or null if it isn't a valid UAE mobile.
//
// The DB CHECK constraint mirrors this exactly: ^\+9715[0-9]{8}$

export function normalizePhone(input: string | null | undefined): string | null {
  if (input == null) return null
  // Drop everything that isn't a digit (handles +, spaces, dashes, parens, etc.).
  let d = String(input).replace(/[^0-9]/g, '')
  if (d.length === 0) return null

  if (d.startsWith('00')) d = d.slice(2) // international 00 prefix
  if (d.startsWith('971')) d = d.slice(3) // country code
  if (d.startsWith('0')) d = d.slice(1) // local trunk 0

  // What remains must be a UAE mobile subscriber number: 5 + 8 digits.
  if (/^5[0-9]{8}$/.test(d)) return `+971${d}`
  return null
}

// True when the input is a valid UAE mobile in any accepted format.
export function isValidPhone(input: string | null | undefined): boolean {
  return normalizePhone(input) !== null
}

// Digits-only form for wa.me deep links (no leading +): "9715XXXXXXXX".
// Pass an already-normalized E.164 string (or anything normalizePhone accepts).
export function phoneToWaDigits(input: string | null | undefined): string {
  const e164 = normalizePhone(input)
  return e164 ? e164.replace(/[^0-9]/g, '') : ''
}
