'use client'
// src/app/dashboard/locations/bulk/LocationsBulkClient.tsx
// Bulk location upload, mirroring the employee bulk importer UX: download a
// template, upload a file or paste CSV, preview + validate every row, then
// import with per-row success/failure results. Inserts go through
// /api/locations/bulk (client_id null - locations are client-optional). Blank
// optional cells fall back to LOCATION_DEFAULTS, the SAME source the single
// Add-location form uses, so the two paths never drift.

import { useState, useRef } from 'react'
import Link from 'next/link'
import Papa from 'papaparse'

import { T } from '@/lib/theme'
import { LOCATION_DEFAULTS, LAT_RANGE, LNG_RANGE } from '@/lib/locations-defaults'

const COLUMNS = [
  { key: 'name', required: true, desc: 'Store / location name' },
  { key: 'latitude', required: true, desc: `Number ${LAT_RANGE.min}..${LAT_RANGE.max}` },
  { key: 'longitude', required: true, desc: `Number ${LNG_RANGE.min}..${LNG_RANGE.max}` },
  { key: 'chain', required: false, desc: 'e.g. Carrefour (optional)' },
  { key: 'area', required: false, desc: 'e.g. Dubai Marina (optional)' },
  { key: 'address', required: false, desc: 'Street address (optional)' },
  { key: 'geofence_m', required: false, desc: `Default ${LOCATION_DEFAULTS.geofence_m}` },
  { key: 'store_days', required: false, desc: `Default ${LOCATION_DEFAULTS.store_days}` },
  { key: 'store_start', required: false, desc: `Default ${LOCATION_DEFAULTS.store_start}` },
  { key: 'store_end', required: false, desc: `Default ${LOCATION_DEFAULTS.store_end}` },
]
const TEMPLATE_HEADER = COLUMNS.map((c) => c.key).join(',')

// Real-looking Dubai coordinates; NO client column, NO employee codes.
const SAMPLE_ROWS = [
  ['Carrefour Marina Mall', '25.0763', '55.1393', 'Carrefour', 'Dubai Marina', 'Marina Mall, Dubai', '150', 'Mon-Sun', '08:00', '23:59'],
  ['Lulu Al Barsha', '25.1115', '55.1996', 'Lulu', 'Al Barsha', 'Al Barsha 1, Dubai', '200', 'Mon-Sat', '09:00', '22:00'],
]

type Row = Record<string, string> & { _row: number; _errors: string[]; _status: 'valid' | 'error' }

const clean = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ')

// Effective values shown in the preview (blanks resolved to the shared defaults).
function effective(row: Record<string, string>) {
  return {
    geofence: clean(row.geofence_m) || String(LOCATION_DEFAULTS.geofence_m),
    days: clean(row.store_days) || LOCATION_DEFAULTS.store_days,
    start: clean(row.store_start) || LOCATION_DEFAULTS.store_start,
    end: clean(row.store_end) || LOCATION_DEFAULTS.store_end,
  }
}

function validateRow(row: Record<string, string>): string[] {
  const errors: string[] = []
  if (!clean(row.name)) errors.push('Missing name')

  const lat = clean(row.latitude)
  if (!lat) errors.push('Missing latitude')
  else if (isNaN(parseFloat(lat)) || parseFloat(lat) < LAT_RANGE.min || parseFloat(lat) > LAT_RANGE.max)
    errors.push(`latitude must be ${LAT_RANGE.min}..${LAT_RANGE.max}`)

  const lng = clean(row.longitude)
  if (!lng) errors.push('Missing longitude')
  else if (isNaN(parseFloat(lng)) || parseFloat(lng) < LNG_RANGE.min || parseFloat(lng) > LNG_RANGE.max)
    errors.push(`longitude must be ${LNG_RANGE.min}..${LNG_RANGE.max}`)

  const g = clean(row.geofence_m)
  if (g && (isNaN(parseFloat(g)) || parseFloat(g) <= 0)) errors.push('geofence_m must be a positive number')
  return errors
}

