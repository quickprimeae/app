// src/app/dashboard/alerts/page.tsx
import { redirect } from 'next/navigation'
import { getOpsContext } from '@/lib/ops'
import { createServerSupabaseClient } from '@/lib/supabase'
import AlertsClient, { type AlertItem } from './AlertsClient'

export const dynamic = 'force-dynamic'

export default async function AlertsPage() {
  const ctx = await getOpsContext()
  if (!ctx) redirect('/login')
  if (!ctx.opsUser) redirect('/dashboard')

  const { data } = await createServerSupabaseClient()
    .from('alerts')
    .select(`
      id, type, severity, title, body, resolved, resolved_at, resolution_note, created_at,
      employee:employees(first_name, last_name, employee_number),
      location:locations(name, client:clients(name)),
      resolver:ops_users(name)
    `)
    .eq('tenant_id', ctx.opsUser.tenant_id)
    .order('created_at', { ascending: false })
    .limit(100)

  const alerts: AlertItem[] = ((data ?? []) as any[]).map((a) => ({
    id: a.id,
    type: a.type,
    severity: a.severity === 'critical' ? 'critical' : 'warning',
    title: a.title,
    body: a.body ?? '',
    locationName: a.location?.name ?? '—',
    employeeName: a.employee ? `${a.employee.first_name} ${a.employee.last_name}`.trim() : '—',
    empId: a.employee?.employee_number ?? '',
    client: a.location?.client?.name ?? '',
    createdAt: a.created_at,
    resolved: !!a.resolved,
    resolvedAt: a.resolved_at ?? null,
    resolvedByName: a.resolver?.name ?? null,
    resolutionNote: a.resolution_note ?? '',
  }))

  return <AlertsClient initial={alerts} />
}
