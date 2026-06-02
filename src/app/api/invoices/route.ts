// src/app/api/invoices/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getOpsContext } from '@/lib/ops'

// GET /api/invoices  (tenant from session)
export async function GET(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  const tenant_id = ctx.opsUser.tenant_id

  const supabase = createServerSupabaseClient()
  const { searchParams } = new URL(req.url)
  const month = searchParams.get('month')
  const year = searchParams.get('year')

  let query = supabase
    .from('invoices')
    .select(`
      *,
      client:clients(id, name, legal_name, email, trn),
      line_items:invoice_line_items(*)
    `)
    .eq('tenant_id', tenant_id)
    .order('created_at', { ascending: false })

  if (month) query = query.eq('period_month', parseInt(month))
  if (year) query = query.eq('period_year', parseInt(year))

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ invoices: data })
}

// POST /api/invoices — generate invoice from verified shift data
export async function POST(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  const supabase = createServerSupabaseClient()

  try {
    const { client_id, month, year, vat_rate = 5, notes } = await req.json()
    const tenant_id = ctx.opsUser.tenant_id

    if (!client_id || !month || !year) {
      return NextResponse.json(
        { error: 'client_id, month, year required' },
        { status: 400 }
      )
    }

    const startDate = `${year}-${String(month).padStart(2,'0')}-01`
    const endDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0]

    // Fetch verified shifts for this client's locations this period
    const { data: shifts } = await supabase
      .from('shifts')
      .select(`
        hours_final, hourly_rate, gross_pay, employee_id,
        location:locations!inner(id, name, client_id)
      `)
      .eq('tenant_id', tenant_id)
      .eq('status', 'verified')
      .eq('locations.client_id', client_id)
      .gte('date', startDate)
      .lte('date', endDate)

    if (!shifts || shifts.length === 0) {
      return NextResponse.json(
        { error: 'No verified shifts found for this client and period.' },
        { status: 404 }
      )
    }

    // Group by location
    const byLocation: Record<string, {
      location_name: string
      location_id: string
      hours: number
      employees: Set<string>
    }> = {}

    for (const shift of shifts) {
      const loc = shift.location as any
      if (!loc) continue
      if (!byLocation[loc.id]) {
        byLocation[loc.id] = {
          location_id: loc.id,
          location_name: loc.name,
          hours: 0,
          employees: new Set(),
        }
      }
      byLocation[loc.id].hours += shift.hours_final || 0
      byLocation[loc.id].employees.add(shift.employee_id)
    }

    // Get billing rate — use first shift's hourly_rate
    const rate = shifts[0].hourly_rate

    // Build line items
    const lineItems = Object.values(byLocation).map(loc => ({
      location_id: loc.location_id,
      location_name: loc.location_name,
      pickers: loc.employees.size,
      hours: Math.round(loc.hours * 100) / 100,
      rate,
      subtotal: Math.round(loc.hours * rate * 100) / 100,
    }))

    const subtotal = lineItems.reduce((a, l) => a + l.subtotal, 0)
    const vatAmount = Math.round(subtotal * (vat_rate / 100) * 100) / 100
    const total = subtotal + vatAmount

    // Create invoice
    const { data: invoice, error: invErr } = await supabase
      .from('invoices')
      .insert({
        tenant_id,
        client_id,
        invoice_number: '',  // trigger will set
        period_month: month,
        period_year: year,
        due_date: new Date(parseInt(year), parseInt(month), 15).toISOString().split('T')[0],
        subtotal,
        vat_rate,
        vat_amount: vatAmount,
        total,
        notes: notes || null,
      })
      .select('id, invoice_number')
      .single()

    if (invErr || !invoice) {
      return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 })
    }

    // Insert line items
    await supabase.from('invoice_line_items').insert(
      lineItems.map(li => ({ invoice_id: invoice.id, ...li }))
    )

    return NextResponse.json({
      success: true,
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      total,
      line_items: lineItems.length,
    })
  } catch (err) {
    console.error('Invoice generation error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/invoices — update invoice status
export async function PATCH(req: NextRequest) {
  const ctx = await getOpsContext()
  if (!ctx?.opsUser) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  const supabase = createServerSupabaseClient()

  try {
    const { invoice_id, status } = await req.json()

    const updates: any = { status }
    if (status === 'sent') updates.sent_at = new Date().toISOString()
    if (status === 'paid') updates.paid_at = new Date().toISOString()

    const { error } = await supabase
      .from('invoices')
      .update(updates)
      .eq('id', invoice_id)
      .eq('tenant_id', ctx.opsUser.tenant_id) // scope to tenant

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
