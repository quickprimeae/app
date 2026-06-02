// src/app/dashboard/employees/bulk/page.tsx
import { redirect } from 'next/navigation'
import { getOpsContext } from '@/lib/ops'
import BulkClient from './BulkClient'

export const dynamic = 'force-dynamic'

export default async function BulkPage() {
  const ctx = await getOpsContext()
  if (!ctx) redirect('/login')
  if (!ctx.opsUser) redirect('/dashboard')
  return <BulkClient />
}
