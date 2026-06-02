// src/lib/supabase.ts
// Two clients: one for browser (anon key), one for server API routes (service role)

import { createClient } from '@supabase/supabase-js'
import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// ── Browser client (used in React components) ──────────────
// Uses anon key — respects RLS
export function createBrowserSupabaseClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}

// ── Service-role client (used in API routes only) ──────────
// Uses service role key — bypasses RLS, full DB access
// Only ever use this in /api routes, never expose to browser
export function createServerSupabaseClient() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  })
}

// The cookie-bound server client lives in ./supabase-server (it imports
// next/headers, which must never be pulled into a browser bundle).

// ── Types matching the database schema ─────────────────────
export type Employee = {
  id: string
  tenant_id: string
  employee_number: string
  first_name: string
  last_name: string
  phone: string
  nationality?: string
  role: 'picker' | 'supervisor' | 'ops' | 'admin'
  location_id?: string
  supervisor_id?: string
  hourly_rate: number
  iban?: string
  bank_account_name?: string
  reference_photo_url?: string
  has_photo: boolean
  pin_set: boolean
  pin_attempts: number
  pin_locked_until?: string
  active: boolean
  start_date: string
  deactivated_at?: string
  created_at: string
}

export type Location = {
  id: string
  tenant_id: string
  client_id: string
  name: string
  chain?: string
  area?: string
  address?: string
  lat: number
  lng: number
  geofence_radius: number
  shift_start: string
  shift_end: string
  shift_days: string
  active: boolean
  created_at: string
}

export type ClockEvent = {
  id: string
  tenant_id: string
  employee_id: string
  location_id: string
  event_type: 'clock_in' | 'clock_out'
  timestamp: string
  lat?: number
  lng?: number
  geofence_passed: boolean
  verification_method?: 'biometric' | 'pin' | 'pin_fallback'
  pin_verified: boolean
  selfie_triggered: boolean
  selfie_url?: string
  face_match_score?: number
  face_match_passed?: boolean
  face_match_flagged: boolean
  is_auto_clockout: boolean
  auto_clockout_note?: string
  device_fingerprint?: string
  manually_adjusted: boolean
  adjustment_note?: string
  created_at: string
}

export type Shift = {
  id: string
  tenant_id: string
  employee_id: string
  location_id: string
  date: string
  clock_in_event_id?: string
  clock_out_event_id?: string
  clock_in_time?: string
  clock_out_time?: string
  hours_raw?: number
  hours_adjusted?: number
  hours_final?: number
  hourly_rate: number
  gross_pay?: number
  is_auto_clockout: boolean
  needs_review: boolean
  review_note?: string
  status: 'pending' | 'verified' | 'adjusted' | 'disputed'
  verified_by?: string
  verified_at?: string
  created_at: string
}

export type Alert = {
  id: string
  tenant_id: string
  type: 'noshow' | 'late' | 'faceflag' | 'clockout' | 'system'
  severity: 'critical' | 'warning' | 'info'
  title: string
  body?: string
  employee_id?: string
  location_id?: string
  resolved: boolean
  resolved_at?: string
  resolved_by?: string
  resolution_note?: string
  created_at: string
}

export type Client = {
  id: string
  tenant_id: string
  name: string
  legal_name?: string
  trn?: string
  address?: string
  email?: string
  active: boolean
}

export type Invoice = {
  id: string
  tenant_id: string
  client_id: string
  invoice_number: string
  period_month: number
  period_year: number
  issue_date: string
  due_date?: string
  subtotal: number
  vat_rate: number
  vat_amount: number
  total: number
  status: 'draft' | 'sent' | 'paid' | 'overdue'
  notes?: string
  pdf_url?: string
  sent_at?: string
  paid_at?: string
}
