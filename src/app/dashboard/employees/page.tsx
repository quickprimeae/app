// src/app/dashboard/employees/page.tsx
import { redirect } from 'next/navigation'
import { getOpsContext } from '@/lib/ops'
import { getEmployeesList } from '@/lib/employees-data'
import { createServerSupabaseClient } from '@/lib/supabase'
import EmployeesClient from './EmployeesClient'

export const dynamic = 'force-dynamic'

export default async function EmployeesPage() {
  const ctx = await getOpsContext()
  if (!ctx) redirect('/login')
  if (!ctx.opsUser) redirect('/dashboard')
  const [employees, locRes] = await Promise.all([
    getEmployeesList(ctx.opsUser.tenant_id),
    createServerSupabaseClient()
      .from('locations')
      .select('id, name')
      .eq('tenant_id', ctx.opsUser.tenant_id)
      .eq('active', true)
      .order('name', { ascending: true }),
  ])
  const locations = ((locRes.data ?? []) as { id: string; name: string }[])
  return <EmployeesClient initial={employees} locations={locations} />
}
