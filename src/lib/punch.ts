// src/lib/punch.ts
// SERVER-ONLY shared logic for the gated punch flow (Sub-step 3).
//
// The punch is split into VERIFY (GPS + PIN, no write) and COMMIT (face gate +
// write). A short-lived HMAC token issued by verify proves to commit that the
// PIN + GPS were checked, so the PIN is never held on the client or re-sent —
// and the clock_event is only ever written at commit, after the face match.

import crypto from 'crypto'
import { isWithinGeofence } from './geofence'
import { verifyPin } from './pin'
import { FACE_DESCRIPTOR_LENGTH, euclideanDistance, faceVerdict, type FaceVerdict } from './face-config'
import type { createServerSupabaseClient } from './supabase'

type SB = ReturnType<typeof createServerSupabaseClient>

const TOKEN_TTL_MS = 5 * 60 * 1000 // a verify is good for 5 minutes
function secret(): string {
  return (
    process.env.PUNCH_TOKEN_SECRET ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'dev-only-punch-secret'
  )
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url')
}

export type PunchTokenPayload = {
  employee_id: string
  location_id: string
  action: 'in' | 'out'
  exp: number
}

export function signPunchToken(p: PunchTokenPayload): string {
  const body = b64url(JSON.stringify(p))
  const sig = b64url(crypto.createHmac('sha256', secret()).update(body).digest())
  return `${body}.${sig}`
}

// Returns the payload if the token is well-formed, unexpired, and matches the
// expected employee/location/action; otherwise null.
export function verifyPunchToken(
  token: string | null | undefined,
  expect: { employee_id: string; location_id: string; action: 'in' | 'out' }
): PunchTokenPayload | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  const expected = b64url(crypto.createHmac('sha256', secret()).update(body).digest())
  // constant-time compare
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  let p: PunchTokenPayload
  try {
    p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (p.exp < Date.now()) return null
  if (p.employee_id !== expect.employee_id || p.location_id !== expect.location_id || p.action !== expect.action) return null
  return p
}

export function newToken(employee_id: string, location_id: string, action: 'in' | 'out'): string {
  return signPunchToken({ employee_id, location_id, action, exp: Date.now() + TOKEN_TTL_MS })
}

// ── Shared pre-checks (GPS + PIN), identical to the pre-Sub-step-3 logic ────
export type PreCheckResult =
  | { ok: true; employee: any; location: any }
  | { ok: false; status: number; body: any }

export async function preCheck(
  supabase: SB,
  args: { employee_id: string; location_id: string; lat: number; lng: number; pin: string; countPin: boolean }
): Promise<PreCheckResult> {
  const { employee_id, location_id, lat, lng, pin, countPin } = args

  const [{ data: employee, error: empErr }, { data: location, error: locErr }] = await Promise.all([
    supabase
      .from('employees')
      .select('id, tenant_id, pin_hash, pin_set, pin_attempts, pin_locked_until, active, first_name, last_name, location_id')
      .eq('id', employee_id)
      .single(),
    supabase
      .from('locations')
      .select('id, tenant_id, name, lat, lng, geofence_radius, shift_start, shift_end, active')
      .eq('id', location_id)
      .single(),
  ])

  if (empErr || !employee) return { ok: false, status: 404, body: { error: 'Employee not found' } }
  if (locErr || !location) return { ok: false, status: 404, body: { error: 'Location not found' } }
  if (!employee.active) return { ok: false, status: 403, body: { error: 'Account inactive' } }
  // A picker with no assigned location has no geofence to check — never let a
  // null-location punch through (the punch is reordered, but this is the gate).
  if (!employee.location_id) {
    return { ok: false, status: 403, body: { error: 'No location assigned — ask your admin.' } }
  }
  if (!employee.pin_set || !employee.pin_hash) {
    return { ok: false, status: 403, body: { error: 'PIN not set up. Check your WhatsApp for setup link.' } }
  }
  if (employee.pin_locked_until && new Date(employee.pin_locked_until) > new Date()) {
    const minutesLeft = Math.ceil((new Date(employee.pin_locked_until).getTime() - Date.now()) / 60000)
    return { ok: false, status: 429, body: { error: `Too many failed attempts. Try again in ${minutesLeft} minute(s).` } }
  }

  const pinValid = await verifyPin(pin, employee.pin_hash)
  if (!pinValid) {
    if (countPin) await supabase.rpc('register_pin_failure', { emp_id: employee_id })
    const attempts = (employee.pin_attempts || 0) + 1
    return { ok: false, status: 401, body: { error: 'Incorrect PIN', attempts, remaining: Math.max(0, 5 - attempts), locked: attempts >= 5 } }
  }
  if (countPin) await supabase.rpc('register_pin_success', { emp_id: employee_id })

  const { passed, distanceMetres } = isWithinGeofence(lat, lng, location.lat, location.lng, location.geofence_radius)
  if (!passed) {
    return {
      ok: false,
      status: 403,
      body: { error: `You are ${distanceMetres}m from ${location.name}. You must be within ${location.geofence_radius}m.`, distance: distanceMetres, required: location.geofence_radius },
    }
  }

  return { ok: true, employee, location }
}

// ── Server-authoritative face gate ─────────────────────────────────────────
export type FaceGate = { verdict: FaceVerdict; distance: number | null; reason?: 'no_reference' }

export function faceGate(storedDescriptor: unknown, liveDescriptor: number[]): FaceGate {
  const stored = storedDescriptor as number[] | null | undefined
  if (!stored || !Array.isArray(stored) || stored.length !== FACE_DESCRIPTOR_LENGTH) {
    // No reference on file -> can't verify -> flag (never a silent pass).
    return { verdict: 'flag', distance: null, reason: 'no_reference' }
  }
  const distance = euclideanDistance(liveDescriptor, stored)
  return { verdict: faceVerdict(distance), distance }
}

export function isValidDescriptor(d: unknown): d is number[] {
  return Array.isArray(d) && d.length === FACE_DESCRIPTOR_LENGTH && d.every((n) => typeof n === 'number' && Number.isFinite(n))
}
