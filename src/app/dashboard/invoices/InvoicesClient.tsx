'use client'
// src/app/dashboard/invoices/InvoicesClient.tsx
// Client billing: list invoices, generate one from a period's verified shifts
// (POST /api/invoices), and update status to sent/paid (PATCH).

import { useState, useEffect, useCallback } from 'react'

import { T } from '@/lib/theme'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

type Client = { id: string; name: string }
type Invoice = {
  id: string
  invoice_number: string
  period_month: number
  period_year: number
  subtotal: number
  vat_amount: number
  total: number
  status: 'draft' | 'sent' | 'paid' | 'overdue'
  issue_date: string | null
  client: { name: string } | null
  line_items: any[]
}

export default function InvoicesClient({ tenantId, clients }: { tenantId: string; clients: Client[] }) {
  const today = { m: new Date().getMonth() + 1, y: new Date().getFullYear() }
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [genOpen, setGenOpen] = useState(false)
  const [gen, setGen] = useState({ client_id: clients[0]?.id ?? '', month: today.m, year: today.y, vat_rate: 5 })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/invoices?tenant_id=${tenantId}`, { cache: 'no-store' })
      const body = await res.json()
      setInvoices(res.ok ? body.invoices ?? [] : [])
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { load() }, [load])

  async function generate() {
    if (!gen.client_id) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId, client_id: gen.client_id, month: gen.month, year: gen.year, vat_rate: gen.vat_rate }),
      })
      const body = await res.json()
      if (!res.ok) { setMsg(body.error || 'Could not generate invoice.'); return }
      setMsg(`Invoice ${body.invoice_number} generated — AED ${Math.round(body.total).toLocaleString()}.`)
      setGenOpen(false)
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(inv: Invoice, status: 'sent' | 'paid') {
    setBusy(true)
    try {
      await fetch('/api/invoices', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice_id: inv.id, status }) })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const totals = {
    count: invoices.length,
    outstanding: invoices.filter((i) => i.status !== 'paid').reduce((a, i) => a + (i.total ?? 0), 0),
    paid: invoices.filter((i) => i.status === 'paid').reduce((a, i) => a + (i.total ?? 0), 0),
  }

  return (
    <>
      <style>{css}</style>
      <div className="iv-root">
        <header className="iv-topbar">
          <div className="iv-title">Invoices</div>
          <div className="iv-right">
            <button className="iv-btn primary" onClick={() => { setGenOpen(true); setMsg(null) }}>+ Generate invoice</button>
          </div>
        </header>

        <main className="iv-main">
          <div className="iv-stats">
            <div className="iv-stat"><div className="iv-stat-val" style={{ color: T.white }}>{totals.count}</div><div className="iv-stat-label">Total invoices</div></div>
            <div className="iv-stat"><div className="iv-stat-val" style={{ color: T.amber }}>AED {Math.round(totals.outstanding).toLocaleString()}</div><div className="iv-stat-label">Outstanding</div></div>
            <div className="iv-stat"><div className="iv-stat-val" style={{ color: T.tealBright }}>AED {Math.round(totals.paid).toLocaleString()}</div><div className="iv-stat-label">Paid</div></div>
          </div>

          {msg && <div className="iv-banner">{msg}</div>}

          <div className="iv-table-wrap">
            <table className="iv-table">
              <thead><tr><th>Invoice #</th><th>Client</th><th>Period</th><th>Lines</th><th>Subtotal</th><th>VAT</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: T.dim }}>Loading…</td></tr>}
                {!loading && invoices.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: T.dim }}>No invoices yet. Generate one from a period&apos;s verified shifts.</td></tr>}
                {!loading && invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="iv-mono">{inv.invoice_number || '—'}</td>
                    <td>{inv.client?.name ?? '—'}</td>
                    <td className="iv-mono">{MONTHS[(inv.period_month || 1) - 1]} {inv.period_year}</td>
                    <td className="iv-mono">{inv.line_items?.length ?? 0}</td>
                    <td className="iv-mono">AED {Math.round(inv.subtotal ?? 0).toLocaleString()}</td>
                    <td className="iv-mono">AED {Math.round(inv.vat_amount ?? 0).toLocaleString()}</td>
                    <td className="iv-mono" style={{ color: T.tealBright }}>AED {Math.round(inv.total ?? 0).toLocaleString()}</td>
                    <td><span className={`iv-badge ${inv.status}`}>{inv.status}</span></td>
                    <td>
                      <div className="iv-actions">
                        {inv.status === 'draft' && <button className="iv-act" disabled={busy} onClick={() => setStatus(inv, 'sent')}>Mark sent</button>}
                        {inv.status !== 'paid' && <button className="iv-act" disabled={busy} onClick={() => setStatus(inv, 'paid')}>Mark paid</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>

        {genOpen && (
          <div className="iv-overlay" onClick={() => setGenOpen(false)}>
            <div className="iv-modal" onClick={(e) => e.stopPropagation()}>
              <div className="iv-modal-title">Generate invoice</div>
              <p className="iv-modal-sub">Bills a client for their locations&apos; <strong>verified</strong> shifts in the selected period.</p>
              <div className="iv-field"><label>Client</label><select value={gen.client_id} onChange={(e) => setGen({ ...gen, client_id: e.target.value })}>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div className="iv-field-row">
                <div className="iv-field"><label>Month</label><select value={gen.month} onChange={(e) => setGen({ ...gen, month: Number(e.target.value) })}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></div>
                <div className="iv-field"><label>Year</label><select value={gen.year} onChange={(e) => setGen({ ...gen, year: Number(e.target.value) })}>{[today.y, today.y - 1].map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
                <div className="iv-field"><label>VAT %</label><input type="number" value={gen.vat_rate} onChange={(e) => setGen({ ...gen, vat_rate: Number(e.target.value) })} /></div>
              </div>
              {msg && <div className="iv-banner" style={{ background: T.redBg, borderColor: '#FCA5A5', color: T.red }}>{msg}</div>}
              <div className="iv-modal-actions">
                <button className="iv-btn ghost" onClick={() => setGenOpen(false)}>Cancel</button>
                <button className="iv-btn primary" disabled={busy} onClick={generate}>{busy ? 'Generating…' : 'Generate'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

const css = `
*,*::before,*::after{box-sizing:border-box}
.iv-root{font-family:var(--font-jakarta),sans-serif;background:${T.bg};min-height:100vh;color:${T.white}}
.iv-topbar{background:${T.bgCard};border-bottom:1px solid ${T.border};display:flex;align-items:center;padding:0 28px;height:56px;gap:14px;position:sticky;top:0;z-index:100}
.iv-logo{font-family:'DM Mono',monospace;font-size:13px;color:${T.tealBright};letter-spacing:.06em;text-decoration:none}
.iv-divider{width:1px;height:20px;background:${T.border}}
.iv-title{font-family:var(--font-jakarta),sans-serif;font-size:15px;font-weight:600;color:${T.whiteMid}}
.iv-right{margin-left:auto;display:flex;align-items:center;gap:10px}
.iv-btn{padding:8px 16px;border-radius:8px;border:none;font-family:var(--font-jakarta),sans-serif;font-size:13px;font-weight:600;cursor:pointer}
.iv-btn.primary{background:${T.tealMid};color:#1B2B2B}.iv-btn.primary:hover{opacity:.9}.iv-btn.primary:disabled{opacity:.45;cursor:not-allowed}
.iv-btn.ghost{background:${T.bgSubtle};color:${T.whiteMid};border:1px solid ${T.border}}.iv-btn.ghost:hover{border-color:${T.teal};color:${T.tealBright}}
.iv-main{padding:28px 32px}
.iv-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}
.iv-stat{background:${T.bgCard};border:1px solid ${T.border};border-radius:10px;padding:16px 18px}
.iv-stat-val{font-family:var(--font-jakarta),sans-serif;font-size:24px;font-weight:700;line-height:1;margin-bottom:4px}
.iv-stat-label{font-size:11px;color:${T.dim};font-weight:500}
.iv-banner{padding:12px 16px;border-radius:10px;font-size:13px;margin-bottom:16px;background:${T.tealFaint};border:1px solid ${T.teal};color:${T.tealBright}}
.iv-table-wrap{background:${T.bgCard};border:1px solid ${T.border};border-radius:12px;overflow:hidden}
.iv-table{width:100%;border-collapse:collapse;font-size:13px}
.iv-table thead tr{background:${T.bgSubtle}}
.iv-table thead th{padding:11px 16px;text-align:left;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${T.dim};border-bottom:1px solid ${T.border}}
.iv-table tbody tr{border-bottom:1px solid ${T.border}}
.iv-table tbody tr:last-child{border-bottom:none}
.iv-table tbody tr:hover{background:${T.bgHover}}
.iv-table td{padding:12px 16px;color:${T.whiteMid};vertical-align:middle}
.iv-mono{font-family:'DM Mono',monospace;font-size:12px;color:${T.whiteMid}}
.iv-badge{font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:.03em}
.iv-badge.draft{background:${T.bgSubtle};color:${T.dim};border:1px solid ${T.border}}
.iv-badge.sent{background:${T.amberBg};color:${T.amber};border:1px solid #FCD34D}
.iv-badge.paid{background:${T.greenBg};color:${T.green};border:1px solid #9DEEE6}
.iv-badge.overdue{background:${T.redBg};color:${T.red};border:1px solid #FCA5A5}
.iv-actions{display:flex;gap:6px}
.iv-act{padding:5px 10px;border-radius:6px;border:1px solid ${T.border};background:none;font-family:var(--font-jakarta),sans-serif;font-size:11px;font-weight:600;color:${T.whiteMid};cursor:pointer;white-space:nowrap;transition:all .12s}
.iv-act:hover{border-color:${T.tealMid};color:${T.tealBright}}
.iv-act:disabled{opacity:.5;cursor:not-allowed}
.iv-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:300;display:flex;align-items:center;justify-content:center;padding:24px}
.iv-modal{width:100%;max-width:480px;background:${T.bgCard};border:1px solid ${T.borderMid};border-radius:14px;padding:24px}
.iv-modal-title{font-family:var(--font-jakarta),sans-serif;font-size:18px;font-weight:600;color:${T.white};margin-bottom:6px}
.iv-modal-sub{font-size:13px;color:${T.dim};line-height:1.5;margin-bottom:18px}
.iv-field{display:flex;flex-direction:column;gap:5px;margin-bottom:14px}
.iv-field label{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${T.dim}}
.iv-field select,.iv-field input{background:${T.bgSubtle};border:1px solid ${T.border};border-radius:8px;padding:10px 12px;font-family:var(--font-jakarta),sans-serif;font-size:14px;color:${T.white};outline:none}
.iv-field select:focus,.iv-field input:focus{border-color:${T.teal}}
.iv-field-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
.iv-modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:8px}
`
