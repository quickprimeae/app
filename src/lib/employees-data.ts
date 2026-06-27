// src/lib/employees-data.ts
// SERVER-ONLY. Assembles the employee roster with today's clock status and
// this month's hours/earnings (joined from clock_events + monthly_hours view).

import { createServerSupabaseClient } from './supabase'
import { deriveStatus, type DerivedStatus } from './status'
import { gstDay, gstMinutesOf, buildRosterMap } from './roster'

export type EmployeeStatus = DerivedStatus
export type EmployeeRow = {
  id: string // uuid
  empId: string // employee_number
  firstName: string
  lastName: string
  name: string
  initials: string
  nationality: string | null
  phone: string
  locationId: string | null
  location: string
  branch: string | null
  client: string | null
  supervisor: string | null
  startDate: string | null
  hourlyRate: number
  shiftDays: string | null
  shiftHours: string
  personalShift: boolean
  status: DerivedStatus
  clockedInAt: string | null
  hoursThisMonth: number
  earnedThisMonth: number
  hasPhoto: boolean
  photoUrl: string | null
  hasDescriptor: boolean
  flagged: boolean
  flagAlertId: string | null
  active: boolean
  pinSet: boolean
}

export async function getEmployeesList(tenantId: string): Promise<EmployeeRow[]> {
  const supabase = createServerSupabaseClient()
  // Operational day + clock-in window in GST (the roster's calendar day).
  const gst = gstDay()
  const month = new Date().getMonth() + 1
  const year = new Date().getFullYear()

  const [empRes, locRes, evtRes, hoursRes, flagRes, schedRes] = await Promise.all([
    supabase
      .from('employees')
      .select('id, employee_number, first_name, last_name, phone, nationality, location_id, branch, hourly_rate, shift_days, shift_start, shift_end, has_photo, reference_photo_url, face_descriptor, active, pin_set, start_date, supervisor:ops_users(name)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    supabase
      .from('locations')
      .select('id, name, shift_start, shift_end, client:clients(name)')
      .eq('tenant_id', tenantId),
    supabase
      .from('clock_events')
      .select('employee_id, timestamp, face_match_flagged')
      .eq('tenant_id', tenantId)
      .eq('event_type', 'clock_in')
      .eq('voided', false)
      .gte('timestamp', gst.startUTC)
      .lt('timestamp', gst.endUTC),
    supabase
      .from('monthly_hours')
      .select('employee_id, total_hours, gross_pay')
      .eq('month', month)
      .eq('year', year),
    // Single source for "flagged": a PENDING face flag (open + un-reviewed).
    supabase
      .from('alerts')
      .select('id, employee_id, created_at')
      .eq('tenant_id', tenantId)
      .eq('type', 'faceflag')
      .eq('resolved', false)
      .is('review_result', null)
      .order('created_at', { ascending: false }),
    // Today's roster — the SINGLE source for late / no-show (see src/lib/roster.ts).
    supabase
      .from('scheduled_shifts')
      .select('employee_id, start_time, end_time')
      .eq('tenant_id', tenantId)
      .eq('date', gst.date)
      .eq('status', 'scheduled'),
  ])

  const employees = (empRes.data ?? []) as any[]

  // employee_id -> the latest pending face-flag alert id (for the drawer's
  // "Review →" deep-link). Ordered desc, so the first per employee wins.
  const flagByEmp = new Map<string, string>()
  for (const f of (flagRes.data ?? []) as any[]) {
    if (f.employee_id && !flagByEmp.has(f.employee_id)) flagByEmp.set(f.employee_id, f.id)
  }

  // The reference-photos bucket is private, so mint short-lived signed URLs so
  // the drawer can actually render the uploaded image (not a placeholder).
  const photoPaths = employees
    .filter((e) => e.has_photo && e.reference_photo_url)
    .map((e) => e.reference_photo_url as string)
  const signedByPath = new Map<string, string>()
  if (photoPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from('reference-photos')
      .createSignedUrls(photoPaths, 3600)
    for (const s of signed ?? []) {
      if (s.signedUrl && s.path) signedByPath.set(s.path, s.signedUrl)
    }
  }

  const locById = new Map(((locRes.data ?? []) as any[]).map((l) => [l.id, l]))
  const events = (evtRes.data ?? []) as any[]
  const hoursByEmp = new Map(((hoursRes.data ?? []) as any[]).map((h) => [h.employee_id, h]))
  // employee_id -> today's scheduled shift. SINGLE source for late / no-show.
  const rosterByEmp = buildRosterMap((schedRes.data ?? []) as any[])

  // Current time-of-day in GST (minutes since midnight) — same convention as the
  // roster start/end minutes, so they compare directly.
  const nowMin = gstMinutesOf(new Date())

  const clockByEmp = new Map<string, { timestamp: string; flagged: boolean }>()
  for (const e of events) {
    const existing = clockByEmp.get(e.employee_id)
    if (!existing || e.timestamp < existing.timestamp) {
      clockByEmp.set(e.employee_id, { timestamp: e.timestamp, flagged: !!e.face_match_flagged })
    }
  }

  return employees.map((e) => {
    const loc = e.location_id ? locById.get(e.location_id) : null
    const ev = clockByEmp.get(e.id)
    const hours = hoursByEmp.get(e.id)

    // Contracted shift (employee's own times, else the location default). This is
    // a DISPLAY-ONLY field ("Shift" line in the drawer) — it is NOT used for
    // late / no-show anymore. Those read today's roster below.
    const effStart: string | null = e.shift_start ?? loc?.shift_start ?? null
    const effEnd: string | null = e.shift_end ?? loc?.shift_end ?? null

    // Late / no-show from TODAY'S ROSTER only — no store-hours fallback. No roster
    // row => 'no_schedule' (off today; never late, never a no-show).
    const roster = rosterByEmp.get(e.id)
    const status = deriveStatus({
      active: !!e.active,
      pinSet: !!e.pin_set,
      clockInMin: ev ? gstMinutesOf(new Date(ev.timestamp)) : null,
      rosterStartMin: roster?.startMin ?? null,
      nowMin,
    })

    const rate = Number(e.hourly_rate) || 0
    const hoursThisMonth = Number(hours?.total_hours) || 0
    const earned = hours?.gross_pay != null ? Number(hours.gross_pay) : Math.round(hoursThisMonth * rate * 100) / 100

    return {
      id: e.id,
      empId: e.employee_number || e.id.slice(0, 8),
      firstName: e.first_name,
      lastName: e.last_name,
      name: `${e.first_name} ${e.last_name}`.trim(),
      initials: `${e.first_name?.[0] ?? ''}${e.last_name?.[0] ?? ''}`.toUpperCase(),
      nationality: e.nationality ?? null,
      phone: e.phone,
      locationId: e.location_id ?? null,
      location: loc?.name ?? 'Unassigned',
      branch: e.branch ?? null,
      client: loc?.client?.name ?? null,
      supervisor: e.supervisor?.name ?? null,
      startDate: e.start_date ?? null,
      hourlyRate: rate,
      shiftDays: e.shift_days ?? null,
      shiftHours: effStart && effEnd ? `${effStart.slice(0, 5)}–${effEnd.slice(0, 5)}` : '—',
      personalShift: !!(e.shift_start && e.shift_end),
      status,
      clockedInAt: ev?.timestamp ?? null,
      hoursThisMonth,
      earnedThisMonth: earned,
      hasPhoto: !!e.has_photo,
      photoUrl: e.reference_photo_url ? signedByPath.get(e.reference_photo_url) ?? null : null,
      hasDescriptor: !!e.face_descriptor,
      flagged: flagByEmp.has(e.id),
      flagAlertId: flagByEmp.get(e.id) ?? null,
      active: !!e.active,
      pinSet: !!e.pin_set,
    }
  })
}
