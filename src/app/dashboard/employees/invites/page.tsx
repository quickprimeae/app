// src/app/dashboard/employees/invites/page.tsx
import { redirect } from 'next/navigation'
import { getOpsContext } from '@/lib/ops'
import { createServerSupabaseClient } from '@/lib/supabase'
import InvitesClient, { type InviteRow } from './InvitesClient'

export const dynamic = 'force-dynamic'

export default async function InvitesPage() {
  const ctx = await getOpsContext()
  if (!ctx) redirect('/login')
  if (!ctx.opsUser) redirect('/dashboard')

  const { data } = await createServerSupabaseClient()
    .from('employees')
    .select('id, first_name, last_name, employee_number, phone, pin_setup_expires, created_at')
    .eq('tenant_id', ctx.opsUser.tenant_id)
    .eq('active', true)
    .eq('pin_set', false)
    .order('created_at', { ascending: false })

  const rows: InviteRow[] = ((data ?? []) as any[]).map((e) => ({
    id: e.id,
    name: `${e.first_name} ${e.last_name}`.trim(),
    empId: e.employee_number || e.id.slice(0, 8),
    phone: e.phone,
    linkExpires: e.pin_setup_expires ?? null,
  }))

  return <InvitesClient initial={rows} />
}
