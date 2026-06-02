'use client'
// src/app/dashboard/alerts/AlertsClient.tsx
// Alerts triage: type filter, critical/warning sections, expand to add a
// resolution note and resolve (PATCH /api/alerts). relTime computes "now" on
// each call (bug #2 fix — no stale module-level Date).

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const T = {
  bg: '#0a0f0d', bgCard: '#111815', bgHover: '#161e1a', bgSubtle: '#0f1712',
  border: '#1e2b24', borderMid: '#243329', teal: '#0F6E56', tealMid: '#1D9E75',
  tealBright: '#25D09A', tealText: '#5DCAA5', tealFaint: '#0d1f18',
  green: '#22c55e', greenBg: '#0d2018', amber: '#f59e0b', amberBg: '#1f1608',
  red: '#ef4444', redBg: '#1f0d0d', purple: '#a78bfa', purpleBg: '#160f2a',
  white: '#f0f7f4', whiteMid: '#c8ddd6', dim: '#6b8078', dimMid: '#4a6058',
}

export type AlertItem = {
  id: string
  type: 'noshow' | 'late' | 'faceflag' | 'clockout' | 'system'
  severity: 'critical' | 'warning'
  title: string
  body: string
  locationName: string
  employeeName: string
  empId: string
  client: string
  createdAt: string
  resolved: boolean
  resolvedAt: string | null
  resolvedByName: string | null
  resolutionNote: string
}

const TYPE_META: Record<string, { icon: string; color: string; bg: string; border: string }> = {
  noshow: { icon: '🚨', color: T.red, bg: T.redBg, border: '#5a1a1a' },
  late: { icon: '⏱', color: T.amber, bg: T.amberBg, border: '#5a3d0a' },
  faceflag: { icon: '🔍', color: T.amber, bg: T.amberBg, border: '#5a3d0a' },
  clockout: { icon: '⏹', color: T.purple, bg: T.purpleBg, border: '#3a2060' },
  system: { icon: '⚙️', color: T.dim, bg: T.bgSubtle, border: T.border },
}

