'use client'
// src/app/dashboard/roster/import/ScheduleImportClient.tsx
// Weekly-grid schedule importer. CSV format: first column = employee identifier
// (phone or employee_number), then 7 columns headed Mon, Tue … Sun. A week
// picker (default: next week) resolves those weekday columns to concrete dates
// (Mon-first). Each cell is a time range ("08:00-19:00"), blank, or "OFF".
// Parsed + previewed client-side (same parseCell as the server), then POSTed to
// /api/schedule/import which validates against the DB and upserts on
// (employee_id, date). Manually-cancelled grid shifts are protected on re-import.

import { useState, useRef } from 'react'
import Link from 'next/link'
import Papa from 'papaparse'
import { parseCell, mondayOfISO, weekDatesISO, addDaysISO } from '@/lib/schedule'

import { LT as T } from '@/lib/theme'

const WD_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WD_INDEX: Record<string, number> = {
  mon: 0, monday: 0, tue: 1, tues: 1, tuesday: 1, wed: 2, weds: 2, wednesday: 2,
  thu: 3, thur: 3, thurs: 3, thursday: 3, fri: 4, friday: 4,
  sat: 5, saturday: 5, sun: 6, sunday: 6,
}
function weekdayIndex(h: string): number | null {
  const k = (h ?? '').trim().toLowerCase()
  return k in WD_INDEX ? WD_INDEX[k] : null
}

type ParsedRow = { identifier: string; days: string[]; cellErrors: number } // days[0]=Mon … [6]=Sun
type ServerResult = {
  added: number; updated: number; removed: number; skipped: number; skippedCancelled: number; errors: number
  results: { row: number; identifier: string; name?: string; added: number; updated: number; removed: number; skipped: number; skippedCancelled: number; errors: { date: string; reason: string }[] }[]
}

const VIEW = { UPLOAD: 'upload', REVIEW: 'review', UPLOADING: 'uploading', DONE: 'done' } as const
type View = (typeof VIEW)[keyof typeof VIEW]

