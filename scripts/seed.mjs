// scripts/seed.mjs
// Pilot seed data for QuickPrime. Idempotent: re-running skips rows that
// already exist (matched by location name / employee phone / "today").
//
//   node --env-file=.env.local scripts/seed.mjs            # data only
//   OPS_EMAIL=you@x.com OPS_PASSWORD=secret \
//     node --env-file=.env.local scripts/seed.mjs          # + ops auth user
//
// Writes to the live Supabase project. Tenant: QuickPrime Internal.

import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } })

const TENANT = '678151ad-d086-4164-b187-c2804d21cb54'
const TALABAT = 'd91c5bb7-88d8-444a-986c-2df67982bab1'
const DELIVEROO = '18af7dec-ae52-4fdd-add9-45a900d989ab'

const SHIFT = { shift_start: '08:00:00', shift_end: '19:00:00', shift_days: 'Sun,Mon,Tue,Wed,Thu,Fri' }

// name is the idempotency key for locations.
const LOCATIONS = [
  { name: 'Carrefour — Mall of the Emirates', chain: 'Carrefour', area: 'Al Barsha', address: 'Sheikh Zayed Rd, Al Barsha, Dubai', lat: 25.1181, lng: 55.2003, geofence_radius: 150, client_id: TALABAT },
  { name: 'Lulu — Silicon Oasis', chain: 'Lulu', area: 'Silicon Oasis', address: 'Dubai Silicon Oasis, Dubai', lat: 25.1212, lng: 55.3773, geofence_radius: 150, client_id: TALABAT },
  { name: 'Spinneys — JBR', chain: 'Spinneys', area: 'JBR', address: 'The Walk, JBR, Dubai', lat: 25.0785, lng: 55.1340, geofence_radius: 120, client_id: DELIVEROO },
  { name: 'Waitrose — Dubai Marina', chain: 'Waitrose', area: 'Dubai Marina', address: 'Marina Mall, Dubai Marina', lat: 25.0772, lng: 55.1403, geofence_radius: 120, client_id: DELIVEROO },
  // Dev test site. To clock in here locally, override your browser geolocation
  // to its coords (Chrome DevTools → Sensors → Location): 25.2048, 55.2708.
  { name: 'QuickPrime Test Site (Dev)', chain: 'Test', area: 'Downtown', address: 'Dev test site — override geolocation to 25.2048, 55.2708', lat: 25.2048, lng: 55.2708, geofence_radius: 500, client_id: TALABAT },
]

// location is the location name; phone is the idempotency key for employees.
const EMPLOYEES = [
  { first_name: 'Ahmed', last_name: 'Al Rashidi', phone: '+971500000001', location: 'QuickPrime Test Site (Dev)', hourly_rate: 20, nationality: 'UAE', testPin: '123456' },
  { first_name: 'Maria', last_name: 'Santos', phone: '+971500000002', location: 'Carrefour — Mall of the Emirates', hourly_rate: 18, nationality: 'Philippines' },
  { first_name: 'Raj', last_name: 'Kumar', phone: '+971500000003', location: 'Carrefour — Mall of the Emirates', hourly_rate: 18, nationality: 'India' },
  { first_name: 'Omar', last_name: 'Farouq', phone: '+971500000004', location: 'Lulu — Silicon Oasis', hourly_rate: 18, nationality: 'Egypt' },
  { first_name: 'Priya', last_name: 'Nair', phone: '+971500000005', location: 'Lulu — Silicon Oasis', hourly_rate: 19, nationality: 'India' },
  { first_name: 'Grace', last_name: 'Mendoza', phone: '+971500000006', location: 'Spinneys — JBR', hourly_rate: 18, nationality: 'Philippines' },
  { first_name: 'Vijay', last_name: 'Sharma', phone: '+971500000007', location: 'Spinneys — JBR', hourly_rate: 18, nationality: 'India' },
  { first_name: 'Hassan', last_name: 'Al Zaabi', phone: '+971500000008', location: 'Waitrose — Dubai Marina', hourly_rate: 19, nationality: 'UAE' },
  { first_name: 'Fatima', last_name: 'Al Nuaimi', phone: '+971500000009', location: 'Waitrose — Dubai Marina', hourly_rate: 19, nationality: 'UAE' },
  { first_name: 'Mark', last_name: 'Reyes', phone: '+971500000010', location: 'Carrefour — Mall of the Emirates', hourly_rate: 18, nationality: 'Philippines' },
]

