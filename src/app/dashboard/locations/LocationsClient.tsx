'use client'
// src/app/dashboard/locations/LocationsClient.tsx
// Locations: filterable list + Dubai pin map + detail panel, with add/edit
// (modal) and geofence adjustment wired to /api/locations.

import { useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { LocationRow } from '@/lib/locations-data'
import { LOCATION_DEFAULTS } from '@/lib/locations-defaults'
import LocationsMap from './LocationsMap'

import { T } from '@/lib/theme'

type Filter = 'all' | 'active' | 'late' | 'noshow'

// Defaults come from the shared LOCATION_DEFAULTS so the Add form and the bulk
// importer start every new location from identical values (150 / Mon-Sun /
// 08:00 / 23:59). These are editable starting values, not locked.
const EMPTY_FORM = {
  id: '', name: '', chain: '', area: '', address: '',
  lat: '', lng: '',
  geofence_radius: String(LOCATION_DEFAULTS.geofence_m),
  shift_start: LOCATION_DEFAULTS.store_start as string,
  shift_end: LOCATION_DEFAULTS.store_end as string,
  shift_days: LOCATION_DEFAULTS.store_days as string,
}

export default function LocationsClient({ initial }: { initial: LocationRow[] }) {
  const router = useRouter()
  const ALL = initial
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [form, setForm] = useState<typeof EMPTY_FORM | null>(null)
  const [busy, setBusy] = useState(false)
  // Snapshot of the form as opened, to detect unsaved edits (data-loss guard).
  const initialFormRef = useRef<string>('')
  // True only while a mouse-press started on the backdrop itself (not a drag
  // that began inside the modal — e.g. selecting text and releasing outside).
  const backdropDownRef = useRef(false)

  const formIsDirty = () => !!form && JSON.stringify(form) !== initialFormRef.current

  // Close the modal without ever silently discarding typed input: a backdrop
  // dismiss confirms first when the form has unsaved edits. Cancel/✕ are
  // explicit, so they close directly.
  function closeForm(opts?: { confirmIfDirty?: boolean }) {
    if (opts?.confirmIfDirty && formIsDirty()) {
      if (!window.confirm('Discard unsaved changes to this location?')) return
    }
    setForm(null)
  }

  const filtered = useMemo(() => {
    let d = ALL
    if (filter !== 'all') d = d.filter((l) => l.status === filter)
    if (search) {
      const q = search.toLowerCase()
      // Client is hidden in the UI (demo) — search by name/supervisor only, so
      // typing a client name (e.g. "Talabat") no longer surfaces locations.
      d = d.filter((l) => l.name.toLowerCase().includes(q) || (l.supervisor ?? '').toLowerCase().includes(q))
    }
    return d
  }, [ALL, filter, search])

  const sel = selected ? ALL.find((l) => l.id === selected) ?? null : null
  const counts = {
    all: ALL.length,
    active: ALL.filter((l) => l.status === 'active').length,
    late: ALL.filter((l) => l.status === 'late').length,
    noshow: ALL.filter((l) => l.status === 'noshow').length,
  }

  function changeFilter(f: Filter) { setFilter(f); setSelected(null) } // bug #5

  function openAdd() {
    const f = { ...EMPTY_FORM }
    initialFormRef.current = JSON.stringify(f)
    setForm(f)
  }
  function openEdit(loc: LocationRow) {
    const f = {
      id: loc.id, name: loc.name,
      chain: loc.chain ?? '', area: loc.area ?? '', address: loc.address ?? '',
      lat: String(loc.lat), lng: String(loc.lng), geofence_radius: String(loc.geofenceRadius),
      shift_start: loc.shiftHours.split('–')[0] || '08:00', shift_end: loc.shiftHours.split('–')[1] || '19:00',
      shift_days: loc.shiftDays ?? 'Mon-Sat',
    }
    initialFormRef.current = JSON.stringify(f)
    setForm(f)
  }

  async function saveForm() {
    if (!form) return
    if (!form.name || !form.lat || !form.lng) {
      alert('Name, latitude and longitude are required.')
      return
    }
    setBusy(true)
    try {
      const body: Record<string, any> = {
        name: form.name, chain: form.chain || null, area: form.area || null,
        address: form.address || null, lat: Number(form.lat), lng: Number(form.lng),
        geofence_radius: Number(form.geofence_radius) || 150,
        shift_start: `${form.shift_start}:00`, shift_end: `${form.shift_end}:00`, shift_days: form.shift_days,
      }
      const isEdit = !!form.id
      const res = await fetch('/api/locations', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { location_id: form.id, ...body } : body),
      })
      if (!res.ok) { alert((await res.json()).error || 'Save failed'); return }
      setForm(null)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function adjustGeofence(loc: LocationRow) {
    const v = prompt(`Geofence radius for ${loc.name} (metres):`, String(loc.geofenceRadius))
    if (v == null) return
    const radius = Number(v)
    if (!Number.isFinite(radius) || radius <= 0) { alert('Enter a positive number.'); return }
    setBusy(true)
    try {
      await fetch('/api/locations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_id: loc.id, geofence_radius: radius }),
      })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <style>{css}</style>
      <div className="lp-root">
        <header className="lp-topbar">
          <div className="lp-topbar-title">Locations</div>
          <div className="lp-topbar-right">
            <div className="lp-search">
              <span style={{ fontSize: 13, color: T.dim }}>🔍</span>
              <input placeholder="Search locations…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Link href="/dashboard/locations/bulk" className="lp-btn ghost">⬆ Bulk upload</Link>
            <button className="lp-btn primary" onClick={openAdd}>+ Add location</button>
          </div>
        </header>

        <div className="lp-body">
          <div className="lp-left">
            <div className="lp-stats-row">
              <div className="lp-top-stat"><div className="lp-top-stat-val" style={{ color: T.white }}>{counts.all}</div><div className="lp-top-stat-label">Total</div></div>
              <div className="lp-top-stat"><div className="lp-top-stat-val" style={{ color: T.tealBright }}>{counts.active}</div><div className="lp-top-stat-label">Active</div></div>
              <div className="lp-top-stat"><div className="lp-top-stat-val" style={{ color: T.amber }}>{counts.late}</div><div className="lp-top-stat-label">Late</div></div>
              <div className="lp-top-stat"><div className="lp-top-stat-val" style={{ color: T.red }}>{counts.noshow}</div><div className="lp-top-stat-label">No-show</div></div>
            </div>

            <div className="lp-filter-bar">
              {([
                { id: 'all', label: `All (${counts.all})`, dot: T.dim, cls: '' },
                { id: 'active', label: `Active (${counts.active})`, dot: T.tealBright, cls: '' },
                { id: 'late', label: `Late (${counts.late})`, dot: T.amber, cls: 'af' },
                { id: 'noshow', label: `No-show (${counts.noshow})`, dot: T.red, cls: 'rf' },
              ] as const).map((f) => (
                <button key={f.id} className={`lp-filter ${filter === f.id ? 'active' : ''} ${filter === f.id && f.cls ? f.cls : ''}`} onClick={() => changeFilter(f.id)}>
                  <div className="lp-fdot" style={{ background: filter === f.id ? f.dot : T.dimMid }} />{f.label}
                </button>
              ))}
            </div>

            <div className="lp-list">
              {filtered.map((loc, i) => (
                <div key={loc.id} className={`lp-list-item s-${loc.status} ${selected === loc.id ? 'selected' : ''}`} onClick={() => setSelected(selected === loc.id ? null : loc.id)}>
                  <div className="lp-list-num">{i + 1}</div>
                  <div className="lp-list-info">
                    <div className="lp-list-name">{loc.name}</div>
                    <div className="lp-list-meta">
                      <span>{loc.geofenceRadius}m fence</span>
                    </div>
                  </div>
                  <div className="lp-list-right">
                    <div className={`lp-status-dot-label ${loc.status}`}>
                      {loc.status === 'active' ? '● Active' : loc.status === 'noshow' ? '✗ No-show' : loc.status === 'late' ? '⚠ Late' : '–'}
                    </div>
                    <div className="lp-attendance">{loc.clockedIn}/{loc.total}</div>
                  </div>
                </div>
              ))}
              {filtered.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: T.dim, fontSize: 13 }}>No locations match.</div>}
            </div>
          </div>

          <div className="lp-right">
            <div className="lp-map-area">
              <LocationsMap
                locations={ALL}
                selected={selected}
                onSelect={(id) => setSelected(selected === id ? null : id)}
              />
              <div className="lp-map-label">📍 Dubai — {ALL.length} locations</div>
              <div className="lp-map-legend">
                {[{ color: T.tealBright, label: 'Active' }, { color: T.amber, label: 'Late' }, { color: T.red, label: 'No-show' }, { color: T.dimMid, label: 'No shift' }].map((l) => (
                  <div key={l.label} className="lp-legend-item"><div className="lp-legend-dot" style={{ background: l.color }} />{l.label}</div>
                ))}
              </div>
            </div>

            <div className="lp-detail">
              {!sel ? (
                <div className="lp-detail-empty"><span style={{ fontSize: 28 }}>📍</span><span>Select a location to see details</span></div>
              ) : (
                <>
                  <div className="lp-detail-header">
                    <div>
                      <div className="lp-detail-title">{sel.name}</div>
                      <div className="lp-detail-sub">{sel.address ?? sel.area ?? '—'}</div>
                    </div>
                    <div className={`lp-status-dot-label ${sel.status}`} style={{ fontSize: 11 }}>
                      {sel.status === 'active' ? '● Active' : sel.status === 'noshow' ? '✗ No-show' : sel.status === 'late' ? '⚠ Late' : '–'}
                    </div>
                  </div>
                  <div className="lp-detail-grid">
                    {[
                      { label: 'Attendance', val: `${sel.clockedIn}/${sel.total} pickers`, col: sel.clockedIn === sel.total && sel.total > 0 ? T.tealBright : T.amber },
                      { label: 'Store timings', val: sel.shiftHours, col: T.white },
                      { label: 'Geofence', val: `${sel.geofenceRadius}m radius`, col: T.white },
                      { label: 'Days', val: sel.shiftDays ?? '—', col: T.white },
                    ].map((s) => (
                      <div key={s.label} className="lp-detail-stat"><div className="lp-detail-stat-label">{s.label}</div><div className="lp-detail-stat-val" style={{ color: s.col, fontSize: 13 }}>{s.val}</div></div>
                    ))}
                  </div>
                  <div className="lp-picker-chips">
                    {sel.pickers.map((p, i) => (
                      <div key={i} className={`lp-chip ${p.status}`}>
                        <div className="lp-cdot" style={{ background: p.status === 'in' ? T.tealBright : p.status === 'absent' ? T.red : T.dimMid }} />
                        {p.name.split(' ')[0]}
                      </div>
                    ))}
                    {sel.pickers.length === 0 && <span style={{ fontSize: 12, color: T.dimMid }}>No pickers assigned</span>}
                  </div>
                  <div className="lp-detail-actions">
                    <button className="lp-act-btn" onClick={() => openEdit(sel)}>✏️ Edit location</button>
                    <button className="lp-act-btn" onClick={() => adjustGeofence(sel)} disabled={busy}>📏 Adjust geofence</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {form && (
          <div
            className="lp-overlay"
            onMouseDown={(e) => { backdropDownRef.current = e.target === e.currentTarget }}
            onMouseUp={(e) => {
              // Only a TRUE backdrop click closes: the press and release both
              // landed on the backdrop itself. A text-selection drag that began
              // in the modal and ended out here leaves backdropDownRef false, so
              // it never closes and never loses typed input.
              const trueBackdropClick = backdropDownRef.current && e.target === e.currentTarget
              backdropDownRef.current = false
              if (trueBackdropClick) closeForm({ confirmIfDirty: true })
            }}
          >
            <div className="lp-modal">
              <div className="lp-modal-title">{form.id ? 'Edit location' : 'Add location'}</div>
              <div style={{ fontSize: 12, color: T.dim, marginBottom: 16, lineHeight: 1.5 }}>
                Store timings are <strong style={{ color: T.whiteMid }}>optional defaults</strong> — used only for pickers who don&apos;t have their own shift set. Name and coordinates are required.
              </div>
              <div className="lp-modal-grid">
                <Field label="Name *"><input className="lp-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                <Field label="Chain"><input className="lp-input" value={form.chain} onChange={(e) => setForm({ ...form, chain: e.target.value })} /></Field>
                <Field label="Area"><input className="lp-input" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} /></Field>
                <Field label="Address" full><input className="lp-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
                <Field label="Latitude *"><input className="lp-input" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} /></Field>
                <Field label="Longitude *"><input className="lp-input" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} /></Field>
                <Field label="Geofence (m)"><input className="lp-input" value={form.geofence_radius} onChange={(e) => setForm({ ...form, geofence_radius: e.target.value })} /></Field>
                <Field label="Default store days" full><input className="lp-input" placeholder="e.g. Mon-Sat (optional)" value={form.shift_days} onChange={(e) => setForm({ ...form, shift_days: e.target.value })} /></Field>
                <Field label="Default store start"><input className="lp-input" type="time" value={form.shift_start} onChange={(e) => setForm({ ...form, shift_start: e.target.value })} /></Field>
                <Field label="Default store end"><input className="lp-input" type="time" value={form.shift_end} onChange={(e) => setForm({ ...form, shift_end: e.target.value })} /></Field>
              </div>
              <div className="lp-modal-actions">
                <button className="lp-btn ghost" onClick={() => closeForm()}>Cancel</button>
                <button className="lp-btn primary" onClick={saveForm} disabled={busy}>{busy ? 'Saving…' : form.id ? 'Save changes' : 'Create location'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, gridColumn: full ? '1 / -1' : undefined }}>
      <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: T.dim }}>{label}</label>
      {children}
    </div>
  )
}