function gstTodayISO() {
  return new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10)
}
function dmLabel(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function downloadTemplate() {
  const header = ['employee', ...WD_LABELS].join(',')
  // Placeholder identifiers won't match a real employee, so an accidental import
  // just reports them as unmatched — delete these example rows before use.
  const examples = [
    ['+9715XXXXXXXX', '08:00-19:00', '08:00-19:00', 'OFF', '08:00-17:00', '', 'OFF', '09:00-18:00'],
    ['OP-0001', '09:00-18:00', 'OFF', '09:00-18:00', '09:00-18:00', '09:00-18:00', 'OFF', 'OFF'],
  ]
  const body = examples.map((r) => r.join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([`${header}\n${body}`], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'opspro_schedule_template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export default function ScheduleImportClient() {
  const [view, setView] = useState<View>(VIEW.UPLOAD)
  // Default to NEXT week's Monday.
  const [weekStart, setWeekStart] = useState<string>(() => addDaysISO(mondayOfISO(gstTodayISO()), 7))
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [serverResult, setServerResult] = useState<ServerResult | null>(null)
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const dates = weekDatesISO(weekStart) // [Mon … Sun] resolved to real dates

  function handleFile(file?: File | null) {
    if (!file) return
    setParseError(null)
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: ({ data, meta }) => {
        const headers = (meta.fields ?? []).map((h) => h.trim())
        const wdCols = headers.map((h) => ({ h, i: weekdayIndex(h) })).filter((x) => x.i !== null) as { h: string; i: number }[]
        if (wdCols.length === 0) {
          setParseError('No weekday columns found. Headers must be the employee column plus Mon, Tue, Wed, Thu, Fri, Sat, Sun.')
          setView(VIEW.UPLOAD)
          return
        }
        const idCol = headers.find((h) => weekdayIndex(h) === null) ?? headers[0]
        const parsed: ParsedRow[] = (data as Record<string, string>[]).map((raw) => {
          const days = ['', '', '', '', '', '', '']
          for (const { h, i } of wdCols) days[i] = (raw[h] ?? '').trim()
          const cellErrors = days.filter((v) => v && parseCell(v).kind === 'error').length
          return { identifier: (raw[idCol] ?? '').trim(), days, cellErrors }
        })
        setRows(parsed)
        setView(VIEW.REVIEW)
      },
      error: () => setParseError("Could not parse file. Make sure it's a valid CSV."),
    })
  }

  async function submit() {
    if (rows.length === 0) return
    setView(VIEW.UPLOADING)
    try {
      const payloadRows = rows.map((r) => ({
        identifier: r.identifier,
        cells: Object.fromEntries(dates.map((d, i) => [d, r.days[i]])),
      }))
      const res = await fetch('/api/schedule/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dates, rows: payloadRows }),
      })
      const body = await res.json()
      if (!res.ok) { setParseError(body.error || 'Import failed'); setView(VIEW.REVIEW); return }
      setServerResult(body)
      setView(VIEW.DONE)
    } catch {
      setParseError('Network error during import.')
      setView(VIEW.REVIEW)
    }
  }

  function reset() {
    setRows([]); setServerResult(null); setParseError(null); setView(VIEW.UPLOAD)
  }

  const totalCellErrors = rows.reduce((a, r) => a + r.cellErrors, 0)
  const totalShifts = rows.reduce((a, r) => a + r.days.filter((v) => parseCell(v).kind === 'shift').length, 0)
  const weekLabel = `${dmLabel(dates[0])} – ${dmLabel(dates[6])}`

  return (
    <>
      <style>{css}</style>
      <div className="si-root">
       <div className="si-layout">
        <aside className="si-sidebar">
          <Link href="/dashboard/roster" className="si-back">← Back to roster</Link>
          <div className="si-sidebar-title">Import<br />week</div>
          <div className="si-sidebar-sub">Upload one week&apos;s schedule grid as a CSV.</div>
          <div className="si-side-block">
            <div className="si-side-label">Target week</div>
            <input
              type="date"
              className="si-week-input"
              value={weekStart}
              onChange={(e) => { if (e.target.value) setWeekStart(mondayOfISO(e.target.value)) }}
            />
            <div className="si-week-range">{weekLabel}</div>
          </div>
          <div className="si-col-list">
            <div className="si-col-title">CSV columns</div>
            <div className="si-col-item"><span className="si-col-key">employee</span><span className="si-col-req">req</span><span className="si-col-desc">phone or employee number</span></div>
            {WD_LABELS.map((w) => (
              <div key={w} className="si-col-item"><span className="si-col-key">{w}</span><span className="si-col-desc">08:00-19:00 · OFF · blank</span></div>
            ))}
          </div>
          <button className="si-dl-side" onClick={downloadTemplate}>⬇ Download template</button>
          <div className="si-sidebar-footer">Re-importing a week updates existing shifts; shifts you cancelled in the roster are left untouched.</div>
        </aside>

        <main className="si-main">
          {parseError && <div className="si-banner">{parseError}</div>}

          {view === VIEW.UPLOAD && (
            <>
              <div className="si-page-header">
                <div className="si-page-tag">Import week</div>
                <h1 className="si-page-h">Upload a <em>weekly schedule</em></h1>
                <p className="si-page-sub">One CSV row per picker: the employee column plus 7 day columns (Mon–Sun). Importing into <strong>{weekLabel}</strong> — set the target week in the sidebar.</p>
              </div>
              <div className="si-info teal"><span className="si-info-icon">💡</span><div><strong>Tip:</strong> the first column is the employee (a phone like <code>+9715XXXXXXXX</code> or their employee number); each day cell is a range like <code>08:00-19:00</code>, or <code>OFF</code> / blank for a day off. Re-importing updates existing shifts and never touches ones you cancelled.</div></div>
              <div
                className={`si-drop-zone ${drag ? 'drag' : ''}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files?.[0]) }}
              >
                <div className="si-drop-icon">📅</div>
                <div className="si-drop-title">Drop your schedule CSV here</div>
                <div className="si-drop-sub">or <strong>click to browse</strong> · into {weekLabel}</div>
                <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files?.[0])} />
              </div>
            </>
          )}

          {view === VIEW.REVIEW && (
            <>
              <div className="si-weekbanner">Importing week <strong>{weekLabel}</strong> — set the target week in the sidebar if this is wrong before importing.</div>
              <div className="si-stats">
                <div className="si-stat"><div className="si-stat-val">{rows.length}</div><div className="si-stat-label">Pickers</div></div>
                <div className="si-stat"><div className="si-stat-val" style={{ color: T.teal }}>{totalShifts}</div><div className="si-stat-label">Shifts</div></div>
                <div className="si-stat"><div className="si-stat-val" style={{ color: totalCellErrors ? T.red : T.inkLight }}>{totalCellErrors}</div><div className="si-stat-label">Cell errors</div></div>
              </div>

              <div className="si-grid-wrap">
                <table className="si-grid">
                  <thead>
                    <tr>
                      <th className="si-emp-col">Employee</th>
                      {dates.map((d, i) => (
                        <th key={d}><div className="si-th-wd">{WD_LABELS[i]}</div><div className="si-th-dm">{dmLabel(d)}</div></th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, ri) => (
                      <tr key={ri}>
                        <td className="si-emp-col"><span className="si-mono">{r.identifier || '—'}</span></td>
                        {r.days.map((v, i) => {
                          const c = parseCell(v)
                          if (c.kind === 'shift') return <td key={i}><span className="si-cell shift">{c.start.slice(0, 5)}–{c.end.slice(0, 5)}</span></td>
                          if (c.kind === 'off') return <td key={i}><span className="si-cell off">off</span></td>
                          return <td key={i} title={c.reason}><span className="si-cell err">⚠ {v}</span></td>
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="si-note">
                Validation against employees (exists, active, has a location, no double-booking) happens on import and is
                reported per row. Cell errors above are skipped; valid cells still import.
              </div>

              <div className="si-actions">
                <button className="si-btn ghost" onClick={reset}>← Choose another file</button>
                <button className="si-btn primary" onClick={submit}>Import {totalShifts} shift{totalShifts === 1 ? '' : 's'} into {weekLabel} →</button>
              </div>
            </>
          )}

          {view === VIEW.UPLOADING && (
            <div className="si-uploading">
              <div className="si-spinner" />
              <div className="si-uploading-title">Importing schedule…</div>
              <div className="si-uploading-sub">Validating against employees and upserting shifts.</div>
            </div>
          )}

          {view === VIEW.DONE && serverResult && (
            <div className="si-done">
              <div className="si-done-ring">✓</div>
              <div className="si-done-h">Schedule imported · {weekLabel}</div>
              <div className="si-done-cards">
                <div className="si-dcard"><div className="si-dcard-val" style={{ color: T.teal }}>{serverResult.added}</div><div className="si-dcard-label">Added</div></div>
                <div className="si-dcard"><div className="si-dcard-val">{serverResult.updated}</div><div className="si-dcard-label">Updated</div></div>
                <div className="si-dcard"><div className="si-dcard-val">{serverResult.removed}</div><div className="si-dcard-label">Cleared (off)</div></div>
                <div className="si-dcard"><div className="si-dcard-val">{serverResult.skipped}</div><div className="si-dcard-label">Unchanged</div></div>
                {serverResult.skippedCancelled > 0 && <div className="si-dcard"><div className="si-dcard-val" style={{ color: T.amber }}>{serverResult.skippedCancelled}</div><div className="si-dcard-label">Skipped (cancelled)</div></div>}
                {serverResult.errors > 0 && <div className="si-dcard err"><div className="si-dcard-val" style={{ color: T.red }}>{serverResult.errors}</div><div className="si-dcard-label">Errors</div></div>}
              </div>

              {serverResult.results.some((r) => r.errors.length > 0) && (
                <div className="si-errlist">
                  <div className="si-errlist-title">Rows with issues</div>
                  {serverResult.results.filter((r) => r.errors.length > 0).slice(0, 20).map((r) => (
                    <div key={r.row} className="si-errrow">
                      <strong>Row {r.row}{r.name ? ` · ${r.name}` : r.identifier ? ` · ${r.identifier}` : ''}:</strong>{' '}
                      {r.errors.map((e, j) => <span key={j}>{e.date === '*' ? e.reason : `${e.date}: ${e.reason}`}{j < r.errors.length - 1 ? '; ' : ''}</span>)}
                    </div>
                  ))}
                </div>
              )}

              <div className="si-actions" style={{ justifyContent: 'center' }}>
                <button className="si-btn primary" onClick={reset}>Import another week</button>
                <Link href="/dashboard/roster" className="si-btn secondary">View roster →</Link>
              </div>
            </div>
          )}
        </main>
       </div>
      </div>
    </>
  )
}

const css = `
*,*::before,*::after{box-sizing:border-box}
.si-root{font-family:var(--font-jakarta),sans-serif;background:${T.surface};min-height:100vh;color:${T.ink}}
.si-layout{display:grid;grid-template-columns:260px 1fr;min-height:100vh}
.si-sidebar{background:${T.tealDark};padding:32px 28px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow-y:auto}
.si-back{font-family:'DM Mono',monospace;font-size:12px;color:${T.onTealPanel};letter-spacing:.04em;margin-bottom:28px;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.si-back:hover{color:#fff}
.si-sidebar-title{font-family:var(--font-jakarta),serif;font-size:22px;font-weight:300;color:#fff;line-height:1.3;margin-bottom:8px}
.si-sidebar-sub{font-size:12px;color:${T.tealText};line-height:1.6;margin-bottom:26px}
.si-side-block{margin-bottom:26px}
.si-side-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.4);margin-bottom:8px}
.si-week-input{width:100%;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:8px 10px;font-family:var(--font-jakarta),sans-serif;font-size:13px;color:#fff;background:rgba(255,255,255,.08);outline:none}
.si-week-input:focus{border-color:${T.tealMid}}
.si-week-range{font-size:12px;font-weight:600;color:${T.tealText};margin-top:8px}
.si-col-list{flex:1;overflow-y:auto;margin-bottom:20px}
.si-col-title{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.4);margin-bottom:10px}
.si-col-item{display:flex;align-items:baseline;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.si-col-key{font-family:'DM Mono',monospace;font-size:11px;color:${T.tealText};flex-shrink:0}
.si-col-req{font-size:10px;color:#e87777;flex-shrink:0}
.si-col-desc{font-size:10px;color:rgba(255,255,255,.3);line-height:1.4}
.si-dl-side{padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.08);color:#fff;font-family:var(--font-jakarta),sans-serif;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:16px}
.si-dl-side:hover{background:rgba(255,255,255,.14)}
.si-sidebar-footer{padding-top:16px;border-top:1px solid rgba(255,255,255,.08);font-size:11px;color:rgba(255,255,255,.28);line-height:1.5}
.si-main{padding:44px 48px;overflow-y:auto}
.si-page-header{margin-bottom:28px}
.si-page-tag{font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:${T.tealMid};margin-bottom:8px}
.si-page-h{font-family:var(--font-jakarta),serif;font-size:32px;font-weight:300;color:${T.ink};line-height:1.15;margin-bottom:8px}
.si-page-h em{font-style:italic;color:${T.tealMid}}
.si-page-sub{font-size:14px;color:${T.inkLight};line-height:1.6;max-width:640px}
.si-info{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border-radius:10px;margin-bottom:20px;font-size:13px;line-height:1.6}
.si-info.teal{background:${T.tealLight};border:1px solid ${T.tealBorder};color:${T.teal}}
.si-info strong{font-weight:600}
.si-info code{font-family:'DM Mono',monospace;font-size:12px;background:${T.white};color:${T.teal};padding:1px 5px;border-radius:4px;border:1px solid ${T.tealBorder}}
.si-info-icon{font-size:17px;flex-shrink:0;margin-top:1px}
.si-btn{padding:9px 16px;border-radius:8px;border:none;font-family:var(--font-jakarta),sans-serif;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.si-btn.primary{background:${T.tealMid};color:#1B2B2B}.si-btn.primary:hover{background:${T.teal}}
.si-btn.secondary{background:${T.white};color:${T.inkMid};border:1px solid ${T.border}}.si-btn.secondary:hover{border-color:${T.tealBorder};color:${T.teal}}
.si-btn.ghost{background:${T.white};color:${T.inkMid};border:1px solid ${T.border}}.si-btn.ghost:hover{border-color:${T.tealBorder};color:${T.teal}}
.si-banner{padding:12px 16px;border-radius:10px;font-size:13px;margin-bottom:16px;background:${T.redBg};border:1px solid ${T.redBorder};color:${T.red}}
.si-weekbanner{padding:11px 16px;border-radius:10px;font-size:13px;margin-bottom:16px;background:${T.tealLight};border:1px solid ${T.tealBorder};color:${T.teal}}
.si-drop-zone{border:2px dashed ${T.tealBorder};border-radius:16px;background:${T.white};padding:52px 40px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;cursor:pointer;transition:border-color .15s,background .15s;gap:10px}
.si-drop-zone:hover,.si-drop-zone.drag{border-color:${T.tealMid};background:${T.tealLight}}
.si-drop-icon{font-size:44px}
.si-drop-title{font-size:18px;font-weight:600;color:${T.ink}}
.si-drop-sub{font-size:13px;color:${T.inkLight}}
.si-drop-sub strong{color:${T.teal}}
.si-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}
.si-stat{background:${T.white};border:1px solid ${T.border};border-radius:10px;padding:14px 18px}
.si-stat-val{font-family:var(--font-jakarta),sans-serif;font-size:26px;font-weight:700;line-height:1;margin-bottom:4px}
.si-stat-label{font-size:11px;color:${T.inkLight};font-weight:500}
.si-grid-wrap{background:${T.white};border:1px solid ${T.border};border-radius:12px;overflow:auto;max-height:60vh}
.si-grid{width:100%;border-collapse:collapse;font-size:12px}
.si-grid thead th{position:sticky;top:0;background:${T.surface};padding:8px 12px;text-align:left;border-bottom:1px solid ${T.border};white-space:nowrap}
.si-th-wd{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${T.inkMid}}
.si-th-dm{font-size:10px;color:${T.inkLight};margin-top:1px;font-weight:500}
.si-grid td{padding:8px 12px;border-bottom:1px solid ${T.border};vertical-align:middle}
.si-grid tbody tr:last-child td{border-bottom:none}
.si-emp-col{position:sticky;left:0;background:${T.white};min-width:160px;border-right:1px solid ${T.border}}
.si-grid thead .si-emp-col{background:${T.surface};z-index:1}
.si-mono{font-family:'DM Mono',monospace;font-size:12px;color:${T.ink}}
.si-cell{display:inline-block;font-size:11px;font-weight:600;padding:3px 8px;border-radius:6px;white-space:nowrap}
.si-cell.shift{background:${T.greenBg};color:${T.teal};border:1px solid ${T.tealBorder};font-family:'DM Mono',monospace}
.si-cell.off{background:${T.surface};color:${T.inkLight};border:1px solid ${T.border}}
.si-cell.err{background:${T.redBg};color:${T.red};border:1px solid ${T.redBorder}}
.si-note{font-size:12px;color:${T.inkLight};line-height:1.6;margin:14px 2px}
.si-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px}
.si-uploading{text-align:center;padding:80px 0}
.si-spinner{width:40px;height:40px;border:3px solid ${T.border};border-top-color:${T.tealMid};border-radius:50%;margin:0 auto 18px;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.si-uploading-title{font-size:16px;font-weight:600;margin-bottom:4px}
.si-uploading-sub{font-size:13px;color:${T.inkLight}}
.si-done{text-align:center;padding:48px 20px;max-width:720px;margin:0 auto}
.si-done-ring{width:96px;height:96px;border-radius:50%;background:${T.tealMid};display:flex;align-items:center;justify-content:center;font-size:46px;color:#1B2B2B;margin:0 auto 22px}
.si-done-h{font-family:var(--font-jakarta),sans-serif;font-size:24px;font-weight:600;margin-bottom:24px}
.si-done-cards{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:24px}
.si-dcard{background:${T.white};border:1px solid ${T.border};border-radius:12px;padding:16px 20px;min-width:92px}
.si-dcard.err{border-color:${T.redBorder};background:${T.redBg}}
.si-dcard-val{font-family:var(--font-jakarta),sans-serif;font-size:24px;font-weight:700;line-height:1;margin-bottom:4px}
.si-dcard-label{font-size:11px;color:${T.inkLight};text-transform:uppercase;letter-spacing:.05em;font-weight:600}
.si-errlist{text-align:left;background:${T.redBg};border:1px solid ${T.redBorder};border-radius:12px;padding:16px 18px;margin-bottom:24px}
.si-errlist-title{font-size:12px;font-weight:700;color:${T.red};text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}
.si-errrow{font-size:12px;color:${T.ink};line-height:1.6;margin-bottom:4px}
`
