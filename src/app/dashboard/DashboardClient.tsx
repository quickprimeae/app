'use client'
// src/app/dashboard/DashboardClient.tsx
// Live ops dashboard. Initial data is rendered server-side; this component
// keeps it fresh via Supabase realtime (clock_events / alerts) with a poll
// fallback, and handles filtering, the detail panel, alert resolution, and
// sign-out.

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase'
import type { DashboardData, DashLocation } from '@/lib/dashboard'

const T = {
  bg: '#0a0f0d', bgCard: '#111815', bgHover: '#161e1a', bgSubtle: '#0f1712',
  border: '#1e2b24', borderMid: '#243329', tealDark: '#085041', teal: '#0F6E56',
  tealMid: '#1D9E75', tealBright: '#25D09A', tealText: '#5DCAA5', tealFaint: '#0d1f18',
  green: '#22c55e', greenBg: '#0d2018', amber: '#f59e0b', amberBg: '#1f1608',
  red: '#ef4444', redBg: '#1f0d0d', white: '#f0f7f4', whiteMid: '#c8ddd6',
  dim: '#6b8078', dimMid: '#4a6058',
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
function elapsed(iso: string | null) {
  if (!iso) return ''
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (s < 0) return ''
  if (s < 60) return `${s}m ago`
  return `${Math.floor(s / 60)}h ${s % 60}m ago`
}
function hm(t: string | null) {
  return t ? t.slice(0, 5) : '—'
}
function initials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
}

