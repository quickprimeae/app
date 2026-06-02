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
