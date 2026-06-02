// src/app/dashboard/invoices/page.tsx
import { redirect } from 'next/navigation'
import { getOpsContext } from '@/lib/ops'
import { createServerSupabaseClient } from '@/lib/supabase'
import InvoicesClient from './InvoicesClient'

export const dynamic = 'force-dynamic'

export default async function InvoicesPage() {
  const ctx = await getOpsContext()
  if (!ctx) redirect('/login')
  if (!ctx.opsUser) redirect('/dashboard')

  const { data: clients } = await createServerSupabaseClient()
    .from('clients').select('id, name').eq('tenant_id', ctx.opsUser.tenant_id).eq('active', true)

  return <InvoicesClient tenantId={ctx.opsUser.tenant_id} clients={(clients ?? []) as { id: string; name: string }[]} />
}
