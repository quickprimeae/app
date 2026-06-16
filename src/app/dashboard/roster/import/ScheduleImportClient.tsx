'use client'
// src/app/dashboard/roster/import/ScheduleImportClient.tsx
// Weekly-grid schedule importer. CSV format: first column = employee identifier
// (phone or employee_number), then one column per date (YYYY-MM-DD header).
// Each cell is a time range ("08:00-19:00"), blank, or "OFF". Parsed + previewed
// client-side (same parseCell as the server), then POSTed to
// /api/schedule/import which validates against the DB and upserts on
// (employee_id, date).

import { useState, useRef } from 'react'
import Link from 'next/link'
import Papa from 'papaparse'
import { parseCell, isDateHeader, nextDates } from '@/lib/schedule'

const T = {
  tealDark: '#085041', teal: '#0F6E56', tealMid: '#1D9E75', tealLight: '#E1F5EE',
  tealBorder: '#9FE1CB', tealText: '#5DCAA5', ink: '#0f1a15', inkMid: '#374940',
  inkLight: '#6b7c75', surface: '#f5f8f6', white: '#ffffff', border: '#e0ebe6',
  amber: '#854F0B', amberBg: '#FAEEDA', amberBorder: '#FAC775', red: '#A32D2D',
  redBg: '#FCEBEB', redBorder: '#F7C1C1', green: '#085041', greenBg: '#E1F5EE',
}

type ParsedRow = { identifier: string; cells: Record<string, string>; cellErrors: number }
type ServerResult = {
  added: number; updated: number; removed: number; skipped: number; errors: number
  results: { row: number; identifier: string; name?: string; added: number; updated: number; removed: number; skipped: number; errors: { date: string; reason: string }[] }[]
}

const VIEW = { UPLOAD: 'upload', REVIEW: 'review', UPLOADING: 'uploading', DONE: 'done' } as const
type View = (typeof VIEW)[keyof typeof VIEW]

