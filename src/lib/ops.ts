// src/lib/ops.ts
// SERVER-ONLY. Resolves the logged-in ops user (and their tenant) from the
// Supabase session cookie. ops_users is looked up with the service role
// since the row links auth_id -> tenant.

import { createServerSupabaseClient } from './supabase'
import { createServerComponentClient } from './supabase-server'

export type OpsUser = {
  id: string
  name: string | null
  tenant_id: string
  role: string | null
}

export async function getOpsContext(): Promise<
  { authId: string; email: string | null; opsUser: OpsUser | null } | null
> {
  const ssr = await createServerComponentClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (!user) return null

  const admin = createServerSupabaseClient()
  const { data } = await admin
    .from('ops_users')
    .select('id, name, tenant_id, role')
    .eq('auth_id', user.id)
    .eq('active', true)
    .maybeSingle()

  return { authId: user.id, email: user.email ?? null, opsUser: (data as OpsUser) ?? null }
}

// READ/POLL paths only (e.g. /api/attendance, polled continuously). Verifies the
// session from the cookie JWT LOCALLY via getClaims() — signature + expiry,
// using the cached JWKS — instead of a GoTrue network round-trip on every poll.
// Falls back to getUser() (which revalidates/refreshes) only when the local
// check fails (missing/expired/invalid). Do NOT use on mutating routes — those
// keep getOpsContext()'s full network getUser() validation.
export async function getReadOpsContext(): Promise<{ authId: string; opsUser: OpsUser | null } | null> {
  const ssr = await createServerComponentClient()

  let authId: string | null = null
  try {
    const { data, error } = await ssr.auth.getClaims()
    const sub = (data as any)?.claims?.sub
    if (!error && sub) authId = sub as string // getClaims verifies signature + exp
  } catch {
    // getClaims unavailable / threw — fall through to the network check.
  }
  if (!authId) {
    const {
      data: { user },
    } = await ssr.auth.getUser()
    authId = user?.id ?? null
  }
  if (!authId) return null

  const admin = createServerSupabaseClient()
  const { data } = await admin
    .from('ops_users')
    .select('id, name, tenant_id, role')
    .eq('auth_id', authId)
    .eq('active', true)
    .maybeSingle()

  return { authId, opsUser: (data as OpsUser) ?? null }
}
