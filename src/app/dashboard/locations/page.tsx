// src/app/dashboard/locations/page.tsx
import { redirect } from 'next/navigation'
import { getOpsContext } from '@/lib/ops'
import { getLocationsList } from '@/lib/locations-data'
import LocationsClient from './LocationsClient'

export const dynamic = 'force-dynamic'

export default async function LocationsPage() {
  const ctx = await getOpsContext()
  if (!ctx) redirect('/login')
  if (!ctx.opsUser) redirect('/dashboard')

  const locations = await getLocationsList(ctx.opsUser.tenant_id)

  return <LocationsClient initial={locations} />
}
