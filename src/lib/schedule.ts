// src/lib/schedule.ts
// Shared, dependency-free helpers for the weekly-grid schedule importer. Both
// the client preview and the server apply path use parseCell() so they always
// agree on what a cell means. No DB or React imports — safe everywhere.

// A date-column header in the weekly grid, e.g. "2026-06-15".
export function isDateHeader(h: string): boolean {
  const s = (h ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && s === d.toISOString().slice(0, 10)
}

export type Cell =
  | { kind: 'off' }
  | { kind: 'shift'; start: string; end: string } // 'HH:MM:00'
  | { kind: 'error'; reason: string }

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// Tolerant cell parser:
//   "" / "OFF" / "off" / "-"        → day off (no shift row)
//   "08:00-19:00" / "8:00 - 19:00"  → a shift (accepts -, – or — and stray spaces)
//   anything else                   → error with a human reason
export function parseCell(raw: string): Cell {
  const trimmed = (raw ?? '').trim()
  const lower = trimmed.toLowerCase()
  if (trimmed === '' || lower === 'off' || trimmed === '-') return { kind: 'off' }

  // Collapse spaces and normalize dash variants before matching.
  const compact = trimmed.replace(/\s+/g, '').replace(/[–—]/g, '-')
  const m = compact.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/)
  if (!m) return { kind: 'error', reason: `Unrecognized "${trimmed}" — use 08:00-19:00 or OFF` }

  const sh = Number(m[1]), sm = Number(m[2]), eh = Number(m[3]), em = Number(m[4])
  if (sh > 23 || eh > 23 || sm > 59 || em > 59) {
    return { kind: 'error', reason: `Invalid time in "${trimmed}"` }
  }
  const startMin = sh * 60 + sm
  const endMin = eh * 60 + em
  if (endMin <= startMin) {
    return { kind: 'error', reason: `End must be after start in "${trimmed}" (no overnight shifts)` }
  }
  return { kind: 'shift', start: `${pad2(sh)}:${pad2(sm)}:00`, end: `${pad2(eh)}:${pad2(em)}:00` }
}

// ── Week math (pure, UTC-based for stable calendar arithmetic) ─────────────
// All inputs/outputs are YYYY-MM-DD strings, so there is no timezone drift.

export function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// The Monday (week is Mon-first) on or before the given date.
export function mondayOfISO(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const dow = d.getUTCDay() // 0 = Sun … 6 = Sat
  const back = dow === 0 ? 6 : dow - 1
  return addDaysISO(iso, -back)
}

// The 7 dates Mon…Sun for the week starting at mondayIso.
export function weekDatesISO(mondayIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysISO(mondayIso, i))
}

// Next n calendar days from a base date (default today), as YYYY-MM-DD. Used to
// build the downloadable template's date columns.
export function nextDates(n: number, from: Date = new Date()): string[] {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const d = new Date(from)
    d.setDate(d.getDate() + i)
    out.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`)
  }
  return out
}
