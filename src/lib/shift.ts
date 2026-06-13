// src/lib/shift.ts
// Shift-time validation. There are NO overnight shifts in this business, so a
// shift must end strictly after it starts on the same day.
//
// Times come in as "HH:MM" or "HH:MM:SS"; lexicographic comparison of
// zero-padded 24h time strings is equivalent to chronological comparison.

// Returns true if the window is valid (or not enough info to judge — a single
// side being absent is allowed, since one may inherit a default).
export function isValidShiftWindow(
  start?: string | null,
  end?: string | null
): boolean {
  if (!start || !end) return true
  return normalize(end) > normalize(start)
}

function normalize(t: string): string {
  // Pad "8:00" → "08:00" and ensure seconds for a stable comparison.
  const [h = '0', m = '0', s = '0'] = t.trim().split(':')
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`
}