const css = `
*,*::before,*::after{box-sizing:border-box}
.lp-root{font-family:var(--font-jakarta),sans-serif;background:${T.bg};min-height:100vh;color:${T.white};display:flex;flex-direction:column}
.lp-topbar{background:${T.bgCard};border-bottom:1px solid ${T.border};display:flex;align-items:center;padding:0 28px;height:56px;gap:16px;position:sticky;top:0;z-index:100}
.lp-logo{font-family:'DM Mono',monospace;font-size:13px;color:${T.tealBright};letter-spacing:.06em;text-decoration:none}
.lp-divider{width:1px;height:20px;background:${T.border}}
.lp-topbar-title{font-family:var(--font-jakarta),sans-serif;font-size:15px;font-weight:600;color:${T.whiteMid}}
.lp-topbar-right{margin-left:auto;display:flex;align-items:center;gap:12px}
.lp-search{display:flex;align-items:center;gap:8px;background:${T.bgSubtle};border:1px solid ${T.border};border-radius:8px;padding:7px 12px;width:220px;transition:border-color .15s}
.lp-search:focus-within{border-color:${T.teal}}
.lp-search input{background:none;border:none;outline:none;font-family:var(--font-jakarta),sans-serif;font-size:13px;color:${T.white};width:100%}
.lp-search input::placeholder{color:${T.dimMid}}
.lp-btn{padding:8px 16px;border-radius:8px;border:none;font-family:var(--font-jakarta),sans-serif;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;transition:opacity .12s}
.lp-btn.primary{background:${T.tealMid};color:#1B2B2B}.lp-btn.primary:hover{opacity:.85}
.lp-btn.primary:disabled{opacity:.5;cursor:not-allowed}
.lp-btn.ghost{background:${T.bgSubtle};color:${T.whiteMid};border:1px solid ${T.border}}.lp-btn.ghost:hover{border-color:${T.teal};color:${T.tealBright}}
.lp-body{display:flex;flex:1;overflow:hidden;height:calc(100vh - 56px)}
.lp-left{width:420px;flex-shrink:0;border-right:1px solid ${T.border};display:flex;flex-direction:column;overflow:hidden}
.lp-right{flex:1;display:flex;flex-direction:column;overflow:hidden}
.lp-filter-bar{padding:14px 16px;border-bottom:1px solid ${T.border};display:flex;gap:6px;flex-wrap:wrap}
.lp-filter{display:flex;align-items:center;gap:5px;padding:5px 10px;border-radius:16px;border:1px solid ${T.border};background:none;font-family:var(--font-jakarta),sans-serif;font-size:11px;font-weight:600;color:${T.dim};cursor:pointer;transition:all .12s}
.lp-filter:hover{border-color:${T.teal};color:${T.tealText}}
.lp-filter.active{background:${T.tealFaint};border-color:${T.teal};color:${T.tealBright}}
.lp-filter.active.rf{background:${T.redBg};border-color:#FCA5A5;color:${T.red}}
.lp-filter.active.af{background:${T.amberBg};border-color:#FCD34D;color:${T.amber}}
.lp-fdot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.lp-list{flex:1;overflow-y:auto}
.lp-list-item{padding:14px 16px;border-bottom:1px solid ${T.border};cursor:pointer;transition:background .12s;display:flex;align-items:flex-start;gap:12px}
.lp-list-item:hover{background:${T.bgHover}}
.lp-list-item.selected{background:${T.tealFaint}}
.lp-list-item.s-noshow{border-left:3px solid ${T.red};padding-left:13px}
.lp-list-item.s-late{border-left:3px solid ${T.amber};padding-left:13px}
.lp-list-num{font-family:'DM Mono',monospace;font-size:11px;color:${T.dimMid};width:24px;flex-shrink:0;padding-top:2px}
.lp-list-info{flex:1;min-width:0}
.lp-list-name{font-size:13px;font-weight:600;color:${T.white};margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lp-list-meta{font-size:11px;color:${T.dim};display:flex;gap:8px;flex-wrap:wrap}
.lp-list-right{text-align:right;flex-shrink:0}
.lp-status-dot-label{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
.lp-status-dot-label.active{background:${T.greenBg};color:${T.green};border:1px solid #9DEEE6}
.lp-status-dot-label.noshow{background:${T.redBg};color:${T.red};border:1px solid #FCA5A5}
.lp-status-dot-label.late{background:${T.amberBg};color:${T.amber};border:1px solid #FCD34D}
.lp-status-dot-label.noshift{background:${T.bgSubtle};color:${T.dimMid};border:1px solid ${T.border}}
.lp-attendance{font-family:'DM Mono',monospace;font-size:12px;color:${T.tealText};margin-top:4px}
.lp-map-area{flex:1;background:${T.bgSubtle};border-bottom:1px solid ${T.border};position:relative;overflow:hidden}
.lp-map-canvas{position:absolute;inset:0;width:100%;height:100%}
.lp-map-state{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:${T.dim};font-size:13px;background:${T.bgSubtle};text-align:center;padding:24px;z-index:6}
.lp-map-spinner{width:22px;height:22px;border-radius:50%;border:2px solid ${T.border};border-top-color:${T.tealBright};animation:lp-spin .8s linear infinite}
@keyframes lp-spin{to{transform:rotate(360deg)}}
.lp-map-label{position:absolute;top:16px;left:16px;z-index:5;font-family:'DM Mono',monospace;font-size:11px;color:${T.dim};background:${T.bgCard};padding:5px 10px;border-radius:6px;border:1px solid ${T.border}}
.lp-map-legend{position:absolute;bottom:16px;right:16px;z-index:5;background:${T.bgCard};border:1px solid ${T.border};border-radius:8px;padding:10px 14px;display:flex;flex-direction:column;gap:6px}
.lp-legend-item{display:flex;align-items:center;gap:7px;font-size:11px;color:${T.dim}}
.lp-legend-dot{width:10px;height:10px;border-radius:50%}
.lp-detail{height:280px;border-top:1px solid ${T.border};overflow-y:auto;padding:18px 22px;background:${T.bgCard}}
.lp-detail-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:${T.dimMid};gap:8px;font-size:14px}
.lp-detail-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px}
.lp-detail-title{font-family:var(--font-jakarta),sans-serif;font-size:18px;font-weight:600;color:${T.white};margin-bottom:3px}
.lp-detail-sub{font-size:12px;color:${T.dim}}
.lp-detail-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
.lp-detail-stat{background:${T.bgSubtle};border:1px solid ${T.border};border-radius:8px;padding:10px 12px}
.lp-detail-stat-label{font-size:9px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${T.dim};margin-bottom:3px}
.lp-detail-stat-val{font-family:'DM Mono',monospace;font-size:16px;font-weight:500;color:${T.white}}
.lp-picker-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.lp-chip{display:flex;align-items:center;gap:5px;padding:4px 9px;border-radius:6px;font-size:11px;font-weight:500;border:1px solid transparent}
.lp-chip.in{background:#DCFCE7;color:${T.tealText};border-color:#9DEEE6}
.lp-chip.absent{background:${T.redBg};color:${T.red};border-color:#FCA5A5}
.lp-chip.expected{background:${T.bgSubtle};color:${T.dimMid};border-color:${T.border}}
.lp-cdot{width:5px;height:5px;border-radius:50%}
.lp-detail-actions{display:flex;gap:8px}
.lp-act-btn{padding:8px 14px;border-radius:7px;border:1px solid ${T.border};background:none;font-family:var(--font-jakarta),sans-serif;font-size:12px;font-weight:600;color:${T.whiteMid};cursor:pointer;transition:all .12s;display:flex;align-items:center;gap:6px}
.lp-act-btn:hover{border-color:${T.tealMid};color:${T.tealBright}}
.lp-act-btn:disabled{opacity:.5;cursor:not-allowed}
.lp-stats-row{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid ${T.border}}
.lp-top-stat{padding:14px 16px;border-right:1px solid ${T.border}}
.lp-top-stat:last-child{border-right:none}
.lp-top-stat-val{font-family:var(--font-jakarta),sans-serif;font-size:22px;font-weight:700;line-height:1;margin-bottom:3px}
.lp-top-stat-label{font-size:10px;color:${T.dim};font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.lp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:300;display:flex;align-items:center;justify-content:center;padding:24px}
.lp-modal{width:100%;max-width:620px;max-height:90vh;overflow-y:auto;background:${T.bgCard};border:1px solid ${T.borderMid};border-radius:14px;padding:24px}
.lp-modal-title{font-family:var(--font-jakarta),sans-serif;font-size:18px;font-weight:600;color:${T.white};margin-bottom:18px}
.lp-modal-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px}
.lp-input{background:${T.bgSubtle};border:1px solid ${T.border};border-radius:8px;padding:10px 12px;font-family:var(--font-jakarta),sans-serif;font-size:14px;color:${T.white};outline:none;width:100%}
.lp-input:focus{border-color:${T.teal}}
.lp-modal-actions{display:flex;justify-content:flex-end;gap:10px}
`
