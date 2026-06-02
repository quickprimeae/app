// src/app/dashboard/page.tsx
// Ops live dashboard. Server component: guards the session, resolves the
// ops user's tenant, fetches the initial attendance snapshot, then hands off
// to the client component for live updates.

import { redirect } from 'next/navigation'
import { getOpsContext } from '@/lib/ops'
import { getDashboardData } from '@/lib/dashboard'
import DashboardClient from './DashboardClient'
import NoProfile from './NoProfile'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const ctx = await getOpsContext()
  if (!ctx) redirect('/login')
  if (!ctx.opsUser) {
    return <NoProfile email={ctx.email} />
  }

  const data = await getDashboardData(ctx.opsUser.tenant_id)
  return <DashboardClient initialData={data} opsName={ctx.opsUser.name ?? 'Ops'} />
}
