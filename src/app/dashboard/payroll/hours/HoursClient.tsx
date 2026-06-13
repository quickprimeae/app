'use client'
// src/app/dashboard/payroll/hours/HoursClient.tsx
// Hours & verification: per-shift table for a month with verify / adjust /
// dispute actions wired to /api/shifts.

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

type Shift = {
  id: string
  date: string
  clock_in_time: string | null
  clock_out_time: string | null
  hours_raw: number | null
  hours_final: number | null
  hourly_rate: number | null
  gross_pay: number | null
  is_auto_clockout: boolean
  needs_review: boolean
  review_note: string | null
  status: 'pending' | 'verified' | 'adjusted' | 'disputed'
  employee: { first_name: string; last_name: string; employee_number: string } | null
  location: { name: string } | null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
type StatusFilter = 'all' | 'pending' | 'verified' | 'adjusted' | 'disputed' | 'review'

function fmtTime(iso: string | null) {
  return iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

export default function HoursClient() {
  const today = { m: new Date().getMonth() + 1, y: new Date().getFullYear() }
  const [month, setMonth] = useState(today.m)
  const [year, setYear] = useState(today.y)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/shifts?month=${month}&year=${year}`, { cache: 'no-store' })
      const body = await res.json()
      setShifts(res.ok ? body.shifts ?? [] : [])
    } finally {
      setLoading(false)
    }
  }, [month, year])

  useEffect(() => { load() }, [load])

  const shown = shifts.filter((s) => (filter === 'all' ? true : filter === 'review' ? s.needs_review : s.status === filter))

  const stats = {
    total: shifts.length,
    review: shifts.filter((s) => s.needs_review).length,
    hours: Math.round(shifts.reduce((a, s) => a + (s.hours_final ?? s.hours_raw ?? 0), 0) * 10) / 10,
    gross: Math.round(shifts.reduce((a, s) => a + (s.gross_pay ?? (s.hours_final ?? 0) * (s.hourly_rate ?? 0)), 0)),
  }

  async function act(shift: Shift, action: 'verify' | 'adjust' | 'dispute') {
    let hours_adjusted: number | undefined
    let review_note: string | undefined
    if (action === 'adjust') {
      const v = prompt(`Adjusted hours for this shift (was ${shift.hours_final ?? shift.hours_raw ?? 0}):`, String(shift.hours_final ?? shift.hours_raw ?? 0))
      if (v == null) return
      hours_adjusted = Number(v)
      if (!Number.isFinite(hours_adjusted) || hours_adjusted < 0) { alert('Enter a valid number of hours.'); return }
      review_note = prompt('Reason for adjustment (optional):') || undefined
    } else if (action === 'dispute') {
      review_note = prompt('Reason for dispute:') || undefined
    }
    setBusy(true)
    try {
      await fetch('/api/shifts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shift_id: shift.id, action, hours_adjusted, review_note }),
      })
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <style>{css}</style>
      <div className="hv-root">
        <header className="hv-topbar">
          <div className="hv-title">Hours &amp; verification</div>
          <div className="hv-right">
            <select className="hv-select" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select className="hv-select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[today.y, today.y - 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <Link href="/dashboard/payroll" className="hv-btn ghost">Payroll summary →</Link>
          </div>
        </header>

        <main className="hv-main">
          <div className="hv-stats">
            <div className="hv-stat"><div className="hv-stat-val" style={{ color: T.white }}>{stats.total}</div><div className="hv-stat-label">Shifts this month</div></div>
            <div className="hv-stat"><div className="hv-stat-val" style={{ color: stats.review ? T.amber : T.tealBright }}>{stats.review}</div><div className="hv-stat-label">Need review</div></div>
            <div className="hv-stat"><div className="hv-stat-val" style={{ color: T.tealBright }}>{stats.hours}</div><div className="hv-stat-label">Total hours</div></div>
            <div className="hv-stat"><div className="hv-stat-val" style={{ color: T.tealBright }}>AED {stats.gross.toLocaleString()}</div><div className="hv-stat-label">Gross pay</div></div>
          </div>

          <div className="hv-filters">
            {([['all', 'All'], ['review', 'Needs review'], ['pending', 'Pending'], ['verified', 'Verified'], ['adjusted', 'Adjusted'], ['disputed', 'Disputed']] as const).map(([id, label]) => (
              <button key={id} className={`hv-filter ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>{label}</button>
            ))}
          </div>

          <div className="hv-table-wrap">
            <table className="hv-table">
              <thead><tr><th>Employee</th><th>Location</th><th>Date</th><th>Clock in</th><th>Clock out</th><th>Hours</th><th>Gross</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: T.dim }}>Loading…</td></tr>}
                {!loading && shown.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: T.dim }}>No shifts for this period / filter.</td></tr>}
                {!loading && shown.map((s) => (
                  <tr key={s.id} className={s.needs_review ? 'review' : ''}>
                    <td>{s.employee ? `${s.employee.first_name} ${s.employee.last_name}` : '—'}<div className="hv-sub">{s.employee?.employee_number}</div></td>
                    <td className="hv-loc">{s.location?.name ?? '—'}</td>
                    <td className="hv-mono">{fmtDate(s.date)}</td>
                    <td className="hv-mono">{fmtTime(s.clock_in_time)}</td>
                    <td className="hv-mono">{s.clock_out_time ? fmtTime(s.clock_out_time) : <span style={{ color: T.amber }}>missing</span>}{s.is_auto_clockout && <span className="hv-auto">auto</span>}</td>
                    <td className="hv-mono">{(s.hours_final ?? s.hours_raw ?? 0)}h</td>
                    <td className="hv-mono">AED {Math.round(s.gross_pay ?? (s.hours_final ?? 0) * (s.hourly_rate ?? 0))}</td>
                    <td><span className={`hv-badge ${s.status}`}>{s.status}</span></td>
                    <td>
                      <div className="hv-actions">
                        {s.status !== 'verified' && <button className="hv-act" disabled={busy} onClick={() => act(s, 'verify')}>✓ Verify</button>}
                        <button className="hv-act" disabled={busy} onClick={() => act(s, 'adjust')}>✎ Adjust</button>
                        {s.status !== 'disputed' && <button className="hv-act danger" disabled={busy} onClick={() => act(s, 'dispute')}>⚑ Dispute</button>}
                      </div>
                    </td>
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
.hv-root{font-family:'DM Sans',sans-serif;background:${T.bg};min-height:100vh;color:${T.white}}
.hv-topbar{background:${T.bgCard};border-bottom:1px solid ${T.border};display:flex;align-items:center;padding:0 28px;height:56px;gap:16px;position:sticky;top:0;z-index:100}
.hv-logo{font-family:'DM Mono',monospace;font-size:13px;color:${T.tealBright};letter-spacing:.06em;text-decoration:none}
.hv-divider{width:1px;height:20px;background:${T.border}}
.hv-title{font-family:'Syne',sans-serif;font-size:15px;font-weight:600;color:${T.whiteMid}}
.hv-right{margin-left:auto;display:flex;align-items:center;gap:10px}
.hv-select{background:${T.bgSubtle};border:1px solid ${T.border};border-radius:8px;padding:7px 12px;font-family:'DM Sans',sans-serif;font-size:13px;color:${T.white};outline:none;cursor:pointer}
.hv-btn{padding:7px 14px;border-radius:8px;border:none;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none}
.hv-btn.ghost{background:${T.bgSubtle};color:${T.whiteMid};border:1px solid ${T.border}}.hv-btn.ghost:hover{border-color:${T.teal};color:${T.tealBright}}
.hv-main{padding:28px 32px}
.hv-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px}
.hv-stat{background:${T.bgCard};border:1px solid ${T.border};border-radius:10px;padding:16px 18px}
.hv-stat-val{font-family:'Syne',sans-serif;font-size:24px;font-weight:700;line-height:1;margin-bottom:4px}
.hv-stat-label{font-size:11px;color:${T.dim};font-weight:500}
.hv-filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}
.hv-filter{padding:6px 13px;border-radius:18px;border:1px solid ${T.border};background:none;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;color:${T.dim};cursor:pointer;transition:all .12s}
.hv-filter:hover{border-color:${T.teal};color:${T.tealText}}
.hv-filter.active{background:${T.tealFaint};border-color:${T.teal};color:${T.tealBright}}
.hv-table-wrap{background:${T.bgCard};border:1px solid ${T.border};border-radius:12px;overflow:hidden}
.hv-table{width:100%;border-collapse:collapse;font-size:13px}
.hv-table thead tr{background:${T.bgSubtle}}
.hv-table thead th{padding:11px 16px;text-align:left;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${T.dim};border-bottom:1px solid ${T.border};white-space:nowrap}
.hv-table tbody tr{border-bottom:1px solid ${T.border}}
.hv-table tbody tr:last-child{border-bottom:none}
.hv-table tbody tr:hover{background:${T.bgHover}}
.hv-table tbody tr.review{background:#0f0c04}
.hv-table td{padding:11px 16px;vertical-align:middle;color:${T.whiteMid}}
.hv-sub{font-family:'DM Mono',monospace;font-size:10px;color:${T.dim}}
.hv-loc{font-size:12px;color:${T.dim};max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hv-mono{font-family:'DM Mono',monospace;font-size:12px;color:${T.whiteMid}}
.hv-auto{margin-left:6px;font-size:9px;font-weight:700;color:${T.amber};background:${T.amberBg};padding:1px 5px;border-radius:6px;text-transform:uppercase}
.hv-badge{font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:.03em}
.hv-badge.pending{background:${T.bgSubtle};color:${T.dim};border:1px solid ${T.border}}
.hv-badge.verified{background:${T.greenBg};color:${T.green};border:1px solid #1a4030}
.hv-badge.adjusted{background:${T.tealFaint};color:${T.tealBright};border:1px solid ${T.teal}}
.hv-badge.disputed{background:${T.redBg};color:${T.red};border:1px solid #3d1a1a}
.hv-actions{display:flex;gap:6px}
.hv-act{padding:5px 9px;border-radius:6px;border:1px solid ${T.border};background:none;font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;color:${T.whiteMid};cursor:pointer;white-space:nowrap;transition:all .12s}
.hv-act:hover{border-color:${T.tealMid};color:${T.tealBright}}
.hv-act.danger:hover{border-color:#5a1a1a;color:${T.red}}
.hv-act:disabled{opacity:.5;cursor:not-allowed}
`