function dayLabel(d: string): string {
  const dt = new Date(`${d}T00:00:00`)
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function downloadTemplate() {
  const dates = nextDates(7)
  const header = ['employee', ...dates].join(',')
  // Example rows use placeholder identifiers that won't match a real employee,
  // so an accidental import simply reports them as unmatched — delete before use.
  const examples = [
    ['+9715XXXXXXXX', '08:00-19:00', '08:00-19:00', 'OFF', '08:00-17:00', '', 'OFF', '09:00-18:00'],
    ['QP-0001', '09:00-18:00', 'OFF', '09:00-18:00', '09:00-18:00', '09:00-18:00', 'OFF', 'OFF'],
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
  const [dates, setDates] = useState<string[]>([])
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [serverResult, setServerResult] = useState<ServerResult | null>(null)
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  function handleFile(file?: File | null) {
    if (!file) return
    setParseError(null)
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: ({ data, meta }) => {
        const headers = (meta.fields ?? []).map((h) => h.trim())
        const dateCols = headers.filter(isDateHeader)
        const idCol = headers.find((h) => !isDateHeader(h)) ?? headers[0]
        if (dateCols.length === 0) {
          setParseError('No date columns found. Headers must be the employee column plus one YYYY-MM-DD column per day.')
          setView(VIEW.UPLOAD)
          return
        }
        const parsed: ParsedRow[] = (data as Record<string, string>[]).map((raw) => {
          const cells: Record<string, string> = {}
          let cellErrors = 0
          for (const d of dateCols) {
            const v = (raw[d] ?? '').trim()
            cells[d] = v
            if (parseCell(v).kind === 'error') cellErrors++
          }
          return { identifier: (raw[idCol] ?? '').trim(), cells, cellErrors }
        })
        setDates(dateCols)
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
      const res = await fetch('/api/schedule/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dates, rows: rows.map((r) => ({ identifier: r.identifier, cells: r.cells })) }),
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
    setRows([]); setDates([]); setServerResult(null); setParseError(null); setView(VIEW.UPLOAD)
  }

  const totalCellErrors = rows.reduce((a, r) => a + r.cellErrors, 0)
  const totalShifts = rows.reduce((a, r) => a + dates.filter((d) => parseCell(r.cells[d]).kind === 'shift').length, 0)

  return (
    <>
      <style>{css}</style>
      <div className="si-root">
        <header className="si-topbar">
          <div className="si-title">Import schedule</div>
          <div className="si-right">
            <button className="si-btn ghost" onClick={downloadTemplate}>⬇ Download template (next 7 days)</button>
            <Link href="/dashboard/employees" className="si-btn ghost">Employees →</Link>
          </div>
        </header>

        <main className="si-main">
          {parseError && <div className="si-banner">{parseError}</div>}

          {view === VIEW.UPLOAD && (
            <>
              <div className="si-intro">
                <div className="si-intro-title">Upload a weekly schedule grid</div>
                <div className="si-intro-sub">
                  One CSV row per picker. First column is the employee (phone like <code>+9715XXXXXXXX</code> or their
                  employee&nbsp;number); add one column per day with a <code>YYYY-MM-DD</code> header. Each cell is a time
                  range like <code>08:00-19:00</code>, or blank / <code>OFF</code> for a day off. Re-importing a corrected
                  week updates existing shifts instead of duplicating.
                </div>
              </div>
              <div
                className={`si-drop ${drag ? 'drag' : ''}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files?.[0]) }}
              >
                <div className="si-drop-icon">📅</div>
                <div className="si-drop-title">Drop your schedule CSV here</div>
                <div className="si-drop-sub">or click to browse</div>
                <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files?.[0])} />
              </div>
            </>
          )}

          {view === VIEW.REVIEW && (
            <>
              <div className="si-stats">
                <div className="si-stat"><div className="si-stat-val">{rows.length}</div><div className="si-stat-label">Pickers</div></div>
                <div className="si-stat"><div className="si-stat-val">{dates.length}</div><div className="si-stat-label">Days</div></div>
                <div className="si-stat"><div className="si-stat-val" style={{ color: T.teal }}>{totalShifts}</div><div className="si-stat-label">Shifts</div></div>
                <div className="si-stat"><div className="si-stat-val" style={{ color: totalCellErrors ? T.red : T.inkLight }}>{totalCellErrors}</div><div className="si-stat-label">Cell errors</div></div>
              </div>

              <div className="si-grid-wrap">
                <table className="si-grid">
                  <thead>
                    <tr>
                      <th className="si-emp-col">Employee</th>
                      {dates.map((d) => <th key={d}>{dayLabel(d)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td className="si-emp-col"><span className="si-mono">{r.identifier || '—'}</span></td>
                        {dates.map((d) => {
                          const c = parseCell(r.cells[d])
                          if (c.kind === 'shift') return <td key={d}><span className="si-cell shift">{c.start.slice(0, 5)}–{c.end.slice(0, 5)}</span></td>
                          if (c.kind === 'off') return <td key={d}><span className="si-cell off">off</span></td>
                          return <td key={d} title={c.reason}><span className="si-cell err">⚠ {r.cells[d]}</span></td>
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
                <button className="si-btn primary" onClick={submit}>Import {totalShifts} shift{totalShifts === 1 ? '' : 's'} →</button>
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
              <div className="si-done-h">Schedule imported</div>
              <div className="si-done-cards">
                <div className="si-dcard"><div className="si-dcard-val" style={{ color: T.teal }}>{serverResult.added}</div><div className="si-dcard-label">Added</div></div>
                <div className="si-dcard"><div className="si-dcard-val">{serverResult.updated}</div><div className="si-dcard-label">Updated</div></div>
                <div className="si-dcard"><div className="si-dcard-val">{serverResult.removed}</div><div className="si-dcard-label">Cleared (off)</div></div>
                <div className="si-dcard"><div className="si-dcard-val">{serverResult.skipped}</div><div className="si-dcard-label">Unchanged</div></div>
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
                <Link href="/dashboard" className="si-btn secondary">Back to dashboard →</Link>
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  )
}

const css = `
*,*::before,*::after{box-sizing:border-box}
.si-root{font-family:'DM Sans',sans-serif;background:${T.surface};min-height:100vh;color:${T.ink}}
.si-topbar{background:${T.white};border-bottom:1px solid ${T.border};display:flex;align-items:center;padding:0 28px;height:56px;gap:14px;position:sticky;top:0;z-index:100}
.si-title{font-family:'Syne',sans-serif;font-size:15px;font-weight:600;color:${T.ink}}
.si-right{margin-left:auto;display:flex;align-items:center;gap:10px}
.si-main{padding:28px 32px;max-width:1100px}
.si-btn{padding:9px 16px;border-radius:8px;border:none;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.si-btn.primary{background:${T.tealMid};color:#fff}.si-btn.primary:hover{background:${T.teal}}
.si-btn.secondary{background:${T.white};color:${T.inkMid};border:1px solid ${T.border}}.si-btn.secondary:hover{border-color:${T.tealBorder};color:${T.teal}}
.si-btn.ghost{background:${T.white};color:${T.inkMid};border:1px solid ${T.border}}.si-btn.ghost:hover{border-color:${T.tealBorder};color:${T.teal}}
.si-banner{padding:12px 16px;border-radius:10px;font-size:13px;margin-bottom:16px;background:${T.redBg};border:1px solid ${T.redBorder};color:${T.red}}
.si-intro{margin-bottom:18px}
.si-intro-title{font-family:'Syne',sans-serif;font-size:20px;font-weight:600;margin-bottom:6px}
.si-intro-sub{font-size:13px;color:${T.inkLight};line-height:1.7;max-width:720px}
.si-intro-sub code{font-family:'DM Mono',monospace;font-size:12px;background:${T.tealLight};color:${T.teal};padding:1px 5px;border-radius:4px}
.si-drop{background:${T.white};border:2px dashed ${T.tealBorder};border-radius:16px;padding:56px 20px;text-align:center;cursor:pointer;transition:border-color .15s,background .15s}
.si-drop:hover,.si-drop.drag{border-color:${T.tealMid};background:${T.tealLight}}
.si-drop-icon{font-size:44px;margin-bottom:10px}
.si-drop-title{font-size:16px;font-weight:600;margin-bottom:4px}
.si-drop-sub{font-size:13px;color:${T.inkLight}}
.si-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}
.si-stat{background:${T.white};border:1px solid ${T.border};border-radius:10px;padding:14px 18px}
.si-stat-val{font-family:'Syne',sans-serif;font-size:26px;font-weight:700;line-height:1;margin-bottom:4px}
.si-stat-label{font-size:11px;color:${T.inkLight};font-weight:500}
.si-grid-wrap{background:${T.white};border:1px solid ${T.border};border-radius:12px;overflow:auto;max-height:60vh}
.si-grid{width:100%;border-collapse:collapse;font-size:12px}
.si-grid thead th{position:sticky;top:0;background:${T.surface};padding:10px 12px;text-align:left;font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${T.inkMid};border-bottom:1px solid ${T.border};white-space:nowrap}
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
.si-done{text-align:center;padding:48px 20px;max-width:680px;margin:0 auto}
.si-done-ring{width:96px;height:96px;border-radius:50%;background:${T.tealMid};display:flex;align-items:center;justify-content:center;font-size:46px;color:#fff;margin:0 auto 22px}
.si-done-h{font-family:'Syne',sans-serif;font-size:26px;font-weight:600;margin-bottom:24px}
.si-done-cards{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:24px}
.si-dcard{background:${T.white};border:1px solid ${T.border};border-radius:12px;padding:16px 22px;min-width:96px}
.si-dcard.err{border-color:${T.redBorder};background:${T.redBg}}
.si-dcard-val{font-family:'Syne',sans-serif;font-size:24px;font-weight:700;line-height:1;margin-bottom:4px}
.si-dcard-label{font-size:11px;color:${T.inkLight};text-transform:uppercase;letter-spacing:.05em;font-weight:600}
.si-errlist{text-align:left;background:${T.redBg};border:1px solid ${T.redBorder};border-radius:12px;padding:16px 18px;margin-bottom:24px}
.si-errlist-title{font-size:12px;font-weight:700;color:${T.red};text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}
.si-errrow{font-size:12px;color:${T.ink};line-height:1.6;margin-bottom:4px}
`
