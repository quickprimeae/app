// src/app/dashboard/locations/page.tsx
import { redirect } from 'next/navigation'
import { getOpsContext } from '@/lib/ops'
import { getLocationsList } from '@/lib/locations-data'
import { createServerSupabaseClient } from '@/lib/supabase'
import LocationsClient from './LocationsClient'

export const dynamic = 'force-dynamic'

export default async function LocationsPage() {
  const ctx = await getOpsContext()
  if (!ctx) redirect('/login')
  if (!ctx.opsUser) redirect('/dashboard')

  const [locations, clientsRes] = await Promise.all([
    getLocationsList(ctx.opsUser.tenant_id),
    createServerSupabaseClient().from('clients').select('id, name').eq('tenant_id', ctx.opsUser.tenant_id).eq('active', true),
  ])

  return <LocationsClient initial={locations} clients={(clientsRes.data ?? []) as { id: string; name: string }[]} />
}
