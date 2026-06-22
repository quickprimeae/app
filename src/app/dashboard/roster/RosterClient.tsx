'use client'
// src/app/dashboard/roster/RosterClient.tsx
// Week roster grid: pickers (rows) × 7 days (columns). Each cell is a scheduled
// shift or an empty "off" state; click to add / edit / cancel with custom times.
// Cover and reassigned cells are marked distinctly. Location filter + week
// navigation. Every mutation hits /api/schedule/shift (which audits) then the
// view refreshes from the server.

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export type RosterEmployee = { id: string; empId: string; name: string; locationId: string | null; branch: string | null }
export type RosterLocation = { id: string; name: string; shiftStart: string | null; shiftEnd: string | null }
export type RosterShift = {
  id: string; employeeId: string; locationId: string; date: string
  start: string; end: string; status: 'scheduled' | 'cancelled' | 'reassigned'; origin: string
  reassignedTo: string | null
}

import { T } from '@/lib/theme'

function dayHeader(d: string) {
  const dt = new Date(`${d}T00:00:00Z`)
  return {
    wd: dt.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
    dm: dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  }
}
function rangeLabel(a: string, b: string) {
  const f = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${f(a)} – ${f(b)}`
}

type EditTarget = { employee: RosterEmployee; date: string; shift: RosterShift | null }

export default function RosterClient({
  weekStart, dates, prevWeek, nextWeek, employees, locations, shifts, loadError,
}: {
  weekStart: string; dates: string[]; prevWeek: string; nextWeek: string
  employees: RosterEmployee[]; locations: RosterLocation[]; shifts: RosterShift[]
  loadError?: string | null
}) {
  const router = useRouter()
  const [locFilter, setLocFilter] = useState<'all' | string>('all')
  const [edit, setEdit] = useState<EditTarget | null>(null)
  const [form, setForm] = useState<{ start: string; end: string }>({ start: '08:00', end: '19:00' })
  const [coverMode, setCoverMode] = useState(false)
  const [coverEmpId, setCoverEmpId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const gstToday = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10)
  const locName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations])
  const locById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])
  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees])
  const shiftByKey = useMemo(() => {
    const m = new Map<string, RosterShift>()
    for (const s of shifts) m.set(`${s.employeeId}|${s.date}`, s)
    return m
  }, [shifts])

  const rows = useMemo(
    () => (locFilter === 'all' ? employees : employees.filter((e) => e.locationId === locFilter)),
    [employees, locFilter]
  )

  // Per-day count of active (scheduled) shifts among the visible rows.
  const coverage = useMemo(() => {
    const visible = new Set(rows.map((r) => r.id))
    return dates.map((d) => shifts.filter((s) => s.date === d && s.status === 'scheduled' && visible.has(s.employeeId)).length)
  }, [rows, dates, shifts])

  function openCell(employee: RosterEmployee, date: string) {
    if (!employee.locationId) return // can't schedule without a location
    const shift = shiftByKey.get(`${employee.id}|${date}`) ?? null
    setError(null)
    setCoverMode(false)
    setCoverEmpId('')
    if (shift && shift.status !== 'cancelled') {
      setForm({ start: shift.start, end: shift.end })
    } else {
      const loc = locById.get(employee.locationId)
      setForm({ start: (loc?.shiftStart ?? '08:00').slice(0, 5), end: (loc?.shiftEnd ?? '19:00').slice(0, 5) })
    }
    setEdit({ employee, date, shift })
  }

  async function save() {
    if (!edit) return
    if (form.end <= form.start) { setError('End time must be after start time.'); return }
    setBusy(true)
    setError(null)
    try {
      const existing = edit.shift && edit.shift.status !== 'cancelled' ? edit.shift : null
      const res = existing
        ? await fetch('/api/schedule/shift', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: existing.id, start_time: form.start, end_time: form.end }),
          })
        : await fetch('/api/schedule/shift', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ employee_id: edit.employee.id, location_id: edit.employee.locationId, date: edit.date, start_time: form.start, end_time: form.end }),
          })
      const body = await res.json()
      if (!res.ok) { setError(body.error || 'Could not save.'); return }
      setEdit(null)
      router.refresh()
    } catch {
      setError('Network error.')
    } finally {
      setBusy(false)
    }
  }

  async function cancelShift() {
    if (!edit?.shift) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/schedule/shift', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: edit.shift.id }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body.error || 'Could not cancel.'); return }
      setEdit(null)
      router.refresh()
    } catch {
      setError('Network error.')
    } finally {
      setBusy(false)
    }
  }

  // Pickers who can cover: same location, not the original, and not already
  // working (status='scheduled') that day.
  const eligibleCovers = useMemo(() => {
    if (!edit) return []
    return employees.filter(
      (e) =>
        e.locationId === edit.employee.locationId &&
        e.id !== edit.employee.id &&
        shiftByKey.get(`${e.id}|${edit.date}`)?.status !== 'scheduled'
    )
  }, [edit, employees, shiftByKey])

  async function assignCover() {
    if (!edit?.shift || !coverEmpId) return
    if (form.end <= form.start) { setError('End time must be after start time.'); return }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/schedule/cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original_shift_id: edit.shift.id, cover_employee_id: coverEmpId, start_time: form.start, end_time: form.end }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body.error || 'Could not assign cover.'); return }
      setEdit(null)
      router.refresh()
    } catch {
      setError('Network error.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <style>{css}</style>
      <div className="rs-root">
        <header className="rs-topbar">
          <div className="rs-title">Roster</div>
          <div className="rs-week-nav">
            <Link href={`/dashboard/roster?week=${prevWeek}`} className="rs-nav-btn" aria-label="Previous week">‹</Link>
            <div className="rs-week-label">{rangeLabel(dates[0], dates[6])}</div>
            <Link href={`/dashboard/roster?week=${nextWeek}`} className="rs-nav-btn" aria-label="Next week">›</Link>
            {weekStart !== mondayThisWeek(gstToday) && (
              <Link href="/dashboard/roster" className="rs-today-btn">This week</Link>
            )}
          </div>
          <div className="rs-right">
            <select className="rs-select" value={locFilter} onChange={(e) => setLocFilter(e.target.value)}>
              <option value="all">All locations</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <Link href="/dashboard/roster/import" className="rs-btn ghost">📥 Import week</Link>
          </div>
        </header>

        <main className="rs-main">
          {loadError ? (
            <div className="rs-error">
              <div className="rs-error-icon">⚠</div>
              <div className="rs-error-title">Couldn&apos;t load the roster</div>
              <div className="rs-error-msg">{loadError}</div>
              <div className="rs-error-hint">This is a real load failure, not an empty schedule. Fix the cause, then refresh.</div>
            </div>
          ) : rows.length === 0 ? (
            <div className="rs-empty">No active pickers{locFilter !== 'all' ? ' at this location' : ''}. Assign a location and import a week to get started.</div>
          ) : (
            <div className="rs-grid-wrap">
              <table className="rs-grid">
                <thead>
                  <tr>
                    <th className="rs-emp-col">Picker</th>
                    {dates.map((d) => {
                      const h = dayHeader(d)
                      return (
                        <th key={d} className={d === gstToday ? 'today' : ''}>
                          <div className="rs-th-wd">{h.wd}</div>
                          <div className="rs-th-dm">{h.dm}</div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((emp) => (
                    <tr key={emp.id}>
                      <td className="rs-emp-col">
                        <div className="rs-emp-name">{emp.name}</div>
                        <div className="rs-emp-sub">{emp.locationId ? locName.get(emp.locationId) ?? '—' : <span style={{ color: T.amber }}>No location</span>}</div>
                      </td>
                      {dates.map((d) => {
                        const s = shiftByKey.get(`${emp.id}|${d}`)
                        return (
                          <td key={d} className={`rs-cell-td ${d === gstToday ? 'today' : ''}`}>
                            <button
                              className={`rs-cell ${cellClass(s)}`}
                              disabled={!emp.locationId}
                              onClick={() => openCell(emp, d)}
                              title={cellTitle(s, empName)}
                            >
                              {cellBody(s, empName)}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="rs-emp-col rs-foot">Scheduled</td>
                    {coverage.map((n, i) => (
                      <td key={i} className={`rs-foot ${dates[i] === gstToday ? 'today' : ''}`}>{n}</td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {!loadError && <div className="rs-legend">
            <span><i className="rs-dot sch" /> Scheduled</span>
            <span><i className="rs-dot cover" /> Cover</span>
            <span><i className="rs-dot reassigned" /> Reassigned away</span>
            <span><i className="rs-dot cancelled" /> Cancelled</span>
            <span><i className="rs-dot off" /> Off (click to add)</span>
          </div>}
        </main>

        {edit && (
          <div className="rs-overlay" onClick={() => !busy && setEdit(null)}>
            <div className="rs-modal" onClick={(e) => e.stopPropagation()}>
              <div className="rs-modal-head">
                <div>
                  <div className="rs-modal-title">{edit.employee.name}</div>
                  <div className="rs-modal-sub">{dayHeader(edit.date).wd} {dayHeader(edit.date).dm} · {locName.get(edit.employee.locationId ?? '') ?? '—'}</div>
                </div>
                <button className="rs-close" onClick={() => setEdit(null)} disabled={busy}>✕</button>
              </div>

              {coverMode ? (
                <>
                  <div className="rs-modal-note">
                    Assign someone to cover <strong>{edit.employee.name.split(' ')[0]}</strong> on {dayHeader(edit.date).wd} {dayHeader(edit.date).dm}.
                    The original is marked <em>reassigned</em>; the cover picker is the one tracked for attendance.
                  </div>
                  <div className="rs-modal-body" style={{ flexDirection: 'column' }}>
                    <label className="rs-field">
                      <span>Cover picker</span>
                      <select className="rs-cover-select" value={coverEmpId} onChange={(e) => setCoverEmpId(e.target.value)}>
                        <option value="">Select a picker…</option>
                        {eligibleCovers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                    </label>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <label className="rs-field"><span>Start</span><input type="time" value={form.start} onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} /></label>
                      <label className="rs-field"><span>End</span><input type="time" value={form.end} onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} /></label>
                    </div>
                  </div>
                  {eligibleCovers.length === 0 && <div className="rs-modal-note" style={{ color: T.amber }}>No pickers at this location are free that day.</div>}
                  {error && <div className="rs-modal-err">{error}</div>}
                  <div className="rs-modal-actions">
                    <button className="rs-btn ghost" onClick={() => { setCoverMode(false); setError(null) }} disabled={busy}>← Back</button>
                    <button className="rs-btn primary" onClick={assignCover} disabled={busy || !coverEmpId}>{busy ? 'Assigning…' : 'Confirm cover'}</button>
                  </div>
                </>
              ) : (
                <>
                  {edit.shift?.status === 'reassigned' && (
                    <div className="rs-modal-note">This shift was reassigned to {empName.get(edit.shift.reassignedTo ?? '') ?? 'a cover picker'}. Saving new times re-activates it for {edit.employee.name.split(' ')[0]}.</div>
                  )}
                  {edit.shift?.origin === 'cover' && edit.shift.status === 'scheduled' && (
                    <div className="rs-modal-note">This is a cover shift.</div>
                  )}

                  <div className="rs-modal-body">
                    <label className="rs-field">
                      <span>Start</span>
                      <input type="time" value={form.start} onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} />
                    </label>
                    <label className="rs-field">
                      <span>End</span>
                      <input type="time" value={form.end} onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} />
                    </label>
                  </div>

                  {error && <div className="rs-modal-err">{error}</div>}

                  <div className="rs-modal-actions">
                    {edit.shift && edit.shift.status !== 'cancelled' ? (
                      <button className="rs-btn danger" onClick={cancelShift} disabled={busy}>Cancel shift</button>
                    ) : <span />}
                    <div style={{ display: 'flex', gap: 8 }}>
                      {edit.shift?.status === 'scheduled' && (
                        <button className="rs-btn cover" onClick={() => { setCoverMode(true); setError(null) }} disabled={busy}>Assign cover</button>
                      )}
                      <button className="rs-btn ghost" onClick={() => setEdit(null)} disabled={busy}>Close</button>
                      <button className="rs-btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : edit.shift && edit.shift.status !== 'cancelled' ? 'Save times' : 'Add shift'}</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// Monday of the week containing the given GST date — used to detect "this week".
function mondayThisWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const dow = d.getUTCDay()
  const back = dow === 0 ? 6 : dow - 1
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

function cellClass(s?: RosterShift): string {
  if (!s) return 'off'
  if (s.status === 'cancelled') return 'cancelled'
  if (s.status === 'reassigned') return 'reassigned'
  if (s.origin === 'cover') return 'cover'
  return 'sch'
}
function cellBody(s: RosterShift | undefined, names: Map<string, string>) {
  if (!s) return <span className="rs-off-plus">+</span>
  if (s.status === 'cancelled') return <span className="rs-cell-x">cancelled</span>
  if (s.status === 'reassigned') {
    const to = names.get(s.reassignedTo ?? '')
    return <><span className="rs-strike">{s.start}–{s.end}</span><span className="rs-cover-to">→ {to ? to.split(' ')[0] : 'cover'}</span></>
  }
  return <><span>{s.start}–{s.end}</span>{s.origin === 'cover' && <span className="rs-badge">cover</span>}</>
}
function cellTitle(s: RosterShift | undefined, names: Map<string, string>): string {
  if (!s) return 'Off — click to add a shift'
  if (s.status === 'cancelled') return 'Cancelled — click to re-add'
  if (s.status === 'reassigned') return `Reassigned to ${names.get(s.reassignedTo ?? '') ?? 'cover picker'}`
  return `${s.start}–${s.end}${s.origin === 'cover' ? ' (cover)' : ''}`
}

const css = `
*,*::before,*::after{box-sizing:border-box}
.rs-root{font-family:var(--font-jakarta),sans-serif;background:${T.bg};min-height:100vh;color:${T.white}}
.rs-topbar{background:${T.bgCard};border-bottom:1px solid ${T.border};display:flex;align-items:center;padding:0 24px;height:56px;gap:18px;position:sticky;top:0;z-index:100;flex-wrap:wrap}
.rs-title{font-family:var(--font-jakarta),sans-serif;font-size:15px;font-weight:600;color:${T.whiteMid}}
.rs-week-nav{display:flex;align-items:center;gap:8px}
.rs-nav-btn{width:30px;height:30px;border-radius:7px;border:1px solid ${T.border};background:${T.bgSubtle};color:${T.whiteMid};font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;text-decoration:none}
.rs-nav-btn:hover{border-color:${T.teal};color:${T.tealBright}}
.rs-week-label{font-size:13px;font-weight:600;color:${T.white};min-width:130px;text-align:center}
.rs-today-btn{font-size:11px;font-weight:600;color:${T.tealText};text-decoration:none;border:1px solid ${T.border};border-radius:7px;padding:6px 10px}
.rs-today-btn:hover{border-color:${T.teal};color:${T.tealBright}}
.rs-right{margin-left:auto;display:flex;align-items:center;gap:10px}
.rs-select{background:${T.bgSubtle};border:1px solid ${T.border};border-radius:8px;padding:8px 12px;font-family:var(--font-jakarta),sans-serif;font-size:13px;color:${T.white};outline:none;cursor:pointer}
.rs-select:focus{border-color:${T.teal}}
.rs-btn{padding:8px 14px;border-radius:8px;border:none;font-family:var(--font-jakarta),sans-serif;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.rs-btn.primary{background:${T.tealMid};color:#1B2B2B}.rs-btn.primary:hover{opacity:.9}
.rs-btn.ghost{background:${T.bgSubtle};color:${T.whiteMid};border:1px solid ${T.border}}.rs-btn.ghost:hover{border-color:${T.teal};color:${T.tealBright}}
.rs-btn.danger{background:${T.redBg};color:${T.red};border:1px solid #FCA5A5}
.rs-btn.cover{background:${T.blueBg};color:${T.blue};border:1px solid #BAE6FD}.rs-btn.cover:hover{border-color:${T.blue}}
.rs-btn:disabled{opacity:.5;cursor:not-allowed}
.rs-cover-select{background:${T.bgSubtle};border:1px solid ${T.border};border-radius:8px;padding:10px 12px;font-family:var(--font-jakarta),sans-serif;font-size:14px;color:${T.white};outline:none;cursor:pointer;width:100%}
.rs-cover-select:focus{border-color:${T.teal}}
.rs-main{padding:22px 24px}
.rs-empty{text-align:center;padding:70px 0;color:${T.dim};font-size:14px}
.rs-error{text-align:center;padding:64px 20px;max-width:560px;margin:0 auto;background:${T.redBg};border:1px solid #FCA5A5;border-radius:14px}
.rs-error-icon{font-size:34px;margin-bottom:10px}
.rs-error-title{font-family:var(--font-jakarta),sans-serif;font-size:18px;font-weight:600;color:${T.red};margin-bottom:8px}
.rs-error-msg{font-family:'DM Mono',monospace;font-size:12px;color:${T.whiteMid};background:${T.bgSubtle};border:1px solid ${T.border};border-radius:8px;padding:10px 12px;margin:0 auto 12px;max-width:480px;word-break:break-word}
.rs-error-hint{font-size:12px;color:${T.dim};line-height:1.5}
.rs-grid-wrap{background:${T.bgCard};border:1px solid ${T.border};border-radius:12px;overflow:auto;max-height:calc(100vh - 160px)}
.rs-grid{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
.rs-grid thead th{position:sticky;top:0;z-index:2;background:${T.bgSubtle};padding:9px 10px;text-align:center;border-bottom:1px solid ${T.border};white-space:nowrap;min-width:96px}
.rs-grid thead th.today{background:${T.tealFaint}}
.rs-th-wd{font-size:11px;font-weight:700;color:${T.whiteMid};text-transform:uppercase;letter-spacing:.04em}
.rs-th-dm{font-size:10px;color:${T.dim};margin-top:1px}
.rs-emp-col{position:sticky;left:0;z-index:1;background:${T.bgCard};text-align:left;min-width:180px;padding:8px 12px;border-right:1px solid ${T.border};border-bottom:1px solid ${T.border}}
.rs-grid thead .rs-emp-col{z-index:3;background:${T.bgSubtle}}
.rs-emp-name{font-size:13px;font-weight:500;color:${T.white}}
.rs-emp-sub{font-size:10px;color:${T.dim};margin-top:1px}
.rs-cell-td{padding:5px;border-bottom:1px solid ${T.border};text-align:center}
.rs-cell-td.today{background:rgba(13,31,24,.4)}
.rs-cell{width:100%;min-height:38px;border-radius:8px;border:1px solid transparent;background:none;cursor:pointer;font-family:'DM Mono',monospace;font-size:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:6px 4px;transition:background .1s,border-color .1s}
.rs-cell:disabled{cursor:not-allowed;opacity:.4}
.rs-cell.off{color:${T.dimMid}}
.rs-cell.off:hover{background:${T.bgHover};border-color:${T.borderMid};color:${T.tealText}}
.rs-off-plus{font-size:16px;opacity:.4}
.rs-cell.sch{background:${T.greenBg};color:${T.tealText};border-color:#9DEEE6}
.rs-cell.sch:hover{border-color:${T.tealMid}}
.rs-cell.cover{background:${T.blueBg};color:${T.blue};border-color:#BAE6FD}
.rs-cell.cover:hover{border-color:${T.blue}}
.rs-cell.reassigned{background:${T.bgSubtle};border-color:${T.border}}
.rs-cell.cancelled{background:${T.redBg};color:${T.red};border-color:#FCA5A5}
.rs-badge{font-size:8px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;background:${T.blue};color:#0E7490;padding:1px 5px;border-radius:8px;font-family:var(--font-jakarta),sans-serif}
.rs-strike{text-decoration:line-through;color:${T.dimMid};font-size:11px}
.rs-cover-to{font-size:9px;color:${T.tealText};font-family:var(--font-jakarta),sans-serif}
.rs-cell-x{font-size:10px;font-family:var(--font-jakarta),sans-serif;text-transform:uppercase;letter-spacing:.04em}
.rs-foot{padding:8px 10px;text-align:center;font-size:12px;font-weight:600;color:${T.tealText};background:${T.bgSubtle};border-top:1px solid ${T.borderMid};position:sticky;bottom:0}
.rs-foot.rs-emp-col{text-align:left;color:${T.dim};font-size:10px;text-transform:uppercase;letter-spacing:.06em}
.rs-foot.today{background:${T.tealFaint}}
.rs-legend{display:flex;gap:18px;flex-wrap:wrap;padding:14px 4px 0;font-size:11px;color:${T.dim}}
.rs-legend span{display:flex;align-items:center;gap:6px}
.rs-dot{width:10px;height:10px;border-radius:3px;display:inline-block}
.rs-dot.sch{background:${T.greenBg};border:1px solid #9DEEE6}
.rs-dot.cover{background:${T.blueBg};border:1px solid #BAE6FD}
.rs-dot.reassigned{background:${T.bgSubtle};border:1px solid ${T.border}}
.rs-dot.cancelled{background:${T.redBg};border:1px solid #FCA5A5}
.rs-dot.off{background:none;border:1px dashed ${T.borderMid}}
.rs-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:200;display:flex;align-items:center;justify-content:center;animation:rsFade .15s ease}
@keyframes rsFade{from{opacity:0}to{opacity:1}}
.rs-modal{width:380px;max-width:calc(100vw - 32px);background:${T.bgCard};border:1px solid ${T.borderMid};border-radius:14px;overflow:hidden}
.rs-modal-head{display:flex;align-items:flex-start;justify-content:space-between;padding:18px 20px 14px;border-bottom:1px solid ${T.border}}
.rs-modal-title{font-family:var(--font-jakarta),sans-serif;font-size:17px;font-weight:600;color:${T.white}}
.rs-modal-sub{font-size:12px;color:${T.dim};margin-top:3px}
.rs-close{background:none;border:1px solid ${T.border};color:${T.dim};width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:14px}
.rs-close:hover{color:${T.white};border-color:${T.borderMid}}
.rs-modal-note{margin:12px 20px 0;padding:9px 12px;background:${T.bgSubtle};border:1px solid ${T.border};border-radius:8px;font-size:11px;color:${T.dim};line-height:1.5}
.rs-modal-body{display:flex;gap:12px;padding:18px 20px}
.rs-field{flex:1;display:flex;flex-direction:column;gap:6px}
.rs-field span{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${T.dim}}
.rs-field input{background:${T.bgSubtle};border:1px solid ${T.border};border-radius:8px;padding:10px 12px;font-family:'DM Mono',monospace;font-size:14px;color:${T.white};outline:none;color-scheme:dark}
.rs-field input:focus{border-color:${T.teal}}
.rs-modal-err{margin:0 20px;padding:9px 12px;background:${T.redBg};border:1px solid #FCA5A5;border-radius:8px;font-size:12px;color:${T.red}}
.rs-modal-actions{display:flex;align-items:center;justify-content:space-between;padding:16px 20px 20px;gap:8px}
`
