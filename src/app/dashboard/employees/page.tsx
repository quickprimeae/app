// src/app/dashboard/employees/page.tsx
import { redirect } from 'next/navigation'
import { getOpsContext } from '@/lib/ops'
import { getEmployeesList } from '@/lib/employees-data'
import EmployeesClient from './EmployeesClient'

export const dynamic = 'force-dynamic'

export default async function EmployeesPage() {
  const ctx = await getOpsContext()
  if (!ctx) redirect('/login')
  if (!ctx.opsUser) redirect('/dashboard')
  const employees = await getEmployeesList(ctx.opsUser.tenant_id)
  return <EmployeesClient initial={employees} />
}
