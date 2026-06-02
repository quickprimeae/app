// src/app/dashboard/payroll/hours/page.tsx
import { redirect } from 'next/navigation'
import { getOpsContext } from '@/lib/ops'
import HoursClient from './HoursClient'

export const dynamic = 'force-dynamic'

export default async function HoursPage() {
  const ctx = await getOpsContext()
  if (!ctx) redirect('/login')
  if (!ctx.opsUser) redirect('/dashboard')
  return <HoursClient />
}