function downloadTemplate() {
  const rows = SAMPLE_ROWS.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([`${TEMPLATE_HEADER}\n${rows}`], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'opspro_locations_template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

const VIEW = { UPLOAD: 'upload', REVIEW: 'review', UPLOADING: 'uploading', DONE: 'done' } as const
type View = (typeof VIEW)[keyof typeof VIEW]

type ServerResult = { added: number; errors: number; results: { row: number; name?: string; status: string; reason?: string }[] }

export default function LocationsBulkClient() {
  const [view, setView] = useState<View>(VIEW.UPLOAD)
  const [rows, setRows] = useState<Row[]>([])
  const [filter, setFilter] = useState<'all' | 'valid' | 'errors'>('all')
  const [drag, setDrag] = useState(false)
  const [paste, setPaste] = useState('')
  const [serverResult, setServerResult] = useState<ServerResult | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  function ingest(parsed: Record<string, string>[]) {
    const out = parsed.map((raw, i) => {
      const errs = validateRow(raw)
      return { ...raw, _row: i + 2, _errors: errs, _status: errs.length ? 'error' : 'valid' } as Row
    })
    setRows(out)
    setView(VIEW.REVIEW)
  }

  function handleFile(file?: File | null) {
    if (!file) return
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
      complete: ({ data }) => ingest(data as Record<string, string>[]),
      error: () => alert("Could not parse file. Make sure it's a valid CSV."),
    })
  }

  function handlePaste() {
    const text = paste.trim()
    if (!text) return
    const { data } = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
    })
    ingest(data)
  }

  async function submitUpload() {
    const valid = rows.filter((r) => r._status === 'valid')
    if (valid.length === 0) return
    setView(VIEW.UPLOADING)
    const payload = valid.map((r) => ({
      name: r.name, latitude: r.latitude, longitude: r.longitude,
      chain: r.chain, area: r.area, address: r.address,
      geofence_m: r.geofence_m, store_days: r.store_days,
      store_start: r.store_start, store_end: r.store_end,
    }))
    try {
      const res = await fetch('/api/locations/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: payload }),
      })
      const body = await res.json()
      if (!res.ok) { alert(body.error || 'Import failed'); setView(VIEW.REVIEW); return }
      setServerResult(body)
      setView(VIEW.DONE)
    } catch {
      alert('Network error during import.')
      setView(VIEW.REVIEW)
    }
  }

  const validCount = rows.filter((r) => r._status === 'valid').length
  const errorCount = rows.filter((r) => r._status === 'error').length
  const displayRows = rows.filter((r) => (filter === 'valid' ? r._status === 'valid' : filter === 'errors' ? r._status === 'error' : true))
  const serverErrors = (serverResult?.results ?? []).filter((r) => r.status === 'error')

  function reset() { setRows([]); setPaste(''); setFilter('all'); setServerResult(null); setView(VIEW.UPLOAD) }

  return (
    <>
      <style>{css}</style>
      <div className="lb-root">
        <div className="lb-layout">
          <aside className="lb-sidebar">
            <Link href="/dashboard/locations" className="lb-logo">← Locations</Link>
            <div className="lb-sidebar-title">Bulk location<br />upload</div>
            <div className="lb-sidebar-sub">Add many stores at once from a single CSV. Every row is validated before anything is saved.</div>
            <div className="lb-col-list">
              <div className="lb-col-title">CSV columns</div>
              {COLUMNS.map((c) => (
                <div key={c.key} className="lb-col-item"><span className="lb-col-key">{c.key}</span>{c.required && <span className="lb-col-req">req</span>}<span className="lb-col-desc">{c.desc}</span></div>
              ))}
            </div>
            <div className="lb-sidebar-footer">Max 500 rows. Mandatory: name, latitude, longitude. Blank geofence/days/times use the defaults above. No client column — locations are created client-free.</div>
          </aside>

          <main className="lb-main">
            {view === VIEW.UPLOAD && (
              <>
                <div className="lb-page-header">
                  <div className="lb-page-tag">Bulk upload</div>
                  <h1 className="lb-page-h">Upload your <em>locations</em></h1>
                  <p className="lb-page-sub">Download the template, fill it in, then upload or paste it below.</p>
                </div>
                <div className="lb-template-box">
                  <div>
                    <div className="lb-template-label">Step 1 — Get the template</div>
                    <div className="lb-template-title">opspro_locations_template.csv</div>
                    <div className="lb-template-desc">All columns with sample Dubai rows. Delete the samples before uploading.</div>
                  </div>
                  <button className="lb-dl-btn" onClick={downloadTemplate}>⬇ Download template</button>
                </div>
                <div className="lb-info"><span>💡</span><div><strong>Tip:</strong> Don&apos;t rename or reorder headers. Only <code>name</code>, <code>latitude</code>, <code>longitude</code> are required — blank <code>geofence_m</code>/<code>store_days</code>/<code>store_start</code>/<code>store_end</code> default to {LOCATION_DEFAULTS.geofence_m} / {LOCATION_DEFAULTS.store_days} / {LOCATION_DEFAULTS.store_start} / {LOCATION_DEFAULTS.store_end}.</div></div>
                <div className={`lb-drop ${drag ? 'drag' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]) }} onClick={() => fileRef.current?.click()}>
                  <div className="lb-drop-icon">📂</div>
                  <div className="lb-drop-title">Drop your CSV here</div>
                  <div className="lb-drop-sub">or <strong>click to browse</strong></div>
                  <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files?.[0])} />
                </div>
                <div className="lb-paste-block">
                  <div className="lb-paste-label">…or paste CSV rows (including the header)</div>
                  <textarea className="lb-paste" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={`${TEMPLATE_HEADER}\nDubai Mall Store,25.1972,55.2796,...`} />
                  <button className="lb-btn primary" disabled={!paste.trim()} onClick={handlePaste}>Parse pasted CSV</button>
                </div>
              </>
            )}

            {view === VIEW.REVIEW && (
              <>
                <div className="lb-page-header">
                  <div className="lb-page-tag">Step 2 — Review before importing</div>
                  <h1 className="lb-page-h">{errorCount === 0 ? <><em>{rows.length} locations</em> ready</> : <><em>{validCount} valid</em>, {errorCount} need fixing</>}</h1>
                </div>
                {errorCount > 0
                  ? <div className="lb-info red"><span>❌</span><div><strong>{errorCount} row{errorCount > 1 ? 's' : ''}</strong> will be skipped. Only the <strong>{validCount} valid rows</strong> import if you proceed.</div></div>
                  : <div className="lb-info teal"><span>✅</span><div>All <strong>{rows.length} rows</strong> passed validation.</div></div>}
                <div className="lb-results-bar">
                  <div className="lb-stats">
                    <div className="lb-pill total">📋 {rows.length} total</div>
                    <div className="lb-pill valid">✓ {validCount} valid</div>
                    {errorCount > 0 && <div className="lb-pill error">✗ {errorCount} errors</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div className="lb-tabs">{([['all', 'All'], ['valid', 'Valid'], ['errors', 'Errors']] as const).map(([v, l]) => <button key={v} className={`lb-tab ${filter === v ? 'active' : ''}`} onClick={() => setFilter(v)}>{l}</button>)}</div>
                    <button className="lb-btn ghost" onClick={reset}>↩ Re-upload</button>
                  </div>
                </div>
                <div className="lb-table-wrap">
                  <table className="lb-table">
                    <thead><tr><th>#</th><th>Status</th><th>Name</th><th>Lat</th><th>Lng</th><th>Geofence</th><th>Days</th><th>Window</th><th>Area</th></tr></thead>
                    <tbody>
                      {displayRows.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: T.dim }}>No rows match this filter.</td></tr>}
                      {displayRows.map((row, i) => {
                        const e = effective(row)
                        return (
                          <tr key={i} className={row._status === 'error' ? 'row-error' : ''}>
                            <td><span className="lb-rownum">Row {row._row}</span></td>
                            <td>{row._status === 'valid' ? <span className="lb-dot ok">✓ Valid</span> : <div><span className="lb-dot err">✗ Error</span><div className="lb-errs">{row._errors.map((er, j) => <div key={j} className="lb-errmsg">→ {er}</div>)}</div></div>}</td>
                            <td><strong>{row.name || <span style={{ color: T.red }}>—</span>}</strong></td>
                            <td className="mono">{row.latitude || <span style={{ color: T.red }}>—</span>}</td>
                            <td className="mono">{row.longitude || <span style={{ color: T.red }}>—</span>}</td>
                            <td className="mono">{e.geofence}m</td>
                            <td className="mono">{e.days}</td>
                            <td className="mono">{e.start}–{e.end}</td>
                            <td style={{ fontSize: 12 }}>{row.area || <span style={{ color: T.dimMid }}>—</span>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <button className="lb-btn primary" disabled={validCount === 0} onClick={submitUpload}>✓ Import {validCount} location{validCount !== 1 ? 's' : ''}</button>
                  {errorCount > 0 && <button className="lb-btn ghost" onClick={reset}>Fix errors & re-upload</button>}
                </div>
              </>
            )}

            {view === VIEW.UPLOADING && (
              <div className="lb-center">
                <div className="lb-spinner" />
                <div className="lb-center-title">Importing locations…</div>
                <div className="lb-center-sub">Creating location records.</div>
              </div>
            )}

            {view === VIEW.DONE && serverResult && (
              <div className="lb-center">
                <div className="lb-success-ring">✓</div>
                <div className="lb-success-h"><em>{serverResult.added} added</em>{serverResult.errors > 0 ? `, ${serverResult.errors} failed` : ''}</div>
                <div className="lb-success-sub">Locations are created and ready. Assign pickers and adjust geofences from the Locations page.</div>
                <div className="lb-success-cards">
                  <div className="lb-success-card"><div className="lb-success-card-val">{serverResult.added}</div><div className="lb-success-card-label">Added</div></div>
                  {serverResult.errors > 0 && <div className="lb-success-card err"><div className="lb-success-card-val" style={{ color: T.red }}>{serverResult.errors}</div><div className="lb-success-card-label" style={{ color: T.red }}>Failed</div></div>}
                </div>
                {serverErrors.length > 0 && (
                  <div className="lb-info red" style={{ maxWidth: 520, textAlign: 'left' }}>
                    <span>❌</span>
                    <div><strong>Rows with errors:</strong>{serverErrors.slice(0, 10).map((r, i) => <div key={i}>Row {r.row}{r.name ? ` (${r.name})` : ''}: {r.reason}</div>)}</div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12 }}>
                  <Link href="/dashboard/locations" className="lb-btn primary">View locations →</Link>
                  <button className="lb-btn ghost" onClick={reset}>Upload another file</button>
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
.lb-root{font-family:var(--font-jakarta),sans-serif;background:${T.bg};min-height:100vh;color:${T.white}}
.lb-layout{display:grid;grid-template-columns:300px 1fr;min-height:100vh}
.lb-sidebar{background:${T.bgCard};border-right:1px solid ${T.border};padding:28px 24px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow-y:auto}
.lb-logo{font-family:'DM Mono',monospace;font-size:12px;color:${T.tealBright};letter-spacing:.04em;margin-bottom:28px;text-decoration:none}
.lb-sidebar-title{font-size:21px;font-weight:600;color:${T.white};line-height:1.3;margin-bottom:8px}
.lb-sidebar-sub{font-size:12px;color:${T.dim};line-height:1.6;margin-bottom:26px}
.lb-col-list{display:flex;flex-direction:column;gap:2px;margin-bottom:22px}
.lb-col-title{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${T.dim};margin-bottom:10px}
.lb-col-item{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid ${T.border};font-size:12px}
.lb-col-key{font-family:'DM Mono',monospace;color:${T.tealText};min-width:92px}
.lb-col-req{font-size:9px;font-weight:700;color:${T.amber};background:${T.amberBg};padding:1px 5px;border-radius:4px;text-transform:uppercase}
.lb-col-desc{color:${T.dim};font-size:11px}
.lb-sidebar-footer{margin-top:auto;font-size:11px;color:${T.dimMid};line-height:1.6;padding-top:18px}
.lb-main{padding:40px 48px;overflow-y:auto;height:100vh}
.lb-page-header{margin-bottom:24px}
.lb-page-tag{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${T.tealBright};margin-bottom:8px}
.lb-page-h{font-size:30px;font-weight:300;color:${T.white};margin:0 0 6px}
.lb-page-h em{font-style:normal;font-weight:600;color:${T.tealBright}}
.lb-page-sub{font-size:14px;color:${T.dim};margin:0}
.lb-template-box{background:${T.bgCard};border:1px solid ${T.border};border-radius:14px;padding:22px 26px;margin-bottom:18px;display:flex;align-items:center;justify-content:space-between;gap:24px}
.lb-template-label{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${T.tealMid};margin-bottom:6px}
.lb-template-title{font-size:17px;font-weight:600;color:${T.white};margin-bottom:4px}
.lb-template-desc{font-size:12px;color:${T.dim}}
.lb-dl-btn{padding:11px 18px;border-radius:9px;border:none;background:${T.tealMid};color:#1B2B2B;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
.lb-dl-btn:hover{opacity:.88}
.lb-info{display:flex;gap:12px;align-items:flex-start;background:${T.bgSubtle};border:1px solid ${T.border};border-radius:10px;padding:13px 16px;font-size:13px;color:${T.whiteMid};line-height:1.5;margin-bottom:18px}
.lb-info code{font-family:'DM Mono',monospace;font-size:12px;color:${T.tealText}}
.lb-info.red{background:${T.redBg};border-color:#FCA5A5;color:${T.red}}
.lb-info.teal{background:${T.tealFaint};border-color:${T.teal};color:${T.tealBright}}
.lb-drop{border:2px dashed ${T.borderMid};border-radius:14px;padding:40px;text-align:center;cursor:pointer;transition:all .15s;margin-bottom:18px;background:${T.bgSubtle}}
.lb-drop:hover,.lb-drop.drag{border-color:${T.teal};background:${T.tealFaint}}
.lb-drop-icon{font-size:34px;margin-bottom:10px}
.lb-drop-title{font-size:15px;font-weight:600;color:${T.white};margin-bottom:4px}
.lb-drop-sub{font-size:13px;color:${T.dim}}
.lb-paste-block{display:flex;flex-direction:column;gap:10px}
.lb-paste-label{font-size:12px;font-weight:600;color:${T.dim}}
.lb-paste{width:100%;min-height:96px;background:${T.bgSubtle};border:1px solid ${T.border};border-radius:10px;padding:12px 14px;font-family:'DM Mono',monospace;font-size:12px;color:${T.white};outline:none;resize:vertical}
.lb-paste:focus{border-color:${T.teal}}
.lb-btn{padding:10px 18px;border-radius:9px;border:none;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:opacity .12s;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.lb-btn.primary{background:${T.tealMid};color:#1B2B2B;align-self:flex-start}
.lb-btn.primary:hover{opacity:.88}
.lb-btn.primary:disabled{opacity:.4;cursor:not-allowed}
.lb-btn.ghost{background:${T.bgSubtle};color:${T.whiteMid};border:1px solid ${T.border}}
.lb-btn.ghost:hover{border-color:${T.teal};color:${T.tealBright}}
.lb-results-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap}
.lb-stats{display:flex;gap:8px}
.lb-pill{font-size:12px;font-weight:600;padding:5px 11px;border-radius:16px;border:1px solid ${T.border};color:${T.dim}}
.lb-pill.valid{color:${T.tealBright};border-color:${T.teal};background:${T.tealFaint}}
.lb-pill.error{color:${T.red};border-color:#FCA5A5;background:${T.redBg}}
.lb-tabs{display:flex;gap:4px;background:${T.bgSubtle};border:1px solid ${T.border};border-radius:8px;padding:3px}
.lb-tab{padding:5px 12px;border-radius:6px;border:none;background:none;font-family:inherit;font-size:12px;font-weight:600;color:${T.dim};cursor:pointer}
.lb-tab.active{background:${T.tealFaint};color:${T.tealBright}}
.lb-table-wrap{border:1px solid ${T.border};border-radius:12px;overflow:auto;margin-bottom:18px;max-height:52vh}
.lb-table{width:100%;border-collapse:collapse;font-size:13px}
.lb-table th{position:sticky;top:0;background:${T.bgCard};text-align:left;padding:11px 14px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${T.dim};border-bottom:1px solid ${T.border};white-space:nowrap}
.lb-table td{padding:11px 14px;border-bottom:1px solid ${T.border};color:${T.whiteMid};vertical-align:top}
.lb-table tr.row-error td{background:${T.redBg}}
.lb-table .mono{font-family:'DM Mono',monospace;font-size:12px}
.lb-rownum{font-family:'DM Mono',monospace;font-size:11px;color:${T.dimMid}}
.lb-dot{font-size:11px;font-weight:700;padding:3px 8px;border-radius:10px;white-space:nowrap}
.lb-dot.ok{color:${T.tealBright};background:${T.tealFaint}}
.lb-dot.err{color:${T.red};background:${T.redBg}}
.lb-errs{margin-top:5px}
.lb-errmsg{font-size:11px;color:${T.red};line-height:1.5}
.lb-center{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:60px 20px;text-align:center}
.lb-spinner{width:38px;height:38px;border-radius:50%;border:3px solid ${T.border};border-top-color:${T.tealBright};animation:lb-spin .8s linear infinite}
@keyframes lb-spin{to{transform:rotate(360deg)}}
.lb-center-title{font-size:17px;font-weight:600;color:${T.white}}
.lb-center-sub{font-size:13px;color:${T.dim}}
.lb-success-ring{width:64px;height:64px;border-radius:50%;background:${T.tealFaint};border:2px solid ${T.teal};color:${T.tealBright};display:flex;align-items:center;justify-content:center;font-size:30px}
.lb-success-h{font-size:26px;font-weight:300;color:${T.white}}
.lb-success-h em{font-style:normal;font-weight:600;color:${T.tealBright}}
.lb-success-sub{font-size:13px;color:${T.dim};max-width:460px;line-height:1.6}
.lb-success-cards{display:flex;gap:14px;margin:6px 0}
.lb-success-card{background:${T.bgCard};border:1px solid ${T.border};border-radius:12px;padding:16px 28px;text-align:center}
.lb-success-card.err{border-color:#FCA5A5;background:${T.redBg}}
.lb-success-card-val{font-size:26px;font-weight:700;color:${T.tealBright}}
.lb-success-card-label{font-size:11px;color:${T.dim};margin-top:3px}
`
