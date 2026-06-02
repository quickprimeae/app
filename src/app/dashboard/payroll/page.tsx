// src/app/dashboard/payroll/page.tsx
import { redirect } from 'next/navigation'
import { getOpsContext } from '@/lib/ops'
import PayrollClient from './PayrollClient'

export const dynamic = 'force-dynamic'

export default async function PayrollPage() {
  const ctx = await getOpsContext()
  if (!ctx) redirect('/login')
  if (!ctx.opsUser) redirect('/dashboard')
  return <PayrollClient tenantId={ctx.opsUser.tenant_id} opsUserId={ctx.opsUser.id} />
}
