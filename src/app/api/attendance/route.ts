// src/app/api/attendance/route.ts
// GET — live dashboard payload for the logged-in ops user's tenant.
// Used by the dashboard client to refresh (poll + realtime trigger).

import { NextResponse } from 'next/server'
import { getOpsContext } from '@/lib/ops'
import { getDashboardData } from '@/lib/dashboard'

export async function GET() {
  const ctx = await getOpsContext()
  if (!ctx) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (!ctx.opsUser) {
    return NextResponse.json({ error: 'No ops profile' }, { status: 403 })
  }

  const data = await getDashboardData(ctx.opsUser.tenant_id)
  return NextResponse.json(data)
}
