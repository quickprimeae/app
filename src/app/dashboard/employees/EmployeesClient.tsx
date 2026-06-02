'use client'
// src/app/dashboard/employees/EmployeesClient.tsx
// Employee roster: filter sidebar, sortable paginated table, detail drawer,
// reference-photo upload, deactivate. Data is fetched server-side and kept
// fresh with router.refresh() after mutations.

import { useState, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { EmployeeRow } from '@/lib/employees-data'

const T = {
  bg: '#0a0f0d', bgCard: '#111815', bgHover: '#161e1a', bgSubtle: '#0f1712',
  border: '#1e2b24', borderMid: '#243329', tealDark: '#085041', teal: '#0F6E56',
  tealMid: '#1D9E75', tealBright: '#25D09A', tealText: '#5DCAA5', tealFaint: '#0d1f18',
  green: '#22c55e', greenBg: '#0d2018', amber: '#f59e0b', amberBg: '#1f1608',
  red: '#ef4444', redBg: '#1f0d0d', white: '#f0f7f4', whiteMid: '#c8ddd6',
  dim: '#6b8078', dimMid: '#4a6058',
}
const PAGE_SIZE = 12

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

type SortKey = keyof EmployeeRow
type StatusFilter = 'all' | 'active' | 'late' | 'absent' | 'flagged' | 'nophoto'

export default function EmployeesClient({ initial }: { initial: EmployeeRow[] }) {
  const router = useRouter()
  const ALL = initial
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [clientFilter, setClientFilter] = useState('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<{ key: SortKey; dir: number }>({ key: 'name', dir: 1 })
  const [busy, setBusy] = useState(false)
  const photoInput = useRef<HTMLInputElement | null>(null)

  const filtered = useMemo(() => {
    let d = ALL
    if (statusFilter !== 'all') {
      if (statusFilter === 'flagged') d = d.filter((e) => e.flagged)
      else if (statusFilter === 'nophoto') d = d.filter((e) => !e.hasPhoto)
      else d = d.filter((e) => e.status === statusFilter)
    }
    if (clientFilter !== 'all') d = d.filter((e) => e.client === clientFilter)
    if (search) {
      const q = search.toLowerCase()
      d = d.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.empId.toLowerCase().includes(q) ||
          e.location.toLowerCase().includes(q) ||
          e.phone.includes(q)
      )
    }
    return [...d].sort((a, b) => {
      const av = a[sort.key] ?? ''
      const bv = b[sort.key] ?? ''
      return av < bv ? -sort.dir : av > bv ? sort.dir : 0
    })
  }, [ALL, search, statusFilter, clientFilter, sort])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const selectedEmp = selected ? ALL.find((e) => e.id === selected) ?? null : null

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }))
  }
  function sortIcon(key: SortKey) {
    if (sort.key !== key) return <span style={{ opacity: 0.3 }}>↕</span>
    return sort.dir === 1 ? '↑' : '↓'
  }
  // Reset page + clear the open drawer whenever a filter changes (bugs #5, #6).
  function setStatus(f: StatusFilter) { setStatusFilter(f); setPage(1); setSelected(null) }
  function setClient(c: string) { setClientFilter(c); setPage(1); setSelected(null) }

  const counts = {
    all: ALL.length,
    active: ALL.filter((e) => e.status === 'active').length,
    absent: ALL.filter((e) => e.status === 'absent').length,
    late: ALL.filter((e) => e.status === 'late').length,
    flagged: ALL.filter((e) => e.flagged).length,
    nophoto: ALL.filter((e) => !e.hasPhoto).length,
  } as Record<string, number>

  function exportCsv() {
    const headers = ['Employee ID', 'Name', 'Phone', 'Location', 'Client', 'Status', 'Rate', 'Hours (mo)', 'Active']
    const lines = filtered.map((e) =>
      [e.empId, e.name, e.phone, e.location, e.client ?? '', e.status, e.hourlyRate, e.hoursThisMonth, e.active ? 'yes' : 'no']
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    )
    const csv = [headers.join(','), ...lines].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'quickprime_employees.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function deactivate(emp: EmployeeRow) {
    if (!confirm(`Deactivate ${emp.name}? They will no longer be able to clock in.`)) return
    setBusy(true)
    try {
      await fetch('/api/employees', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: emp.id, active: false }),
      })
      setSelected(null)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function reactivate(emp: EmployeeRow) {
    setBusy(true)
    try {
      await fetch('/api/employees', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: emp.id, active: true }),
      })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function uploadPhoto(emp: EmployeeRow, file: File | null) {
    if (!file) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('employee_id', emp.id)
      fd.append('file', file)
      await fetch('/api/employees/photo', { method: 'POST', body: fd })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <style>{css}</style>
      <div className="ep-root">
        <header className="ep-topbar">
          <Link href="/dashboard" className="ep-logo">QUICKPRIME</Link>
          <div className="ep-divider" />
          <div className="ep-topbar-title">Employees</div>
          <div className="ep-topbar-right">
            <div className="ep-search">
              <span style={{ fontSize: 13, color: T.dim }}>🔍</span>
              <input placeholder="Search name, ID, location…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
            </div>
            <button className="ep-btn ghost" onClick={exportCsv}>⬇ Export CSV</button>
            <Link href="/dashboard/employees/new" className="ep-btn primary" style={{ textDecoration: 'none' }}>+ Add employee</Link>
          </div>
        </header>

        <div className="ep-body">
          <aside className="ep-sidebar-filters">
            <div className="ep-filter-group">
              <div className="ep-filter-label">Today&apos;s status</div>
              {([
                { id: 'all', label: 'All employees', dot: T.dim },
                { id: 'active', label: 'Clocked in', dot: T.tealBright },
                { id: 'late', label: 'Late', dot: T.amber },
                { id: 'absent', label: 'Absent today', dot: T.red },
                { id: 'flagged', label: 'Face flagged', dot: T.amber },
                { id: 'nophoto', label: 'No photo', dot: T.dimMid },
              ] as const).map((f) => (
                <button key={f.id} className={`ep-filter-item ${statusFilter === f.id ? 'active' : ''}`} onClick={() => setStatus(f.id)}>
                  <div className="ep-filter-dot" style={{ background: statusFilter === f.id ? f.dot : T.dimMid }} />
                  {f.label}
                  <span className="ep-filter-count">{counts[f.id] ?? ''}</span>
                </button>
              ))}
            </div>
            <div className="ep-filter-group">
              <div className="ep-filter-label">Client</div>
              {['all', 'Talabat', 'Deliveroo'].map((c) => (
                <button key={c} className={`ep-filter-item ${clientFilter === c ? 'active' : ''}`} onClick={() => setClient(c)}>
                  <div className="ep-filter-dot" style={{ background: clientFilter === c ? T.tealBright : T.dimMid }} />
                  {c === 'all' ? 'All clients' : c}
                  <span className="ep-filter-count">{c === 'all' ? ALL.length : ALL.filter((e) => e.client === c).length}</span>
                </button>
              ))}
            </div>
          </aside>

          <main className="ep-main">
            <div className="ep-stats">
              <div className="ep-stat"><div className="ep-stat-val" style={{ color: T.white }}>{counts.all}</div><div className="ep-stat-label">Total employees</div></div>
              <div className="ep-stat"><div className="ep-stat-val" style={{ color: T.tealBright }}>{counts.active}</div><div className="ep-stat-label">Clocked in today</div></div>
              <div className="ep-stat"><div className="ep-stat-val" style={{ color: T.red }}>{counts.absent}</div><div className="ep-stat-label">Absent today</div></div>
              <div className="ep-stat"><div className="ep-stat-val" style={{ color: T.amber }}>{counts.flagged}</div><div className="ep-stat-label">Face flags pending</div></div>
            </div>

            <div className="ep-table-wrap">
              <table className="ep-table">
                <thead>
                  <tr>
                    <th onClick={() => toggleSort('name')}>Employee {sortIcon('name')}</th>
                    <th onClick={() => toggleSort('status')}>Status {sortIcon('status')}</th>
                    <th onClick={() => toggleSort('location')}>Location {sortIcon('location')}</th>
                    <th onClick={() => toggleSort('client')}>Client {sortIcon('client')}</th>
                    <th onClick={() => toggleSort('clockedInAt')}>Clocked in {sortIcon('clockedInAt')}</th>
                    <th onClick={() => toggleSort('hourlyRate')}>Rate {sortIcon('hourlyRate')}</th>
                    <th onClick={() => toggleSort('hoursThisMonth')}>Hours (mo.) {sortIcon('hoursThisMonth')}</th>
                    <th>Photo</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 && (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: T.dim }}>No employees match your filters.</td></tr>
                  )}
                  {pageRows.map((emp) => (
                    <tr key={emp.id} className={selected === emp.id ? 'selected' : ''} onClick={() => setSelected(selected === emp.id ? null : emp.id)} style={{ opacity: emp.active ? 1 : 0.5 }}>
                      <td>
                        <div className="ep-name-cell">
                          <div className="ep-avatar">{emp.initials}</div>
                          <div><div className="ep-emp-name">{emp.name}</div><div className="ep-emp-id">{emp.empId}</div></div>
                        </div>
                      </td>
                      <td>
                        <span className={`ep-badge ${emp.flagged ? 'flagged' : emp.status}`}>
                          {emp.flagged ? '⚠ flagged' : emp.status === 'active' ? '✓ in' : emp.status === 'late' ? '⏱ late' : '✗ absent'}
                        </span>
                      </td>
                      <td><div className="ep-location-text">{emp.location}</div></td>
                      <td><span style={{ fontSize: 12, color: T.whiteMid }}>{emp.client ?? '—'}</span></td>
                      <td><span className="ep-mono">{fmt(emp.clockedInAt)}</span></td>
                      <td><span className="ep-mono">AED {emp.hourlyRate}</span></td>
                      <td><span className="ep-mono">{emp.hoursThisMonth}h</span></td>
                      <td>{emp.hasPhoto ? <span className="ep-badge active">✓ set</span> : <span className="ep-badge nophoto">missing</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="ep-pagination">
                <span>Showing {filtered.length === 0 ? 0 : Math.min((page - 1) * PAGE_SIZE + 1, filtered.length)}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} employees</span>
                <div className="ep-page-btns">
                  <button className="ep-page-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>‹</button>
                  {Array.from({ length: pages }, (_, i) => (
                    <button key={i} className={`ep-page-btn ${page === i + 1 ? 'active' : ''}`} onClick={() => setPage(i + 1)}>{i + 1}</button>
                  ))}
                  <button className="ep-page-btn" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages}>›</button>
                </div>
              </div>
            </div>
          </main>
        </div>

        {selectedEmp && (
          <div className="ep-overlay" onClick={() => setSelected(null)}>
            <div className="ep-drawer" onClick={(e) => e.stopPropagation()}>
              <div className="ep-drawer-header">
                <div className="ep-drawer-top">
                  <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                    <div className="ep-drawer-avatar">{selectedEmp.initials}</div>
                    <div><div className="ep-drawer-name">{selectedEmp.name}</div><div className="ep-drawer-id">{selectedEmp.empId} · {selectedEmp.nationality ?? '—'}</div></div>
                  </div>
                  <button className="ep-close" onClick={() => setSelected(null)}>✕</button>
                </div>
                <div className="ep-drawer-badges">
                  <span className={`ep-badge ${selectedEmp.flagged ? 'flagged' : selectedEmp.status}`}>
                    {selectedEmp.flagged ? '⚠ face flagged' : selectedEmp.status === 'active' ? '✓ clocked in' : selectedEmp.status === 'late' ? '⏱ late' : '✗ absent today'}
                  </span>
                  <span className="ep-badge" style={{ background: T.bgSubtle, color: T.dim, border: `1px solid ${T.border}` }}>{selectedEmp.client ?? 'No client'}</span>
                  {!selectedEmp.active && <span className="ep-badge absent">deactivated</span>}
                  {!selectedEmp.hasPhoto && <span className="ep-badge nophoto">⚠ no reference photo</span>}
                </div>
              </div>

              <div className="ep-drawer-body">
                <div className="ep-drawer-section">
                  <div className="ep-drawer-section-title">Details</div>
                  <div className="ep-detail-grid">
                    {[
                      { label: 'Phone', val: selectedEmp.phone, mono: true },
                      { label: 'Start date', val: fmtDate(selectedEmp.startDate) },
                      { label: 'Location', val: selectedEmp.location },
                      { label: 'Supervisor', val: selectedEmp.supervisor ?? 'Unassigned' },
                      { label: 'Shift', val: `${selectedEmp.shiftHours} · ${selectedEmp.shiftDays ?? '—'}` },
                      { label: 'Hourly rate', val: `AED ${selectedEmp.hourlyRate}/hr`, mono: true },
                      { label: 'PIN', val: selectedEmp.pinSet ? '✓ set up' : '⚠ not set' },
                    ].map((c) => (
                      <div key={c.label} className="ep-detail-cell">
                        <div className="ep-detail-cell-label">{c.label}</div>
                        <div className={`ep-detail-cell-val${c.mono ? ' mono' : ''}`}>{c.val}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="ep-drawer-section">
                  <div className="ep-drawer-section-title">This month</div>
                  <div className="ep-detail-grid">
                    <div className="ep-detail-cell">
                      <div className="ep-detail-cell-label">Hours worked</div>
                      <div className="ep-detail-cell-val mono" style={{ color: T.tealBright }}>{selectedEmp.hoursThisMonth}h</div>
                      <div className="ep-hours-bar"><div className="ep-hours-fill" style={{ width: `${Math.min(100, (selectedEmp.hoursThisMonth / 220) * 100)}%` }} /></div>
                    </div>
                    <div className="ep-detail-cell">
                      <div className="ep-detail-cell-label">Earned (gross)</div>
                      <div className="ep-detail-cell-val mono" style={{ color: T.tealBright }}>AED {selectedEmp.earnedThisMonth.toLocaleString()}</div>
                    </div>
                  </div>
                </div>

                <div className="ep-drawer-section">
                  <div className="ep-drawer-section-title">Today&apos;s activity</div>
                  {selectedEmp.clockedInAt ? (
                    <div className="ep-activity-row"><div className="ep-activity-dot" style={{ background: T.tealBright }} /><div className="ep-activity-label">Clocked in</div><div className="ep-activity-time">{fmt(selectedEmp.clockedInAt)}</div></div>
                  ) : (
                    <div className="ep-activity-row"><div className="ep-activity-dot" style={{ background: T.red }} /><div className="ep-activity-label" style={{ color: T.red }}>No clock-in recorded</div><div className="ep-activity-time">{selectedEmp.shiftHours}</div></div>
                  )}
                  {selectedEmp.flagged && (
                    <div className="ep-activity-row" style={{ borderColor: '#5a3d0a' }}><div className="ep-activity-dot" style={{ background: T.amber }} /><div className="ep-activity-label" style={{ color: T.amber }}>Face match flagged — manual review needed</div></div>
                  )}
                </div>

                <div className="ep-drawer-section">
                  <div className="ep-drawer-section-title">Reference photo</div>
                  <input ref={photoInput} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => uploadPhoto(selectedEmp, e.target.files?.[0] ?? null)} />
                  {selectedEmp.hasPhoto ? (
                    <div style={{ background: T.bgSubtle, border: `1px solid ${T.border}`, borderRadius: 10, height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, marginBottom: 12 }}>🧑</div>
                  ) : (
                    <div className="ep-photo-box" onClick={() => photoInput.current?.click()}>
                      <div className="ep-photo-box-icon">📷</div>
                      <div className="ep-photo-box-label">{busy ? 'Uploading…' : 'No reference photo — click to upload'}</div>
                    </div>
                  )}
                </div>

                <div className="ep-drawer-section">
                  <div className="ep-drawer-section-title">Actions</div>
                  <button className="ep-action-btn secondary" onClick={() => photoInput.current?.click()}>📷 {selectedEmp.hasPhoto ? 'Replace' : 'Upload'} reference photo</button>
                  {selectedEmp.active ? (
                    <button className="ep-action-btn danger" disabled={busy} onClick={() => deactivate(selectedEmp)}>⏸ Deactivate employee</button>
                  ) : (
                    <button className="ep-action-btn secondary" disabled={busy} onClick={() => reactivate(selectedEmp)} style={{ color: T.tealBright }}>▶ Reactivate employee</button>
                  )}
                </div>
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
.ep-root{font-family:'DM Sans',sans-serif;background:${T.bg};min-height:100vh;color:${T.white};display:flex;flex-direction:column}
.ep-topbar{background:${T.bgCard};border-bottom:1px solid ${T.border};display:flex;align-items:center;padding:0 28px;height:56px;gap:16px;position:sticky;top:0;z-index:100}
.ep-logo{font-family:'DM Mono',monospace;font-size:13px;color:${T.tealBright};letter-spacing:.06em;text-decoration:none}
.ep-divider{width:1px;height:20px;background:${T.border}}
.ep-topbar-title{font-family:'Syne',sans-serif;font-size:15px;font-weight:600;color:${T.whiteMid}}
.ep-topbar-right{margin-left:auto;display:flex;align-items:center;gap:12px}
.ep-search{display:flex;align-items:center;gap:8px;background:${T.bgSubtle};border:1px solid ${T.border};border-radius:8px;padding:7px 12px;width:240px;transition:border-color .15s}
.ep-search:focus-within{border-color:${T.teal}}
.ep-search input{background:none;border:none;outline:none;font-family:'DM Sans',sans-serif;font-size:13px;color:${T.white};width:100%}
.ep-search input::placeholder{color:${T.dimMid}}
.ep-btn{padding:8px 16px;border-radius:8px;border:none;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;transition:opacity .12s}
.ep-btn.primary{background:${T.tealMid};color:#fff}.ep-btn.primary:hover{opacity:.85}
.ep-btn.ghost{background:${T.bgSubtle};color:${T.whiteMid};border:1px solid ${T.border}}.ep-btn.ghost:hover{border-color:${T.teal};color:${T.tealBright}}
.ep-body{display:flex;flex:1;overflow:hidden}
.ep-sidebar-filters{width:220px;border-right:1px solid ${T.border};background:${T.bgCard};padding:20px 16px;flex-shrink:0;overflow-y:auto}
.ep-main{flex:1;padding:28px 32px;overflow-y:auto}
.ep-filter-group{margin-bottom:24px}
.ep-filter-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:${T.dimMid};margin-bottom:10px}
.ep-filter-item{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:7px;cursor:pointer;font-size:13px;color:${T.dim};transition:background .12s,color .12s;border:none;background:none;width:100%;text-align:left}
.ep-filter-item:hover{background:${T.bgHover};color:${T.whiteMid}}
.ep-filter-item.active{background:${T.tealFaint};color:${T.tealBright}}
.ep-filter-count{margin-left:auto;font-size:11px;font-family:'DM Mono',monospace;color:${T.dimMid}}
.ep-filter-item.active .ep-filter-count{color:${T.tealText}}
.ep-filter-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.ep-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
.ep-stat{background:${T.bgCard};border:1px solid ${T.border};border-radius:10px;padding:14px 18px}
.ep-stat-val{font-family:'Syne',sans-serif;font-size:26px;font-weight:700;line-height:1;margin-bottom:4px}
.ep-stat-label{font-size:11px;color:${T.dim};font-weight:500}
.ep-table-wrap{background:${T.bgCard};border:1px solid ${T.border};border-radius:12px;overflow:hidden}
.ep-table{width:100%;border-collapse:collapse;font-size:13px}
.ep-table thead tr{background:${T.bgSubtle}}
.ep-table thead th{padding:11px 16px;text-align:left;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${T.dim};white-space:nowrap;cursor:pointer;user-select:none;border-bottom:1px solid ${T.border}}
.ep-table thead th:hover{color:${T.tealText}}
.ep-table tbody tr{border-bottom:1px solid ${T.border};cursor:pointer;transition:background .1s}
.ep-table tbody tr:last-child{border-bottom:none}
.ep-table tbody tr:hover{background:${T.bgHover}}
.ep-table tbody tr.selected{background:${T.tealFaint}}
.ep-table td{padding:12px 16px;vertical-align:middle}
.ep-name-cell{display:flex;align-items:center;gap:10px}
.ep-avatar{width:30px;height:30px;border-radius:50%;background:${T.tealDark};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:${T.tealText};flex-shrink:0}
.ep-emp-name{font-weight:500;color:${T.white};font-size:13px}
.ep-emp-id{font-family:'DM Mono',monospace;font-size:10px;color:${T.dim}}
.ep-badge{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px;letter-spacing:.03em;text-transform:uppercase;white-space:nowrap}
.ep-badge.active{background:${T.greenBg};color:${T.green};border:1px solid #1a4030}
.ep-badge.absent{background:${T.redBg};color:${T.red};border:1px solid #3d1a1a}
.ep-badge.late{background:${T.amberBg};color:${T.amber};border:1px solid #5a3d0a}
.ep-badge.flagged{background:${T.amberBg};color:${T.amber};border:1px solid #5a3d0a}
.ep-badge.nophoto{background:${T.bgSubtle};color:${T.dim};border:1px solid ${T.border}}
.ep-mono{font-family:'DM Mono',monospace;font-size:12px;color:${T.dim}}
.ep-location-text{font-size:12px;color:${T.whiteMid};max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ep-pagination{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-top:1px solid ${T.border};font-size:12px;color:${T.dim}}
.ep-page-btns{display:flex;gap:4px}
.ep-page-btn{width:28px;height:28px;border-radius:6px;border:1px solid ${T.border};background:none;color:${T.dim};font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .12s}
.ep-page-btn:hover{border-color:${T.teal};color:${T.tealBright}}
.ep-page-btn.active{background:${T.tealMid};color:#fff;border-color:${T.tealMid}}
.ep-page-btn:disabled{opacity:.4;cursor:not-allowed}
.ep-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:200;display:flex;justify-content:flex-end;animation:fadeO .2s ease}
@keyframes fadeO{from{opacity:0}to{opacity:1}}
.ep-drawer{width:460px;background:${T.bgCard};border-left:1px solid ${T.borderMid};height:100vh;overflow-y:auto;display:flex;flex-direction:column;animation:slideD .25s cubic-bezier(.4,0,.2,1)}
@keyframes slideD{from{transform:translateX(40px);opacity:0}to{transform:none;opacity:1}}
.ep-drawer-header{padding:22px 24px 18px;border-bottom:1px solid ${T.border}}
.ep-drawer-top{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px}
.ep-drawer-avatar{width:56px;height:56px;border-radius:50%;background:${T.tealDark};display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:600;color:${T.tealText};border:2px solid ${T.tealMid}}
.ep-drawer-name{font-family:'Syne',sans-serif;font-size:20px;font-weight:600;color:${T.white};margin-bottom:3px}
.ep-drawer-id{font-family:'DM Mono',monospace;font-size:12px;color:${T.dim}}
.ep-close{background:none;border:1px solid ${T.border};color:${T.dim};font-size:16px;width:30px;height:30px;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .12s}
.ep-close:hover{color:${T.white};border-color:${T.borderMid}}
.ep-drawer-badges{display:flex;gap:6px;flex-wrap:wrap}
.ep-drawer-body{padding:22px 24px;flex:1}
.ep-drawer-section{margin-bottom:22px}
.ep-drawer-section-title{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:${T.dimMid};margin-bottom:12px}
.ep-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:4px}
.ep-detail-cell{background:${T.bgSubtle};border:1px solid ${T.border};border-radius:8px;padding:11px 14px}
.ep-detail-cell-label{font-size:10px;color:${T.dim};font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px}
.ep-detail-cell-val{font-size:13px;color:${T.white};font-weight:500}
.ep-detail-cell-val.mono{font-family:'DM Mono',monospace;font-size:12px}
.ep-activity-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:7px;background:${T.bgSubtle};border:1px solid ${T.border};margin-bottom:6px;font-size:12px}
.ep-activity-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.ep-activity-label{color:${T.whiteMid};flex:1}
.ep-activity-time{font-family:'DM Mono',monospace;color:${T.dim};font-size:11px}
.ep-photo-box{width:100%;height:140px;border-radius:10px;background:${T.bgSubtle};border:2px dashed ${T.border};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;margin-bottom:12px;cursor:pointer;transition:border-color .15s}
.ep-photo-box:hover{border-color:${T.tealMid}}
.ep-photo-box-icon{font-size:32px}
.ep-photo-box-label{font-size:12px;color:${T.dim}}
.ep-action-btn{width:100%;padding:11px;border-radius:8px;border:none;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:8px;transition:opacity .12s}
.ep-action-btn:hover{opacity:.85}
.ep-action-btn:disabled{opacity:.5;cursor:not-allowed}
.ep-action-btn.secondary{background:${T.bgSubtle};color:${T.whiteMid};border:1px solid ${T.border}}
.ep-action-btn.danger{background:${T.redBg};color:${T.red};border:1px solid #3d1a1a}
.ep-hours-bar{height:6px;border-radius:3px;background:${T.border};overflow:hidden;margin-top:6px}
.ep-hours-fill{height:100%;border-radius:3px;background:${T.tealMid};transition:width .4s}
`