// "now" is read on every call so relative times never go stale (bug #2).
function relTime(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diff < 1) return 'just now'
  if (diff < 60) return `${diff}m ago`
  const h = Math.floor(diff / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

type TypeFilter = 'all' | 'noshow' | 'late' | 'faceflag' | 'clockout'

export default function AlertsClient({ initial }: { initial: AlertItem[] }) {
  const router = useRouter()
  const alerts = initial
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [showResolved, setShowResolved] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const filtered = useMemo(() => {
    let d = alerts
    if (!showResolved) d = d.filter((a) => !a.resolved)
    if (typeFilter !== 'all') d = d.filter((a) => a.type === typeFilter)
    return [...d].sort((a, b) => Number(a.resolved) - Number(b.resolved) || +new Date(b.createdAt) - +new Date(a.createdAt))
  }, [alerts, typeFilter, showResolved])

  async function resolve(id: string) {
    setBusy(true)
    try {
      await fetch('/api/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alert_id: id, resolution_note: notes[id] || null }),
      })
      setExpanded(null)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const unresolved = alerts.filter((a) => !a.resolved)
  const critical = unresolved.filter((a) => a.severity === 'critical')
  const warnings = unresolved.filter((a) => a.severity === 'warning')
  const resolvedToday = alerts.filter((a) => a.resolved)

  const typeCounts: Record<string, number> = {}
  unresolved.forEach((a) => { typeCounts[a.type] = (typeCounts[a.type] || 0) + 1 })

  const visibleCritical = filtered.filter((a) => a.severity === 'critical' && !a.resolved)
  const visibleWarnings = filtered.filter((a) => a.severity === 'warning' && !a.resolved)
  const visibleResolved = filtered.filter((a) => a.resolved)

  return (
    <>
      <style>{css}</style>
      <div className="al-root">
        <header className="al-topbar">
          <Link href="/dashboard" className="al-logo">QUICKPRIME</Link>
          <div className="al-divider" />
          <div className="al-topbar-title">Alerts</div>
          <div className="al-live"><div className="al-live-dot" />Live</div>
          <div className="al-topbar-right">
            <button className="al-btn ghost" onClick={() => setShowResolved((s) => !s)}>{showResolved ? 'Hide resolved' : 'Show resolved'}</button>
          </div>
        </header>

        <div className="al-body">
          <aside className="al-sidebar">
            <div className="al-s-group">
              <div className="al-s-title">Filter by type</div>
              {([
                { id: 'all', label: 'All active', icon: '🔔' },
                { id: 'noshow', label: 'No-shows', icon: '🚨' },
                { id: 'late', label: 'Late / partial', icon: '⏱' },
                { id: 'faceflag', label: 'Face flagged', icon: '🔍' },
                { id: 'clockout', label: 'Missed clock-out', icon: '⏹' },
              ] as const).map((f) => {
                const cnt = f.id === 'all' ? unresolved.length : typeCounts[f.id] || 0
                return (
                  <button key={f.id} className={`al-s-item ${typeFilter === f.id ? 'active' : ''}`} onClick={() => setTypeFilter(f.id)}>
                    <span>{f.icon}</span>{f.label}
                    <span className={`al-s-count ${f.id === 'noshow' && cnt ? 'red' : f.id !== 'all' && cnt ? 'amber' : ''}`}>{cnt}</span>
                  </button>
                )
              })}
            </div>
            <div className="al-s-group">
              <div className="al-s-title">Today&apos;s summary</div>
              <div style={{ padding: '0 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { label: 'Total fired', val: alerts.length, col: T.white },
                  { label: 'Resolved', val: resolvedToday.length, col: T.green },
                  { label: 'Open', val: unresolved.length, col: unresolved.length ? T.red : T.green },
                  { label: 'Critical', val: critical.length, col: critical.length ? T.red : T.green },
                ].map((s) => (
                  <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', borderBottom: `1px solid ${T.border}` }}>
                    <span style={{ color: T.dim }}>{s.label}</span>
                    <span style={{ color: s.col, fontFamily: 'DM Mono', fontWeight: 600 }}>{s.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          <main className="al-main">
            <div className="al-stat-row">
              <div className="al-stat"><div className="al-stat-val" style={{ color: T.red }}>{critical.length}</div><div className="al-stat-label">Critical — needs action</div></div>
              <div className="al-stat"><div className="al-stat-val" style={{ color: T.amber }}>{warnings.length}</div><div className="al-stat-label">Warnings open</div></div>
              <div className="al-stat"><div className="al-stat-val" style={{ color: T.green }}>{resolvedToday.length}</div><div className="al-stat-label">Resolved</div></div>
              <div className="al-stat"><div className="al-stat-val" style={{ color: T.white }}>{alerts.length}</div><div className="al-stat-label">Total fired</div></div>
            </div>

            {visibleCritical.length > 0 && (
              <>
                <div className="al-section-title">🚨 Critical <span>— requires immediate action</span></div>
                {visibleCritical.map((a, i) => (
                  <AlertCard key={a.id} alert={a} isExpanded={expanded === a.id} busy={busy} onToggle={() => setExpanded(expanded === a.id ? null : a.id)} onResolve={() => resolve(a.id)} note={notes[a.id] || ''} onNoteChange={(v) => setNotes((n) => ({ ...n, [a.id]: v }))} delay={i * 0.05} />
                ))}
              </>
            )}

            {visibleWarnings.length > 0 && (
              <>
                <div className="al-section-title" style={{ marginTop: 24 }}>⚠️ Warnings <span>— monitor and action if needed</span></div>
                {visibleWarnings.map((a, i) => (
                  <AlertCard key={a.id} alert={a} isExpanded={expanded === a.id} busy={busy} onToggle={() => setExpanded(expanded === a.id ? null : a.id)} onResolve={() => resolve(a.id)} note={notes[a.id] || ''} onNoteChange={(v) => setNotes((n) => ({ ...n, [a.id]: v }))} delay={i * 0.05} />
                ))}
              </>
            )}

            {showResolved && visibleResolved.length > 0 && (
              <>
                <div className="al-section-title" style={{ marginTop: 24 }}>✓ Resolved</div>
                {visibleResolved.map((a, i) => (
                  <AlertCard key={a.id} alert={a} isExpanded={false} busy={busy} onToggle={() => {}} onResolve={() => {}} note="" onNoteChange={() => {}} delay={i * 0.04} />
                ))}
              </>
            )}

            {visibleCritical.length === 0 && visibleWarnings.length === 0 && !showResolved && (
              <div style={{ textAlign: 'center', padding: '80px 0', color: T.dim }}>
                <div style={{ fontSize: 36, marginBottom: 16 }}>✅</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: T.whiteMid, marginBottom: 6 }}>All clear</div>
                <div style={{ fontSize: 13 }}>No open alerts. You&apos;re on top of it.</div>
              </div>
            )}
          </main>
        </div>
      </div>
    </>
  )
}

function AlertCard({ alert, isExpanded, busy, onToggle, onResolve, note, onNoteChange, delay }: {
  alert: AlertItem
  isExpanded: boolean
  busy: boolean
  onToggle: () => void
  onResolve: () => void
  note: string
  onNoteChange: (v: string) => void
  delay: number
}) {
  const meta = TYPE_META[alert.type] || TYPE_META.system
  return (
    <div className={`al-card ${alert.resolved ? 'resolved' : ''}`} style={{ animationDelay: `${delay}s`, borderColor: isExpanded && !alert.resolved ? meta.border : undefined }}>
      <div className="al-card-main" onClick={onToggle}>
        <div className="al-card-icon" style={{ background: meta.bg, borderColor: meta.border }}>{meta.icon}</div>
        <div className="al-card-body">
          <div className="al-card-title">{alert.title}</div>
          <div className="al-card-sub">{alert.body}</div>
          <div className="al-card-tags">
            <div className="al-tag">📍 {alert.locationName.split(' — ')[0]}</div>
            {alert.employeeName !== '—' && <div className="al-tag">👤 {alert.employeeName}</div>}
            {alert.empId && <div className="al-tag" style={{ fontFamily: 'monospace' }}>{alert.empId}</div>}
            {alert.client && <div className="al-tag">{alert.client}</div>}
          </div>
          {alert.resolved && alert.resolutionNote && (
            <div className="al-resolve-note" style={{ marginTop: 8 }}><strong>Resolved{alert.resolvedByName ? ` by ${alert.resolvedByName}` : ''}</strong>: {alert.resolutionNote}</div>
          )}
        </div>
        <div className="al-card-right">
          <div className="al-card-time">{fmtDate(alert.createdAt)} · {fmtTime(alert.createdAt)}<br /><span style={{ color: T.dimMid }}>{relTime(alert.createdAt)}</span></div>
          <div className={`al-sev-badge ${alert.resolved ? 'resolved-b' : alert.severity}`}>{alert.resolved ? '✓ Resolved' : alert.severity}</div>
        </div>
      </div>

      {isExpanded && !alert.resolved && (
        <div className="al-card-expanded">
          <div className="al-expand-col">
            <div className="al-expand-label">Resolution notes</div>
            <textarea className="al-notes-input" placeholder="Add notes about how this was handled…" value={note} onChange={(e) => onNoteChange(e.target.value)} onClick={(e) => e.stopPropagation()} />
          </div>
          <div className="al-expand-actions">
            <div className="al-expand-label">Actions</div>
            <button className="al-action-btn primary" disabled={busy} onClick={(e) => { e.stopPropagation(); onResolve() }}>✓ Mark as resolved</button>
          </div>
        </div>
      )}
    </div>
  )
}

const css = `
*,*::before,*::after{box-sizing:border-box}
.al-root{font-family:'DM Sans',sans-serif;background:${T.bg};min-height:100vh;color:${T.white};display:flex;flex-direction:column}
.al-topbar{background:${T.bgCard};border-bottom:1px solid ${T.border};display:flex;align-items:center;padding:0 28px;height:56px;gap:16px;position:sticky;top:0;z-index:100}
.al-logo{font-family:'DM Mono',monospace;font-size:13px;color:${T.tealBright};letter-spacing:.06em;text-decoration:none}
.al-divider{width:1px;height:20px;background:${T.border}}
.al-topbar-title{font-family:'Syne',sans-serif;font-size:15px;font-weight:600;color:${T.whiteMid}}
.al-live{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:${T.tealBright};letter-spacing:.06em;text-transform:uppercase}
.al-live-dot{width:7px;height:7px;border-radius:50%;background:${T.tealBright};animation:lp 2s infinite}
@keyframes lp{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(37,208,154,.4)}50%{opacity:.6;box-shadow:0 0 0 5px rgba(37,208,154,0)}}
.al-topbar-right{margin-left:auto;display:flex;align-items:center;gap:10px}
.al-btn{padding:7px 14px;border-radius:7px;border:none;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:5px;transition:opacity .12s}
.al-btn.ghost{background:${T.bgSubtle};color:${T.whiteMid};border:1px solid ${T.border}}.al-btn.ghost:hover{border-color:${T.teal};color:${T.tealBright}}
.al-body{display:flex;flex:1;overflow:hidden;height:calc(100vh - 56px)}
.al-sidebar{width:240px;flex-shrink:0;border-right:1px solid ${T.border};background:${T.bgCard};padding:20px 14px;overflow-y:auto}
.al-main{flex:1;padding:24px 32px;overflow-y:auto}
.al-s-title{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:${T.dimMid};margin-bottom:10px}
.al-s-group{margin-bottom:24px}
.al-s-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13px;color:${T.dim};transition:background .12s,color .12s;border:none;background:none;width:100%;text-align:left}
.al-s-item:hover{background:${T.bgHover};color:${T.whiteMid}}
.al-s-item.active{background:${T.tealFaint};color:${T.tealBright}}
.al-s-count{margin-left:auto;font-size:11px;font-family:'DM Mono',monospace;background:${T.bgSubtle};padding:1px 7px;border-radius:8px;color:${T.dim}}
.al-s-item.active .al-s-count{background:rgba(37,208,154,.15);color:${T.tealBright}}
.al-s-count.red{background:${T.redBg};color:${T.red}}
.al-s-count.amber{background:${T.amberBg};color:${T.amber}}
.al-stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
.al-stat{background:${T.bgCard};border:1px solid ${T.border};border-radius:10px;padding:14px 18px}
.al-stat-val{font-family:'Syne',sans-serif;font-size:26px;font-weight:700;line-height:1;margin-bottom:4px}
.al-stat-label{font-size:11px;color:${T.dim};font-weight:500}
.al-section-title{font-family:'Syne',sans-serif;font-size:13px;font-weight:600;color:${T.whiteMid};margin-bottom:12px;display:flex;align-items:center;gap:8px}
.al-section-title span{font-size:11px;font-weight:400;color:${T.dim}}
.al-card{background:${T.bgCard};border:1px solid ${T.border};border-radius:12px;margin-bottom:10px;overflow:hidden;transition:border-color .15s;cursor:pointer;animation:fadeIn .25s ease both}
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.al-card:hover{border-color:${T.borderMid}}
.al-card.resolved{opacity:.55}
.al-card-main{display:flex;align-items:flex-start;gap:14px;padding:16px 18px}
.al-card-icon{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;border:1px solid transparent}
.al-card-body{flex:1;min-width:0}
.al-card-title{font-size:14px;font-weight:600;color:${T.white};margin-bottom:3px;line-height:1.3}
.al-card-sub{font-size:12px;color:${T.dim};line-height:1.5;margin-bottom:8px}
.al-card-tags{display:flex;gap:6px;flex-wrap:wrap}
.al-tag{font-size:10px;font-weight:600;padding:2px 8px;border-radius:8px;background:${T.bgSubtle};color:${T.dim};border:1px solid ${T.border};display:flex;align-items:center;gap:4px}
.al-card-right{display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0}
.al-card-time{font-family:'DM Mono',monospace;font-size:11px;color:${T.dim};white-space:nowrap;text-align:right}
.al-sev-badge{font-size:10px;font-weight:700;padding:3px 8px;border-radius:8px;letter-spacing:.04em;text-transform:uppercase}
.al-sev-badge.critical{background:${T.redBg};color:${T.red};border:1px solid #5a1a1a}
.al-sev-badge.warning{background:${T.amberBg};color:${T.amber};border:1px solid #5a3d0a}
.al-sev-badge.resolved-b{background:${T.greenBg};color:${T.green};border:1px solid #1a4030}
.al-card-expanded{border-top:1px solid ${T.border};padding:16px 18px;display:flex;gap:20px}
.al-expand-col{flex:1}
.al-expand-label{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${T.dimMid};margin-bottom:8px}
.al-notes-input{width:100%;background:${T.bgSubtle};border:1px solid ${T.border};border-radius:8px;padding:10px 12px;font-family:'DM Sans',sans-serif;font-size:13px;color:${T.white};outline:none;resize:none;height:72px;transition:border-color .15s}
.al-notes-input:focus{border-color:${T.tealMid}}
.al-notes-input::placeholder{color:${T.dimMid}}
.al-expand-actions{display:flex;flex-direction:column;gap:8px;min-width:180px}
.al-action-btn{padding:10px 14px;border-radius:8px;border:none;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:7px;transition:opacity .12s;width:100%;text-align:left}
.al-action-btn:hover{opacity:.85}
.al-action-btn:disabled{opacity:.5;cursor:not-allowed}
.al-action-btn.primary{background:${T.tealMid};color:#fff}
.al-resolve-note{font-size:12px;color:${T.dim};padding:8px 12px;background:${T.bgSubtle};border-radius:7px;border:1px solid ${T.border};margin-bottom:4px}
.al-resolve-note strong{color:${T.tealText};font-weight:600}
`
