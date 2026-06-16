// src/app/dashboard/roster/import/page.tsx
import { redirect } from 'next/navigation'
import { getOpsContext } from '@/lib/ops'
import ScheduleImportClient from './ScheduleImportClient'

export const dynamic = 'force-dynamic'

export default async function ScheduleImportPage() {
  const ctx = await getOpsContext()
  if (!ctx) redirect('/login')
  if (!ctx.opsUser) redirect('/dashboard')
  return <ScheduleImportClient />
}
