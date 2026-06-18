// src/app/dashboard/alerts/page.tsx
import { redirect } from 'next/navigation'
import { getOpsContext } from '@/lib/ops'
import { createServerSupabaseClient } from '@/lib/supabase'
import AlertsClient, { type AlertItem } from './AlertsClient'

export const dynamic = 'force-dynamic'

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ flag?: string; tab?: string }>
}) {
  const ctx = await getOpsContext()
  if (!ctx) redirect('/login')
  if (!ctx.opsUser) redirect('/dashboard')
  const { flag, tab } = await searchParams
  const supabase = createServerSupabaseClient()

  // Embeds use FK-column hints (resolved_by / reviewed_by both point at
  // ops_users, so the embed is ambiguous without them).
  const { data } = await supabase
    .from('alerts')
    .select(`
      id, type, severity, title, body, resolved, resolved_at, resolution_note, created_at,
      employee_id, clock_event_id, review_result, reviewed_at,
      employee:employees(first_name, last_name, employee_number, reference_photo_url),
      location:locations(name, client:clients(name)),
      resolver:ops_users!resolved_by(name),
      reviewer:ops_users!reviewed_by(name),
      clock_event:clock_events!clock_event_id(selfie_url, face_match_score)
    `)
    .eq('tenant_id', ctx.opsUser.tenant_id)
    .order('created_at', { ascending: false })
    .limit(100)

  const rows = (data ?? []) as any[]

  // Mint short-lived signed URLs for the captured selfie (selfies bucket) and
  // the stored reference photo (reference-photos bucket) — same approach as the
  // employee drawer.
  const selfiePaths = rows.map((r) => r.clock_event?.selfie_url).filter(Boolean) as string[]
  const refPaths = rows.map((r) => r.employee?.reference_photo_url).filter(Boolean) as string[]
  const selfieSigned = new Map<string, string>()
  const refSigned = new Map<string, string>()
  if (selfiePaths.length) {
    const { data: s } = await supabase.storage.from('selfies').createSignedUrls(selfiePaths, 3600)
    for (const x of s ?? []) if (x.signedUrl && x.path) selfieSigned.set(x.path, x.signedUrl)
  }
  if (refPaths.length) {
    const { data: s } = await supabase.storage.from('reference-photos').createSignedUrls(refPaths, 3600)
    for (const x of s ?? []) if (x.signedUrl && x.path) refSigned.set(x.path, x.signedUrl)
  }

  const alerts: AlertItem[] = rows.map((a) => ({
    id: a.id,
    type: a.type,
    severity: a.severity === 'critical' ? 'critical' : 'warning',
    title: a.title,
    body: a.body ?? '',
    locationName: a.location?.name ?? '—',
    employeeName: a.employee ? `${a.employee.first_name} ${a.employee.last_name}`.trim() : '—',
    empId: a.employee?.employee_number ?? '',
    employeeId: a.employee_id ?? null,
    client: a.location?.client?.name ?? '',
    createdAt: a.created_at,
    resolved: !!a.resolved,
    resolvedAt: a.resolved_at ?? null,
    resolvedByName: a.resolver?.name ?? null,
    resolutionNote: a.resolution_note ?? '',
    clockEventId: a.clock_event_id ?? null,
    distance: a.clock_event?.face_match_score ?? null,
    selfieUrl: a.clock_event?.selfie_url ? selfieSigned.get(a.clock_event.selfie_url) ?? null : null,
    referenceUrl: a.employee?.reference_photo_url ? refSigned.get(a.employee.reference_photo_url) ?? null : null,
    reviewResult: a.review_result ?? null,
    reviewedAt: a.reviewed_at ?? null,
    reviewedByName: a.reviewer?.name ?? null,
  }))

  return <AlertsClient initial={alerts} focusFlag={flag ?? null} startFaceflag={tab === 'faceflag'} />
}