// Who is "clocked in" today, and how (to drive dashboard statuses).
// Carrefour: 3/3 in (active). Lulu: 1/2 in, Priya flagged (late + face flag).
// Spinneys: 0/2 (no-show). Waitrose: 2/2 (active). Test site: Ahmed not in.
const CLOCK_INS = [
  { phone: '+971500000002', minsAgo: 95 },
  { phone: '+971500000003', minsAgo: 88 },
  { phone: '+971500000010', minsAgo: 80 },
  { phone: '+971500000004', minsAgo: 40 },
  { phone: '+971500000005', minsAgo: 12, flagged: true },
  { phone: '+971500000008', minsAgo: 70 },
  { phone: '+971500000009', minsAgo: 65 },
]

function isoMinsAgo(mins) {
  return new Date(Date.now() - mins * 60000).toISOString()
}

async function seedLocations() {
  const { data: existing } = await db.from('locations').select('id, name').eq('tenant_id', TENANT)
  const byName = new Map((existing ?? []).map((l) => [l.name, l.id]))
  let created = 0
  for (const loc of LOCATIONS) {
    if (byName.has(loc.name)) continue
    const { data, error } = await db
      .from('locations')
      .insert({ tenant_id: TENANT, active: true, ...SHIFT, ...loc })
      .select('id, name')
      .single()
    if (error) { console.error('  location insert failed:', loc.name, error.message); continue }
    byName.set(data.name, data.id)
    created++
  }
  console.log(`Locations: ${created} created, ${byName.size} total`)
  return byName
}

async function seedEmployees(locByName) {
  const { data: existing } = await db.from('employees').select('id, phone, location_id').eq('tenant_id', TENANT)
  const byPhone = new Map((existing ?? []).map((e) => [e.phone, e.id]))
  const locById = new Map((existing ?? []).map((e) => [e.phone, e.location_id]))

  // Reconcile location assignments for rows that already exist (e.g. created
  // before their location was seeded).
  let relinked = 0
  for (const emp of EMPLOYEES) {
    if (!byPhone.has(emp.phone)) continue
    const want = locByName.get(emp.location) ?? null
    if (want && locById.get(emp.phone) !== want) {
      const { error } = await db.from('employees').update({ location_id: want }).eq('id', byPhone.get(emp.phone))
      if (!error) relinked++
    }
  }
  if (relinked) console.log(`Employees: ${relinked} location assignment(s) reconciled`)

  let created = 0
  let n = 1000
  for (const emp of EMPLOYEES) {
    n++
    if (byPhone.has(emp.phone)) continue
    const location_id = locByName.get(emp.location) ?? null
    const row = {
      tenant_id: TENANT,
      employee_number: `QP-${n}`,
      first_name: emp.first_name,
      last_name: emp.last_name,
      phone: emp.phone,
      nationality: emp.nationality,
      role: 'picker',
      location_id,
      hourly_rate: emp.hourly_rate,
      has_photo: false,
      active: true,
      start_date: '2026-01-15',
      pin_set: false,
    }
    if (emp.testPin) {
      row.pin_hash = await bcrypt.hash(emp.testPin, 12)
      row.pin_set = true
    }
    const { data, error } = await db.from('employees').insert(row).select('id, phone').single()
    if (error) { console.error('  employee insert failed:', emp.phone, error.message); continue }
    byPhone.set(data.phone, data.id)
    created++
  }
  console.log(`Employees: ${created} created, ${byPhone.size} total`)
  return byPhone
}

