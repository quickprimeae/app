// src/app/api/attendance/route.ts
// GET — live dashboard payload for the logged-in ops user's tenant.
// Used by the dashboard client to refresh (poll every ~15s + realtime trigger).
//
// Temporary timing log: this route's P75 is ~26s in prod while every other route
// is sub-1.3s, despite ~9 employees. The code here is a thin wrapper over
// getDashboardData (4 parallel queries + sync JS — NOT an N+1), so the cost is
// either the per-request auth round-trip (getOpsContext -> auth.getUser hits
// GoTrue on every poll) or the DB queries. This splits the two so a single
// Vercel log line tells us which. Remove once the culprit is confirmed.

import { NextResponse } from 'next/server'
import { getOpsContext } from '@/lib/ops'
import { getDashboardData } from '@/lib/dashboard'

export async function GET() {
  const t0 = Date.now()
  const ctx = await getOpsContext()
  const tCtx = Date.now()
  if (!ctx) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (!ctx.opsUser) {
    return NextResponse.json({ error: 'No ops profile' }, { status: 403 })
  }

  const data = await getDashboardData(ctx.opsUser.tenant_id)
  const tData = Date.now()
  console.log(`[attendance] context=${tCtx - t0}ms dashboard=${tData - tCtx}ms total=${tData - t0}ms`)
  return NextResponse.json(data)
}