export default function DashboardClient({
  initialData,
  opsName,
}: {
  initialData: DashboardData
  opsName: string
}) {
  const router = useRouter()
  const [data, setData] = useState<DashboardData>(initialData)
  const [now, setNow] = useState<Date | null>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'noshow' | 'late' | 'flagged'>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/attendance', { cache: 'no-store' })
      if (res.ok) setData(await res.json())
    } catch {
      /* keep last good data */
    } finally {
      setRefreshing(false)
    }
  }, [])

  // Debounced refresh so a burst of realtime events triggers one fetch.
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(refresh, 600)
  }, [refresh])

  // Poll fallback + refresh on focus.
  useEffect(() => {
    const poll = setInterval(refresh, 15000)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(poll)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  // Realtime: refetch when clock events or alerts change. Best-effort —
  // depends on the tables being in the realtime publication + RLS allowing
  // the anon role to observe them; the poll above covers gaps.
  useEffect(() => {
    const supabase = createBrowserSupabaseClient()
    const channel = supabase
      .channel('dashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clock_events' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, scheduleRefresh)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [scheduleRefresh])

  async function resolveAlert(id: string) {
    // Optimistic removal.
    setData((d) => ({ ...d, alerts: d.alerts.filter((a) => a.id !== id) }))
    try {
      await fetch('/api/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alert_id: id }),
      })
    } finally {
      refresh()
    }
  }

  async function signOut() {
    await createBrowserSupabaseClient().auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  function changeFilter(f: typeof filter) {
    setFilter(f)
    setSelected(null) // clear the detail drawer when the filter changes
  }

  const { kpis, locations, alerts } = data
  const timeStr = now ? now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--'
  const dateStr = now ? now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : ''

  const filtered = locations.filter((loc) => {
    const matchFilter =
      filter === 'all' ? true
      : filter === 'active' ? loc.status === 'active'
      : filter === 'noshow' ? loc.status === 'noshow'
      : filter === 'late' ? loc.status === 'late'
      : filter === 'flagged' ? loc.pickers.some((p) => p.flagged)
      : true
    const q = search.toLowerCase()
    const matchSearch =
      !q ||
      loc.name.toLowerCase().includes(q) ||
      (loc.client ?? '').toLowerCase().includes(q) ||
      loc.pickers.some((p) => p.name.toLowerCase().includes(q))
    return matchFilter && matchSearch
  })

  const selectedLoc: DashLocation | null = selected ? locations.find((l) => l.id === selected) ?? null : null

  const NAV_OPS = [
    { id: 'dashboard', icon: '⬛', label: 'Live dashboard', href: '/dashboard', badge: kpis.noshow + kpis.late > 0 ? kpis.noshow + kpis.late : null, badgeType: 'red' },
    { id: 'employees', icon: '👥', label: 'Employees', href: '/dashboard/employees', badge: null, badgeType: 'red' },
    { id: 'locations', icon: '📍', label: 'Locations', href: '/dashboard/locations', badge: null, badgeType: 'red' },
    { id: 'alerts', icon: '🔔', label: 'All alerts', href: '/dashboard/alerts', badge: alerts.length || null, badgeType: 'amber' },
  ]
  const NAV_PAYROLL = [
    { id: 'hours', icon: '🕐', label: 'Hours & verification', href: '/dashboard/payroll/hours' },
    { id: 'invoices', icon: '🧾', label: 'Invoices', href: '/dashboard/invoices' },
    { id: 'payroll', icon: '💰', label: 'Payroll summary', href: '/dashboard/payroll' },
  ]
  const NAV_ADMIN = [
    { id: 'onboarding', icon: '➕', label: 'Add employees', href: '/dashboard/employees/new' },
  ]

  return (
    <>
      <style>{css}</style>
      <div className="db-root">
        {/* Topbar */}
        <header className="db-topbar">
          <div className="db-logo">QUICKPRIME</div>
          <div className="db-topbar-divider" />
          <div className="db-live-badge">
            <div className="db-live-dot" />
            Live
          </div>
          <div className="db-topbar-divider" />
          <div className="db-topbar-time">{dateStr} · {timeStr}</div>
          <div className="db-topbar-right">
            <div className="db-search">
              <span className="db-search-icon">🔍</span>
              <input
                placeholder="Search locations or employees…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setSelected(null) }}
              />
            </div>
            <div className="db-avatar" title={opsName}>{initials(opsName)}</div>
            <button className="db-btn-sm" onClick={signOut}>Sign out</button>
          </div>
        </header>

        {/* Sidebar */}
        <aside className="db-sidebar">
          <div className="db-nav-section">
            <div className="db-nav-label">Operations</div>
            {NAV_OPS.map((n) => (
              <Link key={n.id} href={n.href} className={`db-nav-item ${n.id === 'dashboard' ? 'active' : ''}`}>
                <span className="db-nav-icon">{n.icon}</span>
                {n.label}
                {n.badge && <span className={`db-nav-badge ${n.badgeType === 'amber' ? 'amber' : ''}`}>{n.badge}</span>}
              </Link>
            ))}
          </div>
          <div className="db-nav-section">
            <div className="db-nav-label">Payroll</div>
            {NAV_PAYROLL.map((n) => (
              <Link key={n.id} href={n.href} className="db-nav-item">
                <span className="db-nav-icon">{n.icon}</span>
                {n.label}
              </Link>
            ))}
          </div>
          <div className="db-nav-section">
            <div className="db-nav-label">Admin</div>
            {NAV_ADMIN.map((n) => (
              <Link key={n.id} href={n.href} className="db-nav-item">
                <span className="db-nav-icon">{n.icon}</span>
                {n.label}
              </Link>
            ))}
          </div>
        </aside>

        {/* Main */}
        <main className="db-main">
          <div className="db-kpi-row">
            <div className="db-kpi">
              <div className="db-kpi-label">Locations active</div>
              <div className="db-kpi-val green">{kpis.active}</div>
              <div className="db-kpi-sub">of {kpis.totalLocations} total sites</div>
            </div>
            <div className="db-kpi">
              <div className="db-kpi-label">Pickers clocked in</div>
              <div className="db-kpi-val green">{kpis.clockedIn}</div>
              <div className="db-kpi-sub">of {kpis.totalPickers} scheduled today</div>
            </div>
            <div className="db-kpi alert">
              <div className="db-kpi-label">No-shows</div>
              <div className="db-kpi-val red">{kpis.noshow}</div>
              <div className="db-kpi-sub">locations with 0 attendance</div>
            </div>
            <div className="db-kpi warn">
              <div className="db-kpi-label">Late / partial</div>
              <div className="db-kpi-val amber">{kpis.late}</div>
              <div className="db-kpi-sub">locations missing ≥1 picker</div>
            </div>
            <div className="db-kpi warn">
              <div className="db-kpi-label">Face match flags</div>
              <div className="db-kpi-val amber">{kpis.flagged}</div>
              <div className="db-kpi-sub">pending manual review</div>
            </div>
          </div>

          {alerts.length > 0 && (
            <>
              <div className="db-section-header">
                <div className="db-section-title">🔔 Active alerts</div>
              </div>
              <div className="db-alerts" style={{ marginBottom: 28 }}>
                <div className="db-alerts-header">
                  <div className="db-alerts-title">
                    <span style={{ color: T.red }}>●</span>
                    {alerts.filter((a) => a.type === 'red').length} critical &nbsp;
                    <span style={{ color: T.amber }}>●</span>
                    {alerts.filter((a) => a.type === 'amber').length} warnings
                  </div>
                  <Link href="/dashboard/alerts" className="db-btn-sm">View all</Link>
                </div>
                {alerts.map((a) => (
                  <div key={a.id} className="db-alert-row">
                    <div className={`db-alert-icon ${a.type}`}>{a.icon}</div>
                    <div className="db-alert-body">
                      <div className="db-alert-title">{a.title}</div>
                      <div className="db-alert-sub">{a.sub}</div>
                    </div>
                    <div className="db-alert-time">{a.time}</div>
                    <button className="db-alert-action" onClick={() => resolveAlert(a.id)}>Resolve</button>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="db-section-header">
            <div className="db-section-title">
              📍 All locations
              <span style={{ fontSize: 12, fontWeight: 400, color: T.dim, marginLeft: 6 }}>{filtered.length} shown</span>
            </div>
            <div className="db-section-actions">
              <button className="db-btn-sm" onClick={refresh} disabled={refreshing}>
                {refreshing ? '… Refreshing' : '🔄 Refresh'}
              </button>
            </div>
          </div>

          <div className="db-filters">
            {([
              { id: 'all', label: `All (${locations.length})`, dot: '#4a6058', cls: '' },
              { id: 'active', label: `Active (${kpis.active})`, dot: T.tealBright, cls: '' },
              { id: 'noshow', label: `No-show (${kpis.noshow})`, dot: T.red, cls: 'red-f' },
              { id: 'late', label: `Late / partial (${kpis.late})`, dot: T.amber, cls: 'amber-f' },
              { id: 'flagged', label: `Flagged (${kpis.flagged})`, dot: T.amber, cls: 'amber-f' },
            ] as const).map((f) => (
              <button
                key={f.id}
                className={`db-filter ${filter === f.id ? 'active' : ''} ${filter === f.id ? f.cls : ''}`}
                onClick={() => changeFilter(f.id)}
              >
                <div className="db-filter-dot" style={{ background: filter === f.id ? f.dot : T.dimMid }} />
                {f.label}
              </button>
            ))}
          </div>

          {locations.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: T.dim, fontSize: 14 }}>
              No active locations yet. Add locations and assign pickers to see live attendance here.
            </div>
          )}
          {locations.length > 0 && filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: T.dim, fontSize: 14 }}>
              No locations match your filter or search.
            </div>
          )}

          <div className="db-grid">
            {filtered.map((loc, idx) => (
              <div
                key={loc.id}
                className={`db-loc-card status-${loc.status} ${selected === loc.id ? 'selected' : ''}`}
                style={{ animationDelay: `${idx * 0.03}s` }}
                onClick={() => setSelected(selected === loc.id ? null : loc.id)}
              >
                <div className="db-loc-top">
                  <div>
                    <div className="db-loc-name">{loc.name}</div>
                    <div className="db-loc-client">{loc.client}</div>
                  </div>
                  <div className={`db-loc-status ${loc.status}`}>
                    {loc.status === 'active' && <><span style={{ width: 5, height: 5, borderRadius: '50%', background: T.green, display: 'inline-block' }} /> Active</>}
                    {loc.status === 'noshow' && '🚨 No-show'}
                    {loc.status === 'late' && '⚠ Late'}
                    {loc.status === 'noshift' && 'No shift'}
                  </div>
                </div>

                <div className="db-loc-pickers">
                  {loc.pickers.map((p, j) => {
                    const cls = p.flagged ? 'flagged' : p.status
                    return (
                      <div key={j} className={`db-picker-chip ${cls}`}>
                        <div className={`db-chip-dot ${cls}`} />
                        {p.name.split(' ')[0]}
                        {p.flagged && ' ⚠'}
                      </div>
                    )
                  })}
                  {loc.pickers.length === 0 && <span style={{ fontSize: 11, color: T.dimMid }}>No pickers assigned</span>}
                </div>

                <div className="db-loc-footer">
                  <div className="db-loc-footer-stat">
                    <div className="db-loc-progress">
                      {Array.from({ length: loc.total }).map((_, j) => (
                        <div key={j} className={`db-loc-pip ${j < loc.clockedIn ? 'filled' : 'empty'}`} />
                      ))}
                    </div>
                    <span style={{ marginLeft: 4 }}>{loc.clockedIn}/{loc.total} in</span>
                  </div>
                  <div>Shift: {hm(loc.shiftStart)} – {hm(loc.shiftEnd)}</div>
                </div>
              </div>
            ))}
          </div>
        </main>

        {/* Detail panel */}
        {selectedLoc && (
          <div className="db-detail-overlay" onClick={() => setSelected(null)}>
            <div className="db-detail-panel" onClick={(e) => e.stopPropagation()}>
              <div className="db-detail-top">
                <div>
                  <div className="db-detail-location">{selectedLoc.name}</div>
                  <div className="db-detail-meta">
                    <span>{selectedLoc.client}</span>
                    {selectedLoc.supervisor && (<><span>·</span><span>{selectedLoc.supervisor}</span></>)}
                  </div>
                </div>
                <button className="db-close-btn" onClick={() => setSelected(null)}>✕</button>
              </div>

              <div className="db-detail-body">
                <div className="db-detail-stat-row">
                  <div className="db-detail-stat">
                    <div className="db-detail-stat-label">Clocked in</div>
                    <div className="db-detail-stat-val" style={{ color: selectedLoc.clockedIn === selectedLoc.total && selectedLoc.total > 0 ? T.tealBright : T.amber }}>
                      {selectedLoc.clockedIn}/{selectedLoc.total}
                    </div>
                  </div>
                  <div className="db-detail-stat">
                    <div className="db-detail-stat-label">Shift</div>
                    <div className="db-detail-stat-val">{hm(selectedLoc.shiftStart)}–{hm(selectedLoc.shiftEnd)}</div>
                  </div>
                  <div className="db-detail-stat">
                    <div className="db-detail-stat-label">Supervisor</div>
                    <div className="db-detail-stat-val" style={{ fontSize: 13 }}>{selectedLoc.supervisor ?? '—'}</div>
                  </div>
                  <div className="db-detail-stat">
                    <div className="db-detail-stat-label">Status</div>
                    <div className="db-detail-stat-val" style={{ fontSize: 13, color: selectedLoc.status === 'noshow' ? T.red : selectedLoc.status === 'late' ? T.amber : T.tealBright }}>
                      {selectedLoc.status === 'active' ? 'Active' : selectedLoc.status === 'noshow' ? 'No-show' : selectedLoc.status === 'late' ? 'Late' : 'No shift'}
                    </div>
                  </div>
                </div>

                <div className="db-detail-section">
                  <div className="db-detail-section-title">Pickers</div>
                  {selectedLoc.pickers.length === 0 && <div style={{ color: T.dimMid, fontSize: 13 }}>No pickers assigned to this location.</div>}
                  {selectedLoc.pickers.map((p, i) => {
                    const badge = p.flagged ? 'flagged' : p.status
                    return (
                      <div key={i} className="db-picker-row">
                        <div className="db-picker-avatar">{initials(p.name)}</div>
                        <div className="db-picker-info">
                          <div className="db-picker-name">{p.name}</div>
                          <div className="db-picker-id">{p.id}</div>
                        </div>
                        {p.status === 'in' && !p.flagged && (
                          <div className="db-picker-time">
                            <div className="db-picker-time-val">{fmt(p.clockedInAt)}</div>
                            <div className="db-picker-time-label">{elapsed(p.clockedInAt)}</div>
                          </div>
                        )}
                        <div className={`db-picker-status-badge ${badge}`}>
                          {p.flagged ? '⚠ flagged' : p.status === 'in' ? '✓ in' : p.status === 'absent' ? '✗ absent' : 'expected'}
                        </div>
                      </div>
                    )
                  })}
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
*, *::before, *::after { box-sizing: border-box; }
.db-root { font-family: 'DM Sans', sans-serif; background: ${T.bg}; min-height: 100vh; color: ${T.white}; display: grid; grid-template-columns: 220px 1fr; grid-template-rows: auto 1fr; }
.db-topbar { grid-column: 1 / -1; background: ${T.bgCard}; border-bottom: 1px solid ${T.border}; display: flex; align-items: center; padding: 0 24px; height: 56px; gap: 20px; position: sticky; top: 0; z-index: 100; }
.db-logo { font-family: 'DM Mono', monospace; font-size: 13px; font-weight: 500; color: ${T.tealBright}; letter-spacing: 0.06em; margin-right: 8px; }
.db-topbar-divider { width: 1px; height: 20px; background: ${T.border}; }
.db-live-badge { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: ${T.tealBright}; letter-spacing: 0.06em; text-transform: uppercase; }
.db-live-dot { width: 7px; height: 7px; border-radius: 50%; background: ${T.tealBright}; animation: livePulse 2s infinite; }
@keyframes livePulse { 0%,100% { opacity: 1; box-shadow: 0 0 0 0 rgba(37,208,154,0.4); } 50% { opacity: 0.6; box-shadow: 0 0 0 5px rgba(37,208,154,0); } }
.db-topbar-time { font-family: 'DM Mono', monospace; font-size: 13px; color: ${T.dim}; }
.db-topbar-right { margin-left: auto; display: flex; align-items: center; gap: 14px; }
.db-search { display: flex; align-items: center; gap: 8px; background: ${T.bgSubtle}; border: 1px solid ${T.border}; border-radius: 8px; padding: 7px 12px; width: 220px; transition: border-color 0.15s; }
.db-search:focus-within { border-color: ${T.teal}; }
.db-search-icon { font-size: 13px; color: ${T.dim}; }
.db-search input { background: none; border: none; outline: none; font-family: 'DM Sans', sans-serif; font-size: 13px; color: ${T.white}; width: 100%; }
.db-search input::placeholder { color: ${T.dimMid}; }
.db-avatar { width: 32px; height: 32px; border-radius: 50%; background: ${T.teal}; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; color: #fff; }
.db-sidebar { background: ${T.bgCard}; border-right: 1px solid ${T.border}; padding: 20px 0; display: flex; flex-direction: column; position: sticky; top: 56px; height: calc(100vh - 56px); overflow-y: auto; }
.db-nav-section { padding: 0 12px; margin-bottom: 28px; }
.db-nav-label { font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: ${T.dimMid}; padding: 0 8px; margin-bottom: 6px; }
.db-nav-item { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 500; color: ${T.dim}; transition: background 0.12s, color 0.12s; border: none; background: none; width: 100%; text-align: left; text-decoration: none; }
.db-nav-item:hover { background: ${T.bgHover}; color: ${T.whiteMid}; }
.db-nav-item.active { background: ${T.tealFaint}; color: ${T.tealBright}; }
.db-nav-icon { font-size: 15px; width: 18px; text-align: center; flex-shrink: 0; }
.db-nav-badge { margin-left: auto; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 10px; background: ${T.red}; color: #fff; }
.db-nav-badge.amber { background: ${T.amber}; color: #000; }
.db-main { padding: 28px 32px; overflow-y: auto; }
.db-kpi-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 28px; }
.db-kpi { background: ${T.bgCard}; border: 1px solid ${T.border}; border-radius: 12px; padding: 18px 20px; transition: border-color 0.15s; }
.db-kpi:hover { border-color: ${T.borderMid}; }
.db-kpi.alert { border-color: #3d1a1a; background: #0f0808; }
.db-kpi.warn { border-color: #3d2e0a; background: #0f0c04; }
.db-kpi-label { font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: ${T.dim}; margin-bottom: 10px; }
.db-kpi-val { font-family: 'Syne', sans-serif; font-size: 32px; font-weight: 700; line-height: 1; margin-bottom: 6px; }
.db-kpi-val.green { color: ${T.tealBright}; }
.db-kpi-val.amber { color: ${T.amber}; }
.db-kpi-val.red { color: ${T.red}; }
.db-kpi-sub { font-size: 11px; color: ${T.dim}; }
.db-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; gap: 12px; }
.db-section-title { font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 600; color: ${T.whiteMid}; display: flex; align-items: center; gap: 8px; }
.db-section-actions { display: flex; gap: 8px; align-items: center; }
.db-filters { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
.db-filter { display: flex; align-items: center; gap: 5px; padding: 5px 11px; border-radius: 20px; border: 1px solid ${T.border}; background: none; font-family: 'DM Sans', sans-serif; font-size: 11px; font-weight: 600; color: ${T.dim}; cursor: pointer; transition: all 0.12s; letter-spacing: 0.02em; }
.db-filter:hover { border-color: ${T.teal}; color: ${T.tealText}; }
.db-filter.active { background: ${T.tealFaint}; border-color: ${T.teal}; color: ${T.tealBright}; }
.db-filter.active.red-f { background: ${T.redBg}; border-color: #5a1a1a; color: ${T.red}; }
.db-filter.active.amber-f { background: ${T.amberBg}; border-color: #5a3d0a; color: ${T.amber}; }
.db-filter-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.db-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; margin-bottom: 32px; }
.db-loc-card { background: ${T.bgCard}; border: 1px solid ${T.border}; border-radius: 12px; padding: 16px 18px; cursor: pointer; transition: border-color 0.15s, background 0.15s; animation: fadeIn 0.3s ease both; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.db-loc-card:hover { border-color: ${T.borderMid}; background: ${T.bgHover}; }
.db-loc-card.status-noshow { border-color: #3d1a1a; background: #0b0808; }
.db-loc-card.status-late { border-color: #3d2e0a; background: #0b0904; }
.db-loc-card.selected { border-color: ${T.tealMid}; background: ${T.tealFaint}; }
.db-loc-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 10px; }
.db-loc-name { font-size: 13px; font-weight: 600; color: ${T.white}; line-height: 1.3; max-width: 180px; }
.db-loc-client { font-size: 10px; color: ${T.dim}; margin-top: 2px; }
.db-loc-status { display: flex; align-items: center; gap: 5px; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 10px; letter-spacing: 0.04em; text-transform: uppercase; flex-shrink: 0; }
.db-loc-status.active { background: ${T.greenBg}; color: ${T.green}; border: 1px solid #1a4030; }
.db-loc-status.noshow { background: ${T.redBg}; color: ${T.red}; border: 1px solid #3d1a1a; }
.db-loc-status.late { background: ${T.amberBg}; color: ${T.amber}; border: 1px solid #5a3d0a; }
.db-loc-status.noshift { background: ${T.bgSubtle}; color: ${T.dimMid}; border: 1px solid ${T.border}; }
.db-loc-pickers { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
.db-picker-chip { display: flex; align-items: center; gap: 5px; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 500; border: 1px solid transparent; }
.db-picker-chip.in { background: #0a1f14; color: ${T.tealText}; border-color: #1a3a28; }
.db-picker-chip.absent { background: ${T.redBg}; color: ${T.red}; border-color: #3d1a1a; }
.db-picker-chip.expected { background: ${T.bgSubtle}; color: ${T.dimMid}; border-color: ${T.border}; }
.db-picker-chip.flagged { background: #1f1608; color: ${T.amber}; border-color: #5a3d0a; }
.db-chip-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
.db-chip-dot.in { background: ${T.tealBright}; }
.db-chip-dot.absent { background: ${T.red}; }
.db-chip-dot.expected { background: ${T.dimMid}; }
.db-chip-dot.flagged { background: ${T.amber}; }
.db-loc-footer { display: flex; justify-content: space-between; align-items: center; padding-top: 10px; border-top: 1px solid ${T.border}; font-size: 11px; color: ${T.dim}; }
.db-loc-footer-stat { display: flex; align-items: center; gap: 5px; }
.db-loc-progress { display: flex; gap: 3px; align-items: center; }
.db-loc-pip { width: 14px; height: 5px; border-radius: 2px; }
.db-loc-pip.filled { background: ${T.tealMid}; }
.db-loc-pip.empty { background: ${T.border}; }
.db-alerts { background: ${T.bgCard}; border: 1px solid ${T.border}; border-radius: 12px; overflow: hidden; margin-bottom: 28px; }
.db-alerts-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid ${T.border}; }
.db-alerts-title { font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 600; color: ${T.whiteMid}; display: flex; align-items: center; gap: 8px; }
.db-alert-row { display: flex; align-items: center; gap: 14px; padding: 12px 18px; border-bottom: 1px solid ${T.border}; transition: background 0.1s; }
.db-alert-row:last-child { border-bottom: none; }
.db-alert-row:hover { background: ${T.bgHover}; }
.db-alert-icon { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0; }
.db-alert-icon.red { background: ${T.redBg}; }
.db-alert-icon.amber { background: ${T.amberBg}; }
.db-alert-body { flex: 1; }
.db-alert-title { font-size: 13px; font-weight: 500; color: ${T.white}; margin-bottom: 2px; }
.db-alert-sub { font-size: 11px; color: ${T.dim}; }
.db-alert-time { font-family: 'DM Mono', monospace; font-size: 11px; color: ${T.dimMid}; flex-shrink: 0; }
.db-alert-action { padding: 5px 10px; border-radius: 6px; border: 1px solid ${T.border}; background: none; font-family: 'DM Sans', sans-serif; font-size: 11px; font-weight: 600; color: ${T.whiteMid}; cursor: pointer; transition: border-color 0.12s, color 0.12s; flex-shrink: 0; }
.db-alert-action:hover { border-color: ${T.tealMid}; color: ${T.tealBright}; }
.db-detail-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 200; display: flex; justify-content: flex-end; animation: fadeOverlay 0.2s ease; }
@keyframes fadeOverlay { from { opacity: 0; } to { opacity: 1; } }
.db-detail-panel { width: 420px; background: ${T.bgCard}; border-left: 1px solid ${T.borderMid}; height: 100vh; overflow-y: auto; display: flex; flex-direction: column; animation: slidePanel 0.25s cubic-bezier(0.4,0,0.2,1); }
@keyframes slidePanel { from { transform: translateX(40px); opacity: 0; } to { transform: none; opacity: 1; } }
.db-detail-top { padding: 20px 22px 16px; border-bottom: 1px solid ${T.border}; display: flex; align-items: flex-start; justify-content: space-between; }
.db-detail-location { font-family: 'Syne', sans-serif; font-size: 17px; font-weight: 600; color: ${T.white}; margin-bottom: 4px; }
.db-detail-meta { font-size: 12px; color: ${T.dim}; display: flex; gap: 10px; }
.db-close-btn { background: none; border: 1px solid ${T.border}; color: ${T.dim}; font-size: 16px; width: 30px; height: 30px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: color 0.12s, border-color 0.12s; }
.db-close-btn:hover { color: ${T.white}; border-color: ${T.borderMid}; }
.db-detail-body { padding: 20px 22px; flex: 1; }
.db-detail-section { margin-bottom: 24px; }
.db-detail-section-title { font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: ${T.dimMid}; margin-bottom: 12px; }
.db-picker-row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 8px; margin-bottom: 6px; background: ${T.bgSubtle}; border: 1px solid ${T.border}; }
.db-picker-avatar { width: 32px; height: 32px; border-radius: 50%; background: ${T.tealDark}; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; color: ${T.tealText}; flex-shrink: 0; }
.db-picker-info { flex: 1; }
.db-picker-name { font-size: 13px; font-weight: 500; color: ${T.white}; }
.db-picker-id { font-family: 'DM Mono', monospace; font-size: 10px; color: ${T.dim}; }
.db-picker-time { text-align: right; }
.db-picker-time-val { font-family: 'DM Mono', monospace; font-size: 12px; color: ${T.tealText}; }
.db-picker-time-label { font-size: 10px; color: ${T.dim}; }
.db-picker-status-badge { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 10px; letter-spacing: 0.04em; text-transform: uppercase; }
.db-picker-status-badge.in { background: ${T.greenBg}; color: ${T.green}; }
.db-picker-status-badge.absent { background: ${T.redBg}; color: ${T.red}; }
.db-picker-status-badge.expected { background: ${T.bgSubtle}; color: ${T.dimMid}; }
.db-picker-status-badge.flagged { background: ${T.amberBg}; color: ${T.amber}; }
.db-detail-stat-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
.db-detail-stat { background: ${T.bgSubtle}; border: 1px solid ${T.border}; border-radius: 8px; padding: 12px 14px; }
.db-detail-stat-label { font-size: 10px; color: ${T.dim}; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 4px; }
.db-detail-stat-val { font-family: 'DM Mono', monospace; font-size: 16px; font-weight: 500; color: ${T.white}; }
.db-btn-sm { padding: 6px 12px; border-radius: 7px; border: 1px solid ${T.border}; background: none; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 500; color: ${T.dim}; cursor: pointer; transition: color 0.12s, border-color 0.12s; display: flex; align-items: center; gap: 6px; text-decoration: none; }
.db-btn-sm:hover { color: ${T.tealBright}; border-color: ${T.teal}; }
.db-btn-sm:disabled { opacity: 0.5; cursor: not-allowed; }
`