async function seedClockEvents(empByPhone, locByName) {
  const today = new Date().toISOString().split('T')[0]
  const { count } = await db
    .from('clock_events')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', TENANT)
    .gte('timestamp', `${today}T00:00:00Z`)
  if ((count ?? 0) > 0) {
    console.log(`Clock events: ${count} already exist for today, skipping`)
    return
  }
  // Resolve each employee's location (with coords) for the event.
  const { data: emps } = await db
    .from('employees')
    .select('id, phone, location_id')
    .eq('tenant_id', TENANT)
  const empMeta = new Map((emps ?? []).map((e) => [e.phone, e]))
  const { data: locs } = await db
    .from('locations')
    .select('id, lat, lng')
    .eq('tenant_id', TENANT)
  const locCoords = new Map((locs ?? []).map((l) => [l.id, l]))
  let created = 0
  for (const ci of CLOCK_INS) {
    const meta = empMeta.get(ci.phone)
    if (!meta || !meta.location_id) continue
    const coords = locCoords.get(meta.location_id)
    const row = {
      tenant_id: TENANT,
      employee_id: meta.id,
      location_id: meta.location_id,
      event_type: 'clock_in',
      timestamp: isoMinsAgo(ci.minsAgo),
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      geofence_passed: true,
      verification_method: 'pin',
      pin_verified: true,
      selfie_triggered: !!ci.flagged,
    }
    if (ci.flagged) {
      row.selfie_url = 'seed/placeholder.jpg'
      row.face_match_score = 0.62
      row.face_match_passed = false
      row.face_match_flagged = true
    }
    const { error } = await db.from('clock_events').insert(row)
    if (error) { console.error('  clock_event insert failed:', ci.phone, error.message); continue }
    created++
  }
  console.log(`Clock events: ${created} created for today`)
}

async function seedAlerts(empByPhone, locByName) {
  const { count } = await db
    .from('alerts')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', TENANT)
    .eq('resolved', false)
  if ((count ?? 0) > 0) {
    console.log(`Alerts: ${count} unresolved already exist, skipping`)
    return
  }
  const spinneys = locByName.get('Spinneys — JBR') ?? null
  const lulu = locByName.get('Lulu — Silicon Oasis') ?? null
  const priya = empByPhone.get('+971500000005') ?? null
  const grace = empByPhone.get('+971500000006') ?? null
  const alerts = [
    { tenant_id: TENANT, type: 'noshow', severity: 'critical', title: 'No-show — Spinneys, JBR', body: 'Grace Mendoza has not clocked in. Shift started over an hour ago.', location_id: spinneys, employee_id: grace, resolved: false },
    { tenant_id: TENANT, type: 'faceflag', severity: 'warning', title: 'Face match flagged — Lulu, Silicon Oasis', body: 'Selfie check needs manual review for Priya Nair.', location_id: lulu, employee_id: priya, resolved: false },
  ]
  const { error } = await db.from('alerts').insert(alerts)
  if (error) { console.error('  alerts insert failed:', error.message); return }
  console.log(`Alerts: ${alerts.length} created`)
}

async function seedOpsUser() {
  const email = process.env.OPS_EMAIL
  const password = process.env.OPS_PASSWORD
  if (!email || !password) {
    console.log('Ops user: OPS_EMAIL/OPS_PASSWORD not set — skipping auth user creation')
    return
  }
  // Create (or find) the auth user.
  let authId = null
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createErr) {
    if (/already/i.test(createErr.message)) {
      const { data: list } = await db.auth.admin.listUsers()
      authId = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null
      console.log('Ops user: auth user already existed, reusing')
    } else {
      console.error('  auth.admin.createUser failed:', createErr.message)
      return
    }
  } else {
    authId = created.user?.id ?? null
  }
  if (!authId) { console.error('  could not resolve auth user id'); return }

  // Link an ops_users row.
  const { data: existing } = await db
    .from('ops_users')
    .select('id')
    .eq('auth_id', authId)
    .maybeSingle()
  if (existing) {
    console.log('Ops user: ops_users row already linked')
    return
  }
  const { error: opsErr } = await db.from('ops_users').insert({
    tenant_id: TENANT,
    auth_id: authId,
    name: 'Ops Admin',
    email,
    role: 'admin',
    active: true,
  })
  if (opsErr) { console.error('  ops_users insert failed:', opsErr.message); return }
  console.log(`Ops user: created + linked (${email})`)
}

async function main() {
  console.log('Seeding QuickPrime pilot data…')
  const locByName = await seedLocations()
  const empByPhone = await seedEmployees(locByName)
  await seedClockEvents(empByPhone, locByName)
  await seedAlerts(empByPhone, locByName)
  await seedOpsUser()
  console.log('Done.')
}

main().catch((e) => { console.error(e); process.exit(1) })
