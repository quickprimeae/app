// src/lib/vendor.ts
// Display-layer vendor short codes for the 2-vendor demo. There is NO vendor
// code column yet — the code is derived from the picker's vendor at render time.
// Keyed primarily on the vendor NAME (the stable identity); the supervisor name
// is a fallback key for callers that only have the supervisor to hand.
//
//   Al Jasar (supervisor Saad)   -> AJ
//   SkillSet (supervisor Iflaam) -> SS
//
// To add a vendor, add its name (and optionally supervisor) here — one place.
const VENDOR_CODES: Record<string, string> = {
  'al jasar': 'AJ',
  'skillset': 'SS',
  // supervisor-name fallbacks
  'saad': 'AJ',
  'iflaam': 'SS', // exact seeded spelling
  'iftaam': 'SS', // tolerate the alternate spelling from the brief
}

// Resolve a vendor to its short code. Tries the vendor name first, then the
// supervisor name; returns null when there's no vendor / no mapping.
export function vendorCode(
  vendor: { name?: string | null; supervisor_name?: string | null } | null | undefined,
): string | null {
  if (!vendor) return null
  const byName = vendor.name ? VENDOR_CODES[vendor.name.trim().toLowerCase()] : undefined
  if (byName) return byName
  const bySup = vendor.supervisor_name ? VENDOR_CODES[vendor.supervisor_name.trim().toLowerCase()] : undefined
  return bySup ?? null
}
