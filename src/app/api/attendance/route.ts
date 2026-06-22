// src/app/api/attendance/route.ts
// GET — live dashboard payload for the logged-in ops user's tenant.
// Polled by the dashboard (realtime-first, 60s fallback). Uses getReadOpsContext
// (local cookie-JWT verify, no per-poll GoTrue round-trip) since this is a
// read-only path. preferredRegion pins the function to Mumbai to colocate with
// the ap-south-1 database (was crossing to iad1).

import { NextResponse } from 'next/server'
import { getReadOpsContext } from '@/lib/ops'
import { getDashboardData } from '@/lib/dashboard'

export const preferredRegion = 'bom1'

export async function GET() {
  const ctx = await getReadOpsContext()
  if (!ctx) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (!ctx.opsUser) {
    return NextResponse.json({ error: 'No ops profile' }, { status: 403 })
  }

  const data = await getDashboardData(ctx.opsUser.tenant_id)
  return NextResponse.json(data)
}
