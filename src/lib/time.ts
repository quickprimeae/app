// src/lib/time.ts
// Pure GST (Asia/Dubai, UTC+4) time formatters for the alert feed, shared by the
// server payload builder and the client renderers. NO server deps, so it is safe
// in the client bundle. All wall-clock math is GST; relative strings take a
// caller-provided "now" so they recompute on every render/poll (never go stale).

import { gstDay } from './roster'

// "HH:MM" in GST.
export function gstTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' })
}

// "DD Mon · HH:MM" in GST — e.g. "30 Jun · 14:00".
export function gstStamp(iso: string): string {
  const date = new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short' })
  return `${date} · ${gstTime(iso)}`
}

// Relative age vs the given "now" (ms epoch), all day boundaries in GST:
//   < 60 min           -> "Xm ago"           (e.g. "18m ago")
//   same GST day, ≥1h  -> "Xh ago"           (e.g. "3h ago")
//   previous GST day   -> "Yesterday · HH:MM"
//   older              -> "DD Mon · HH:MM"    (e.g. "30 Jun · 14:00")
export function gstRelative(iso: string, nowMs: number): string {
  const thenMs = Date.parse(iso)
  const diffMin = Math.floor((nowMs - thenMs) / 60000)
  if (diffMin < 60) return `${Math.max(0, diffMin)}m ago`

  const thenDay = gstDay(new Date(thenMs)).date
  const nowDay = gstDay(new Date(nowMs)).date
  if (thenDay === nowDay) return `${Math.floor(diffMin / 60)}h ago`

  // Dubai has no DST, so "now − 24h" always lands on the previous GST calendar day.
  const yesterday = gstDay(new Date(nowMs - 86_400_000)).date
  if (thenDay === yesterday) return `Yesterday · ${gstTime(iso)}`

  return gstStamp(iso)
}
