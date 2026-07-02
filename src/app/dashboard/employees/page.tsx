// src/app/dashboard/employees/page.tsx
import { redirect } from 'next/navigation'
import { getOpsContext } from '@/lib/ops'
import { getEmployeesList } from '@/lib/employees-data'
import { createServerSupabaseClient } from '@/lib/supabase'
import EmployeesClient from './EmployeesClient'

export const dynamic = 'force-dynamic'

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ picker?: string }>
}) {
  const ctx = await getOpsContext()
  if (!ctx) redirect('/login')
  if (!ctx.opsUser) redirect('/dashboard')
  // Deep-link from the dashboard/locations quick-info "More Info →":
  // ?picker=OP-xxxx (employee_number). Passed to the client, which opens that
  // picker's drawer on load; an unknown value is simply ignored.
  const { picker } = await searchParams
  const initialPicker = typeof picker === 'string' ? picker : null
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
  return <EmployeesClient initial={employees} locations={locations} initialPicker={initialPicker} />
}
