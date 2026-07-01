// src/lib/dashboard.ts
// SERVER-ONLY. Assembles the live dashboard payload from base tables so the
// per-picker breakdown stays consistent (today_attendance is aggregate-only).
// Used by the /dashboard server component and the /api/attendance refresh route.

import { createServerSupabaseClient } from './supabase'
import { deriveStatus, deriveLocationStatus, isRunningLate, type DerivedStatus, type LocationStatus } from './status'
import { gstDay, gstMinutesOf, buildRosterMap } from './roster'
import { sessionsByEmployee, type SessionEvent } from './sessions'
import { vendorCode } from './vendor'

export type PickerStatus = DerivedStatus
// Canonical location status now lives in ./status (shared with the Locations
// page + map pins). Re-exported so existing importers of this type still resolve.
export type { LocationStatus }

export type DashPicker = {
  id: string
  name: string
  status: PickerStatus
  clockedInAt: string | null
  flagged: boolean
  // Vendor model: shift_type is read DIRECTLY from employees (never derived from
  // roster duration); rosterShift is today's scheduled time (null = none yet);
  // vendor is the picker's VENDOR short code (AJ/SS), derived from the vendor at
  // the display layer (null when vendor_id is null). See src/lib/vendor.ts.
  shiftType: string | null
  rosterShift: string | null
  vendor: string | null
}
export type DashLocation = {
  id: string
  name: string
  client: string | null
  area: string | null
  supervisor: string | null
  status: LocationStatus
  total: number
  clockedIn: number
  shiftStart: string | null
  shiftEnd: string | null
  pickers: DashPicker[]
}
export type DashAlert = {
  id: string
  type: 'red' | 'amber'
  icon: string
  title: string
  sub: string
  time: string
}
export type DashKpis = {
  active: number
  totalLocations: number
  clockedIn: number
  totalPickers: number
  noshow: number        // locations currently in a no-show state (drives the filter chip)
  noshowPickers: number // distinct pickers with an unresolved no-show alert today (the KPI card)
  late: number
  flagged: number
}
export type DashboardData = {
  locations: DashLocation[]
  alerts: DashAlert[]
  kpis: DashKpis
}

const ALERT_ICON: Record<string, string> = {
  noshow: '🚨',
  late: '⚠️',
  faceflag: '🔍',
  clockout: '⏹',
  system: '🔔',
}

// Alert-feed timestamp. Rendered in GST (Asia/Dubai) WITH the date so the
// column matches the alert body's "(GST)" — e.g. "27 Jun · 15:15". Display
// only: created_at is still stored/queried as UTC.
function gstStamp(iso: string) {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-GB', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' })
  return `${date} · ${time}`
}

// "Muhammad Hassan" -> "Muhammad H." so duplicate first names are distinguishable
// on the dashboard chips.
function shortName(first: string, last: string | null): string {
  const f = (first ?? '').trim()
  const li = (last ?? '').trim()[0]
  return li ? `${f} ${li.toUpperCase()}.` : f
}

