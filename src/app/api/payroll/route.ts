// src/app/api/payroll/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getOpsContext } from '@/lib/ops'

// GET /api/payroll?month=&year=  (tenant from session)
// Returns payroll summary from monthly_hours view
export async function GET(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  const tenant_id = ctx.opsUser.tenant_id

  const supabase = createServerSupabaseClient()
  const { searchParams } = new URL(req.url)
  const month = searchParams.get('month')
  const year = searchParams.get('year')

  if (!month || !year) {
    return NextResponse.json({ error: 'month and year are required' }, { status: 400 })
  }

  // Get hours from view
  const { data: hours, error: hoursErr } = await supabase
    .from('monthly_hours')
    .select('*')
    .eq('month', parseInt(month))
    .eq('year', parseInt(year))

  if (hoursErr) return NextResponse.json({ error: hoursErr.message }, { status: 500 })

  // Attach monthly_salary + shift_type (stored on employees, not in the view).
  const { data: emps } = await supabase
    .from('employees')
    .select('id, monthly_salary, shift_type')
    .eq('tenant_id', tenant_id)
  const salaryByEmp = new Map((emps ?? []).map((e) => [e.id, e]))
  const hoursWithSalary = (hours ?? []).map((h: any) => ({
    ...h,
    monthly_salary: salaryByEmp.get(h.employee_id)?.monthly_salary ?? null,
    shift_type: salaryByEmp.get(h.employee_id)?.shift_type ?? null,
  }))

  // Get shifts needing review
  const startDate = `${year}-${month.padStart(2,'0')}-01`
  const endDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0]

  const { data: pendingReviews } = await supabase
    .from('shifts')
    .select('id, employee_id, date, needs_review, review_note, status, hours_raw, hours_final, hourly_rate')
    .eq('tenant_id', tenant_id)
    .eq('voided', false)
    .eq('needs_review', true)
    .gte('date', startDate)
    .lte('date', endDate)

  return NextResponse.json({
    hours: hoursWithSalary,
    pending_reviews: pendingReviews || [],
    total_employees: hours?.length || 0,
    total_hours: hours?.reduce((a, e) => a + (e.total_hours || 0), 0) || 0,
    total_gross: hours?.reduce((a, e) => a + (e.gross_pay || 0), 0) || 0,
  })
}

// POST /api/payroll/lock — lock a payroll period
export async function POST(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  const supabase = createServerSupabaseClient()

  try {
    const { month, year } = await req.json()
    const tenant_id = ctx.opsUser.tenant_id
    const locked_by = ctx.opsUser.id

    // Check no disputed or pending shifts remain
    const startDate = `${year}-${String(month).padStart(2,'0')}-01`
    const endDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0]

    const { data: blockers } = await supabase
      .from('shifts')
      .select('id')
      .eq('tenant_id', tenant_id)
      .eq('voided', false)
      .in('status', ['disputed', 'pending'])
      .gte('date', startDate)
      .lte('date', endDate)

    if (blockers && blockers.length > 0) {
      return NextResponse.json({
        error: `Cannot lock payroll — ${blockers.length} shift(s) still pending or disputed.`,
        count: blockers.length,
      }, { status: 409 })
    }

    // Create or update payroll period
    const { data: hours } = await supabase
      .from('monthly_hours')
      .select('total_hours, gross_pay')
      .eq('month', month)
      .eq('year', year)

    const totalGross = hours?.reduce((a, e) => a + (e.gross_pay || 0), 0) || 0

    const { error } = await supabase
      .from('payroll_periods')
      .upsert({
        tenant_id,
        period_month: month,
        period_year: year,
        status: 'locked',
        locked_at: new Date().toISOString(),
        locked_by: locked_by || null,
        total_gross: totalGross,
        employee_count: hours?.length || 0,
      })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true, total_gross: totalGross })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
