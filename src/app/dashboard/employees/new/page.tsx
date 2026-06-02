// src/app/dashboard/employees/new/page.tsx
import { redirect } from 'next/navigation'
import { getOpsContext } from '@/lib/ops'
import { createServerSupabaseClient } from '@/lib/supabase'
import OnboardingClient from './OnboardingClient'

export const dynamic = 'force-dynamic'

export default async function NewEmployeePage() {
  const ctx = await getOpsContext()
  if (!ctx) redirect('/login')
  if (!ctx.opsUser) redirect('/dashboard')

  const db = createServerSupabaseClient()
  const [locRes, supRes] = await Promise.all([
    db.from('locations').select('id, name').eq('tenant_id', ctx.opsUser.tenant_id).eq('active', true).order('name'),
    db.from('ops_users').select('id, name').eq('tenant_id', ctx.opsUser.tenant_id).eq('active', true),
  ])

  return (
    <OnboardingClient
      tenantId={ctx.opsUser.tenant_id}
      locations={(locRes.data ?? []) as { id: string; name: string }[]}
      supervisors={(supRes.data ?? []) as { id: string; name: string | null }[]}
    />
  )
}