export async function getDashboardData(tenantId: string): Promise<DashboardData> {
  const supabase = createServerSupabaseClient()
  // Operational day + clock-in window in GST (the roster's calendar day).
  const gst = gstDay()

  const [locRes, empRes, evtRes, alertRes, schedRes] = await Promise.all([
    supabase
      .from('locations')
      .select('id, name, chain, area, shift_start, shift_end, client:clients(name)')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('name', { ascending: true }),
    supabase
      .from('employees')
      .select('id, first_name, last_name, employee_number, location_id, shift_start, shift_end, pin_set, shift_type, supervisor:ops_users(name), vendor:vendors(name, supervisor_name)')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .eq('role', 'picker'),
    // BOTH punch types today — "currently in" is an OPEN session (clock_in with
    // no later clock_out), derived by sessionsByEmployee. See src/lib/sessions.ts.
    supabase
      .from('clock_events')
      .select('employee_id, event_type, timestamp, face_match_flagged')
      .eq('tenant_id', tenantId)
      .in('event_type', ['clock_in', 'clock_out'])
      .eq('voided', false)
      .gte('timestamp', gst.startUTC)
      .lt('timestamp', gst.endUTC),
    supabase
      .from('alerts')
      .select('id, type, severity, title, body, created_at, employee_id, review_result')
      .eq('tenant_id', tenantId)
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(100),
    // Today's rostered shift per picker (concrete schedule, not store timings).
    // This is the SINGLE source for late / no-show — see src/lib/roster.ts.
    supabase
      .from('scheduled_shifts')
      .select('employee_id, start_time, end_time')
      .eq('tenant_id', tenantId)
      .eq('date', gst.date)
      .eq('status', 'scheduled'),
  ])

  // Cast embedded relations to any: without generated DB types, supabase-js
  // infers to-one embeds (client, supervisor) as arrays.
  const locations = (locRes.data ?? []) as any[]
  const employees = (empRes.data ?? []) as any[]
  const events = (evtRes.data ?? []) as SessionEvent[]
  const alertRows = (alertRes.data ?? []) as any[]
  const scheduled = (schedRes.data ?? []) as { employee_id: string; start_time: string; end_time: string }[]

  // employee_id -> today's scheduled shift (start/end minutes + raw times). ONE
  // map drives BOTH the display string and the late/no-show computation, so they
  // always agree. Schema enforces one scheduled row per picker per day.
  const rosterByEmployee = buildRosterMap(scheduled)

  // Face-flag is sourced from the alerts table (single source). "Flagged" =
  // a PENDING face flag (open + un-reviewed); a rejected/escalated flag does
  // not count toward the pending KPI.
  const pendingFace = alertRows.filter((a) => a.type === 'faceflag' && a.review_result == null)
  const flaggedEmpIds = new Set<string>(pendingFace.map((a) => a.employee_id).filter(Boolean))

  // No-show KPI card = distinct pickers with an unresolved noshow alert fired
  // TODAY (GST). Sourced from the SAME alert rows the feed and the Alerts page
  // count (alerts.type='noshow', resolved=false), so the card agrees with them
  // instead of the location-status tally. detect_noshows is the single producer.
  const noshowPickerIds = new Set<string>(
    alertRows
      .filter((a) => a.type === 'noshow' && a.employee_id && a.created_at >= gst.startUTC && a.created_at < gst.endUTC)
      .map((a) => a.employee_id),
  )

  // employee_id -> today's session (open = currently in). Single source for the
  // "X/Y in" counter, the KPI, and the ACTIVE badge, so they can never diverge.
  const sessions = sessionsByEmployee(events)

  // Current time-of-day in GST (minutes since midnight) — same convention as the
  // roster start/end minutes, so they compare directly.
  const nowMin = gstMinutesOf(new Date())

  const dashLocations: DashLocation[] = locations.map((loc: any) => {
    const locEmps = employees.filter((e: any) => e.location_id === loc.id)
    const total = locEmps.length
    // Signals for the canonical deriveLocationStatus (single source, shared with
    // the Locations page + map pins):
    let clockedIn = 0        // OPEN sessions (drives "X/Y" display AND active)
    let scheduled = 0        // pickers with a roster row today (hasRoster)
    let latePicker = false   // >=1 rostered, set-up, not-in picker in the 10–60 band
    let noshowAlert = false  // >=1 unresolved no-show alert today for a picker here

    const pickers: DashPicker[] = locEmps.map((e: any) => {
      const s = sessions.get(e.id)
      const open = !!s?.open // currently IN (clock_in, no later clock_out)
      // Roster is the SINGLE source of expected times — no employee/location
      // store-hours fallback. null roster start => no shift today.
      const roster = rosterByEmployee.get(e.id)
      if (open) clockedIn++
      if (roster) scheduled++
      // No-show is driven by the ALERT the engine fired (the SAME rows as the KPI
      // card / feed), never an app-side headcount — so badge = chip = feed. Late
      // stays app-derived from the roster band, and only a rostered, SET-UP picker
      // (could have clocked in) who isn't in counts.
      if (noshowPickerIds.has(e.id)) noshowAlert = true
      if (roster && !open && e.pin_set && isRunningLate(roster.startMin, nowMin)) latePicker = true

      const pstatus = deriveStatus({
        active: true, // query already filters active = true
        pinSet: !!e.pin_set,
        clockInMin: open && s?.clockInAt ? gstMinutesOf(new Date(s.clockInAt)) : null,
        clockedOutToday: !!s?.clockedOut,
        rosterStartMin: roster?.startMin ?? null,
        nowMin,
      })
      return {
        id: e.employee_number || e.id.slice(0, 8),
        name: shortName(e.first_name, e.last_name),
        status: pstatus,
        clockedInAt: open ? s?.clockInAt ?? null : null,
        flagged: flaggedEmpIds.has(e.id),
        shiftType: e.shift_type ?? null,
        rosterShift: roster ? `${roster.start.slice(0, 5)}–${roster.end.slice(0, 5)}` : null,
        vendor: vendorCode(e.vendor),
      }
    })

    // ONE canonical derivation — same function the Locations page + map pins use,
    // so the card badge, chips, filters, and pins can never drift. "active" wins
    // on any real clock-in (roster or not), fixing the no-roster-but-clocked-in
    // divergence where a location read 'noshift' while a picker was in.
    const status = deriveLocationStatus({ clockedIn, noshowAlert, latePicker, hasRoster: scheduled > 0 })

    const supervisor =
      (locEmps.find((e: any) => e.supervisor?.name)?.supervisor?.name as string) ?? null

    return {
      id: loc.id,
      name: loc.name,
      client: loc.client?.name ?? loc.chain ?? null,
      area: loc.area ?? null,
      supervisor,
      status,
      total,
      clockedIn,
      shiftStart: loc.shift_start ?? null,
      shiftEnd: loc.shift_end ?? null,
      pickers,
    }
  })

  const alerts: DashAlert[] = alertRows.map((a: any) => ({
    id: a.id,
    type: a.severity === 'critical' ? 'red' : 'amber',
    icon: ALERT_ICON[a.type] ?? '🔔',
    title: a.title,
    sub: a.body ?? '',
    time: gstStamp(a.created_at),
  }))

  const kpis: DashKpis = {
    active: dashLocations.filter((l) => l.status === 'active').length,
    totalLocations: dashLocations.length,
    clockedIn: dashLocations.reduce((s, l) => s + l.clockedIn, 0),
    totalPickers: dashLocations.reduce((s, l) => s + l.total, 0),
    noshow: dashLocations.filter((l) => l.status === 'noshow').length,
    noshowPickers: noshowPickerIds.size,
    late: dashLocations.filter((l) => l.status === 'late').length,
    // Pending face flags tenant-wide (single source: the alerts table).
    flagged: pendingFace.length,
  }

  return { locations: dashLocations, alerts, kpis }
}
