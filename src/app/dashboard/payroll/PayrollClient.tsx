'use client'
// src/app/dashboard/payroll/PayrollClient.tsx
// Monthly payroll summary from the monthly_hours view, with a "lock period"
// action (POST /api/payroll) that is blocked while shifts remain pending.

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

const T = {
  bg: '#0a0f0d', bgCard: '#111815', bgHover: '#161e1a', bgSubtle: '#0f1712',
  border: '#1e2b24', borderMid: '#243329', teal: '#0F6E56', tealMid: '#1D9E75',
  tealBright: '#25D09A', tealText: '#5DCAA5', tealFaint: '#0d1f18',
  green: '#22c55e', greenBg: '#0d2018', amber: '#f59e0b', amberBg: '#1f1608',
  red: '#ef4444', redBg: '#1f0d0d', white: '#f0f7f4', whiteMid: '#c8ddd6',
  dim: '#6b8078', dimMid: '#4a6058',
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

type HoursRow = { employee_id: string; employee_name: string; employee_number: string; total_hours: number; gross_pay: number; shifts_worked: number; pending_reviews: number; hourly_rate: number; monthly_salary: number | null; shift_type: string | null }
type PayrollData = { hours: HoursRow[]; pending_reviews: any[]; total_employees: number; total_hours: number; total_gross: number }

export default function PayrollClient({ tenantId, opsUserId }: { tenantId: string; opsUserId: string }) {
  const today = { m: new Date().getMonth() + 1, y: new Date().getFullYear() }
  const [month, setMonth] = useState(today.m)
  const [year, setYear] = useState(today.y)
  const [data, setData] = useState<PayrollData | null>(null)
  const [loading, setLoading] = useState(true)
  const [locking, setLocking] = useState(false)
  const [locked, setLocked] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLocked(false)
    setMsg(null)
    try {
      const res = await fetch(`/api/payroll?tenant_id=${tenantId}&month=${month}&year=${year}`, { cache: 'no-store' })
      const body = await res.json()
      setData(res.ok ? body : { hours: [], pending_reviews: [], total_employees: 0, total_hours: 0, total_gross: 0 })
    } finally {
      setLoading(false)
    }
  }, [tenantId, month, year])

  useEffect(() => { load() }, [load])

  async function lockPeriod() {
    if (!confirm(`Lock payroll for ${MONTHS[month - 1]} ${year}? This finalizes the period.`)) return
    setLocking(true)
    setMsg(null)
    try {
      const res = await fetch('/api/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId, month, year, locked_by: opsUserId }),
      })
      const body = await res.json()
      if (!res.ok) { setMsg(body.error || 'Could not lock period.'); return }
      setLocked(true)
      setMsg(`Period locked. Total gross AED ${Math.round(body.total_gross).toLocaleString()}.`)
    } finally {
      setLocking(false)
    }
  }

  const rows = data?.hours ?? []
  const pendingReviews = data?.pending_reviews?.length ?? 0

  return (
    <>
      <style>{css}</style>
      <div className="py-root">
        <header className="py-topbar">
          <div className="py-title">Payroll summary</div>
          <div className="py-right">
            <select className="py-select" value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
            <select className="py-select" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[today.y, today.y - 1].map((y) => <option key={y} value={y}>{y}</option>)}</select>
            <Link href="/dashboard/payroll/hours" className="py-btn ghost">Verify hours →</Link>
            <button className="py-btn primary" disabled={locking || loading || locked || pendingReviews > 0} onClick={lockPeriod} title={pendingReviews > 0 ? 'Resolve pending reviews first' : ''}>
              {locked ? '🔒 Locked' : locking ? 'Locking…' : '🔒 Lock period'}
            </button>
          </div>
        </header>

        <main className="py-main">
          <div className="py-stats">
            <div className="py-stat"><div className="py-stat-val" style={{ color: T.white }}>{data?.total_employees ?? 0}</div><div className="py-stat-label">Employees paid</div></div>
            <div className="py-stat"><div className="py-stat-val" style={{ color: T.tealBright }}>{Math.round((data?.total_hours ?? 0) * 10) / 10}</div><div className="py-stat-label">Total hours</div></div>
            <div className="py-stat"><div className="py-stat-val" style={{ color: T.tealBright }}>AED {Math.round(data?.total_gross ?? 0).toLocaleString()}</div><div className="py-stat-label">Gross payroll</div></div>
            <div className="py-stat"><div className="py-stat-val" style={{ color: pendingReviews ? T.amber : T.tealBright }}>{pendingReviews}</div><div className="py-stat-label">Shifts pending review</div></div>
          </div>

          {pendingReviews > 0 && (
            <div className="py-banner amber">⚠️ {pendingReviews} shift{pendingReviews > 1 ? 's' : ''} still need review. <Link href="/dashboard/payroll/hours" style={{ color: T.amber, textDecoration: 'underline' }}>Resolve them</Link> before locking.</div>
          )}
          {msg && <div className={`py-banner ${locked ? 'teal' : 'red'}`}>{msg}</div>}

          <div className="py-table-wrap">
            <table className="py-table">
              <thead><tr><th>Employee</th><th>Monthly salary</th><th>Shift</th><th>Shifts</th><th>Hours</th><th>Rate</th><th>Gross pay</th><th>Reviews</th></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: T.dim }}>Loading…</td></tr>}
                {!loading && rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: T.dim }}>No payroll data for {MONTHS[month - 1]} {year}.</td></tr>}
                {!loading && rows.map((r) => (
                  <tr key={r.employee_id}>
                    <td>{r.employee_name}<div className="py-sub">{r.employee_number}</div></td>
                    <td className="py-mono">{r.monthly_salary != null ? `AED ${Math.round(r.monthly_salary).toLocaleString()}` : '—'}</td>
                    <td className="py-mono">{r.shift_type ?? '—'}</td>
                    <td className="py-mono">{r.shifts_worked}</td>
                    <td className="py-mono">{Math.round((r.total_hours ?? 0) * 10) / 10}h</td>
                    <td className="py-mono">AED {r.hourly_rate}</td>
                    <td className="py-mono" style={{ color: T.tealBright }}>AED {Math.round(r.gross_pay ?? 0).toLocaleString()}</td>
                    <td>{r.pending_reviews > 0 ? <span className="py-flag">{r.pending_reviews} pending</span> : <span style={{ color: T.dim, fontSize: 12 }}>—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </>
  )
}

const css = `
*,*::before,*::after{box-sizing:border-box}
.py-root{font-family:'DM Sans',sans-serif;background:${T.bg};min-height:100vh;color:${T.white}}
.py-topbar{background:${T.bgCard};border-bottom:1px solid ${T.border};display:flex;align-items:center;padding:0 28px;height:56px;gap:14px;position:sticky;top:0;z-index:100}
.py-logo{font-family:'DM Mono',monospace;font-size:13px;color:${T.tealBright};letter-spacing:.06em;text-decoration:none}
.py-divider{width:1px;height:20px;background:${T.border}}
.py-title{font-family:'Syne',sans-serif;font-size:15px;font-weight:600;color:${T.whiteMid}}
.py-right{margin-left:auto;display:flex;align-items:center;gap:10px}
.py-select{background:${T.bgSubtle};border:1px solid ${T.border};border-radius:8px;padding:7px 12px;font-family:'DM Sans',sans-serif;font-size:13px;color:${T.white};outline:none;cursor:pointer}
.py-btn{padding:7px 14px;border-radius:8px;border:none;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none}
.py-btn.ghost{background:${T.bgSubtle};color:${T.whiteMid};border:1px solid ${T.border}}.py-btn.ghost:hover{border-color:${T.teal};color:${T.tealBright}}
.py-btn.primary{background:${T.tealMid};color:#fff}.py-btn.primary:hover{opacity:.9}
.py-btn.primary:disabled{opacity:.45;cursor:not-allowed}
.py-main{padding:28px 32px}
.py-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
.py-stat{background:${T.bgCard};border:1px solid ${T.border};border-radius:10px;padding:16px 18px}
.py-stat-val{font-family:'Syne',sans-serif;font-size:24px;font-weight:700;line-height:1;margin-bottom:4px}
.py-stat-label{font-size:11px;color:${T.dim};font-weight:500}
.py-banner{padding:12px 16px;border-radius:10px;font-size:13px;margin-bottom:16px}
.py-banner.amber{background:${T.amberBg};border:1px solid #5a3d0a;color:${T.amber}}
.py-banner.teal{background:${T.tealFaint};border:1px solid ${T.teal};color:${T.tealBright}}
.py-banner.red{background:${T.redBg};border:1px solid #3d1a1a;color:${T.red}}
.py-table-wrap{background:${T.bgCard};border:1px solid ${T.border};border-radius:12px;overflow:hidden}
.py-table{width:100%;border-collapse:collapse;font-size:13px}
.py-table thead tr{background:${T.bgSubtle}}
.py-table thead th{padding:11px 16px;text-align:left;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${T.dim};border-bottom:1px solid ${T.border}}
.py-table tbody tr{border-bottom:1px solid ${T.border}}
.py-table tbody tr:last-child{border-bottom:none}
.py-table tbody tr:hover{background:${T.bgHover}}
.py-table td{padding:12px 16px;color:${T.whiteMid};vertical-align:middle}
.py-sub{font-family:'DM Mono',monospace;font-size:10px;color:${T.dim}}
.py-mono{font-family:'DM Mono',monospace;font-size:12px;color:${T.whiteMid}}
.py-flag{font-size:10px;font-weight:700;color:${T.amber};background:${T.amberBg};border:1px solid #5a3d0a;padding:2px 8px;border-radius:10px;text-transform:uppercase}
`
