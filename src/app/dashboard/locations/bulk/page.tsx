// src/app/dashboard/locations/bulk/page.tsx
import { redirect } from 'next/navigation'
import { getOpsContext } from '@/lib/ops'
import LocationsBulkClient from './LocationsBulkClient'

export const dynamic = 'force-dynamic'

export default async function LocationsBulkPage() {
  const ctx = await getOpsContext()
  if (!ctx) redirect('/login')
  if (!ctx.opsUser) redirect('/dashboard')

  return <LocationsBulkClient />
}
