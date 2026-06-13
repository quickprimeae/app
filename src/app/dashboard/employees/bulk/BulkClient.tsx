'use client'
// src/app/dashboard/employees/bulk/BulkClient.tsx
// CSV roster upload: parse + validate client-side, then POST valid rows to
// /api/employees/bulk (real inserts + WhatsApp invites). Shows per-row results.

import { useState, useRef } from 'react'
import Link from 'next/link'
import Papa from 'papaparse'
import { normalizePhone } from '@/lib/phone'

const T = {
  tealDark: '#085041', teal: '#0F6E56', tealMid: '#1D9E75', tealLight: '#E1F5EE',
  tealBorder: '#9FE1CB', tealText: '#5DCAA5', ink: '#0f1a15', inkMid: '#374940',
  inkLight: '#6b7c75', surface: '#f5f8f6', white: '#ffffff', border: '#e0ebe6',
  amber: '#854F0B', amberBg: '#FAEEDA', amberBorder: '#FAC775', red: '#A32D2D',
  redBg: '#FCEBEB', redBorder: '#F7C1C1', green: '#085041', greenBg: '#E1F5EE',
}

const COLUMNS = [
  { key: 'name', required: true, desc: 'Full name (split on first space)' },
  { key: 'phone', required: true, desc: '05XXXXXXXX or +9715XXXXXXXX' },
  { key: 'nationality', required: false, desc: 'e.g. Philippines' },
  { key: 'shift_type', required: true, desc: '8h or 10h' },
  { key: 'monthly_salary', required: true, desc: 'Number (AED/month)' },
  { key: 'shift_days', required: false, desc: 'e.g. Mon-Fri' },
  { key: 'joining_date', required: true, desc: 'YYYY-MM-DD or DD/MM/YYYY' },
  { key: 'location', required: true, desc: 'Exact DB location name' },
  { key: 'supervisor', required: false, desc: 'Supervisor name' },
  { key: 'vendor', required: false, desc: 'Talabat or Deliveroo' },
  { key: 'branch', required: false, desc: 'Branch label (reference)' },
]
const SAMPLE_ROWS = [
  ['Ahmed Al Rashidi', '501234567', 'UAE', '8h', '2080', 'Mon-Sat', '2026-06-01', 'Carrefour — Mall of the Emirates', 'Ops Admin', 'Talabat', 'MOE'],
  ['Maria Santos', '509876543', 'Philippines', '10h', '2600', 'Mon-Sat', '2026-06-01', 'Spinneys — JBR', 'Ops Admin', 'Deliveroo', 'JBR'],
]

type Row = Record<string, string> & { _row: number; _errors: string[]; _status: 'valid' | 'error' }

const clean = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ')

// Accepts YYYY-MM-DD or DD/MM/YYYY.
function validDate(raw: string): boolean {
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return false
  const dd = Number(m[1]), mm = Number(m[2])
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31
}

// Tolerant validation that mirrors the server: trims/collapses spaces,
// case-insensitive matching, and accepts any phone format the normalizer takes.
// (Duplicate detection happens server-side against the DB, reported as "skipped".)
function validateRow(row: Record<string, string>): string[] {
  const errors: string[] = []
  if (!clean(row.name)) errors.push('Missing name')

  const rawPhone = clean(row.phone)
  if (!rawPhone) errors.push('Missing phone')
  else if (!normalizePhone(rawPhone)) errors.push('Invalid UAE mobile (e.g. 05XXXXXXXX or +9715XXXXXXXX)')

  const st = clean(row.shift_type).toLowerCase()
  if (!st) errors.push('Missing shift_type')
  else if (st !== '8h' && st !== '10h') errors.push('shift_type must be 8h or 10h')

  const salary = clean(row.monthly_salary)
  if (!salary) errors.push('Missing monthly_salary')
  else if (isNaN(parseFloat(salary)) || parseFloat(salary) <= 0) errors.push('monthly_salary must be a positive number')

  const jd = clean(row.joining_date)
  if (!jd) errors.push('Missing joining_date')
  else if (!validDate(jd)) errors.push('joining_date must be YYYY-MM-DD or DD/MM/YYYY')

  if (!clean(row.location)) errors.push('Missing location')

  const vendor = clean(row.vendor).toLowerCase()
  if (vendor && vendor !== 'talabat' && vendor !== 'deliveroo') errors.push('vendor must be Talabat or Deliveroo')
  return errors
}

function downloadTemplate() {
  const header = COLUMNS.map((c) => c.key).join(',')
  const rows = SAMPLE_ROWS.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([`${header}\n${rows}`], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'opspro_employee_template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

const VIEW = { UPLOAD: 'upload', REVIEW: 'review', UPLOADING: 'uploading', DONE: 'done' } as const
type View = (typeof VIEW)[keyof typeof VIEW]

export default function BulkClient() {
  const [view, setView] = useState<View>(VIEW.UPLOAD)
  const [rows, setRows] = useState<Row[]>([])
  const [filter, setFilter] = useState<'all' | 'valid' | 'errors'>('all')
  const [drag, setDrag] = useState(false)
  const [serverResult, setServerResult] = useState<{ added: number; skipped: number; errors: number; results: any[] } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  function handleFile(file?: File | null) {
    if (!file) return
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
      complete: ({ data }) => {
        const parsed = (data as Record<string, string>[]).map((raw, i) => {
          const errs = validateRow(raw)
          return { ...raw, _row: i + 2, _errors: errs, _status: errs.length ? 'error' : 'valid' } as Row
        })
        setRows(parsed)
        setView(VIEW.REVIEW)
      },
      error: () => alert("Could not parse file. Make sure it's a valid CSV."),
    })
  }

  async function submitUpload() {
    const valid = rows.filter((r) => r._status === 'valid')
    if (valid.length === 0) return
    setView(VIEW.UPLOADING)
    const payload = valid.map((r) => ({
      name: r.name, phone: r.phone, nationality: r.nationality,
      shift_type: r.shift_type, monthly_salary: r.monthly_salary, shift_days: r.shift_days,
      joining_date: r.joining_date, location: r.location, supervisor: r.supervisor,
      vendor: r.vendor, branch: r.branch,
    }))
    try {
      const res = await fetch('/api/employees/bulk', {
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

  return (
    <>
      <style>{css}</style>
      <div className="bu-root">
        <div className="bu-layout">
          <aside className="bu-sidebar">
            <Link href="/dashboard" className="bu-logo">OPSPRO</Link>
            <div className="bu-sidebar-title">Bulk<br />onboarding</div>
            <div className="bu-sidebar-sub">Upload your entire workforce in a single CSV.</div>
            <div className="bu-mode-btns">
              <Link href="/dashboard/employees/new" className="bu-mode-btn"><span className="bu-mode-icon">👤</span> Single employee</Link>
              <button className="bu-mode-btn active"><span className="bu-mode-icon">📋</span> Bulk CSV upload</button>
            </div>
            <div className="bu-col-list">
              <div className="bu-col-title">CSV column reference</div>
              {COLUMNS.map((c) => (
                <div key={c.key} className="bu-col-item"><span className="bu-col-key">{c.key}</span>{c.required && <span className="bu-col-req">req</span>}<span className="bu-col-desc">{c.desc}</span></div>
              ))}
            </div>
            <div className="bu-sidebar-footer">Max 500 rows per file. Location must match an existing location name exactly.</div>
          </aside>

          <main className="bu-main">
            {view === VIEW.UPLOAD && (
              <>
                <div className="bu-page-header">
                  <div className="bu-page-tag">Bulk upload</div>
                  <h1 className="bu-page-h">Upload your <em>employee roster</em></h1>
                  <p className="bu-page-sub">Download the template, fill it in, then upload. Every row is validated before anything is saved.</p>
                </div>
                <div className="bu-template-box">
                  <div>
                    <div className="bu-template-label">Step 1 — Get the template</div>
                    <div className="bu-template-title">opspro_employee_template.csv</div>
                    <div className="bu-template-desc">All required columns with sample rows. Delete the samples before uploading.</div>
                  </div>
                  <button className="bu-dl-btn" onClick={downloadTemplate}>⬇ Download template</button>
                </div>
                <div className="bu-info teal"><span className="bu-info-icon">💡</span><div><strong>Tip:</strong> Don&apos;t rename or reorder column headers. <code style={{ fontFamily: 'monospace', fontSize: 12 }}>phone</code> is the UAE mobile without country code (e.g. 501234567); <code style={{ fontFamily: 'monospace', fontSize: 12 }}>hourly rate</code> is derived from <code style={{ fontFamily: 'monospace', fontSize: 12 }}>monthly_salary</code> ÷ 26 ÷ shift hours. Pickers inherit their location&apos;s shift times.</div></div>
                <div className={`bu-drop-zone ${drag ? 'drag' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]) }} onClick={() => fileRef.current?.click()}>
                  <div className="bu-drop-icon">📂</div>
                  <div className="bu-drop-title">Drop your CSV here</div>
                  <div className="bu-drop-sub">or <strong>click to browse</strong></div>
                  <div className="bu-drop-formats">.csv only · max 500 rows</div>
                  <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files?.[0])} />
                </div>
                <div className="bu-info amber"><span className="bu-info-icon">⚠️</span><div><strong>Photos not included.</strong> Add reference photos per employee after import. Employees without a photo can still clock in (selfie checks skipped).</div></div>
              </>
            )}

            {view === VIEW.REVIEW && (
              <>
                <div className="bu-page-header">
                  <div className="bu-page-tag">Step 2 — Review before importing</div>
                  <h1 className="bu-page-h">{errorCount === 0 ? <><em>{rows.length} employees</em> ready</> : <><em>{validCount} valid</em>, {errorCount} need fixing</>}</h1>
                </div>
                {errorCount > 0 && <div className="bu-info red"><span className="bu-info-icon">❌</span><div><strong>{errorCount} row{errorCount > 1 ? 's' : ''}</strong> will be skipped. Only the <strong>{validCount} valid rows</strong> import if you proceed.</div></div>}
                {errorCount === 0 && <div className="bu-info teal"><span className="bu-info-icon">✅</span><div>All <strong>{rows.length} rows</strong> passed validation.</div></div>}
                <div className="bu-results-bar">
                  <div className="bu-results-stats">
                    <div className="bu-stat-pill total">📋 {rows.length} total</div>
                    <div className="bu-stat-pill valid">✓ {validCount} valid</div>
                    {errorCount > 0 && <div className="bu-stat-pill error">✗ {errorCount} errors</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div className="bu-filter-tabs">{([['all', 'All'], ['valid', 'Valid'], ['errors', 'Errors']] as const).map(([v, l]) => <button key={v} className={`bu-filter-tab ${filter === v ? 'active' : ''}`} onClick={() => setFilter(v)}>{l}</button>)}</div>
                    <button className="bu-btn secondary" onClick={() => { setRows([]); setView(VIEW.UPLOAD); setFilter('all') }}>↩ Re-upload</button>
                  </div>
                </div>
                <div className="bu-table-wrap">
                  <table className="bu-table">
                    <thead><tr><th>#</th><th>Status</th><th>Name</th><th>Phone</th><th>Shift</th><th>Monthly salary</th><th>Location</th><th>Vendor</th><th>Joining</th></tr></thead>
                    <tbody>
                      {displayRows.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: T.inkLight }}>No rows match this filter.</td></tr>}
                      {displayRows.map((row, i) => (
                        <tr key={i} className={row._status === 'error' ? 'row-error' : ''}>
                          <td><span className="bu-row-num">Row {row._row}</span></td>
                          <td>{row._status === 'valid' ? <span className="bu-status-dot ok">✓ Valid</span> : <div><span className="bu-status-dot err">✗ Error</span><div className="bu-err-list">{row._errors.map((e, j) => <div key={j} className="bu-err-msg">→ {e}</div>)}</div></div>}</td>
                          <td><strong>{row.name || <span style={{ color: T.red }}>—</span>}</strong></td>
                          <td className="mono">{row.phone || <span style={{ color: T.red }}>—</span>}</td>
                          <td className="mono">{row.shift_type || <span style={{ color: T.red }}>—</span>}</td>
                          <td className="mono">{row.monthly_salary ? `AED ${row.monthly_salary}` : <span style={{ color: T.red }}>—</span>}</td>
                          <td style={{ fontSize: 12, maxWidth: 160 }}>{row.location || <span style={{ color: T.red }}>—</span>}</td>
                          <td className="mono">{row.vendor || <span style={{ color: T.inkLight }}>—</span>}</td>
                          <td className="mono">{row.joining_date || <span style={{ color: T.red }}>—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <button className="bu-btn primary" disabled={validCount === 0} onClick={submitUpload}>✓ Import {validCount} employee{validCount !== 1 ? 's' : ''}</button>
                  {errorCount > 0 && <button className="bu-btn secondary" onClick={() => { setRows([]); setView(VIEW.UPLOAD) }}>Fix errors & re-upload</button>}
                </div>
              </>
            )}

            {view === VIEW.UPLOADING && (
              <div className="bu-uploading">
                <div className="bu-spinner" />
                <div className="bu-uploading-title">Importing employees…</div>
                <div className="bu-uploading-sub">Creating profiles and sending PIN setup invites.</div>
              </div>
            )}

            {view === VIEW.DONE && serverResult && (
              <div className="bu-success">
                <div className="bu-success-ring">✓</div>
                <div className="bu-success-h"><em>{serverResult.added} added</em>{serverResult.skipped > 0 ? `, ${serverResult.skipped} skipped` : ''}</div>
                <div className="bu-success-sub">Each newly added employee receives a WhatsApp link to set their 6-digit PIN. Rows whose phone already exists are skipped, so you can re-upload a growing master sheet safely.</div>
                <div className="bu-success-cards">
                  <div className="bu-success-card"><div className="bu-success-card-val">{serverResult.added}</div><div className="bu-success-card-label">Added</div></div>
                  <div className="bu-success-card"><div className="bu-success-card-val">{serverResult.results.filter((r) => r.whatsapp_sent).length}</div><div className="bu-success-card-label">Invites sent</div></div>
                  <div className="bu-success-card"><div className="bu-success-card-val">{serverResult.skipped}</div><div className="bu-success-card-label">Skipped (exists)</div></div>
                  {serverResult.errors > 0 && <div className="bu-success-card" style={{ borderColor: T.redBorder, background: T.redBg }}><div className="bu-success-card-val" style={{ color: T.red }}>{serverResult.errors}</div><div className="bu-success-card-label" style={{ color: T.red }}>Errors</div></div>}
                </div>
                {serverErrors.length > 0 && (
                  <div className="bu-info red" style={{ maxWidth: 520, textAlign: 'left' }}>
                    <span className="bu-info-icon">❌</span>
                    <div><strong>Rows with errors:</strong>{serverErrors.slice(0, 10).map((r, i) => <div key={i}>Row {r.row}{r.phone ? ` (${r.phone})` : ''}: {r.reason}</div>)}</div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12 }}>
                  <button className="bu-btn primary" onClick={() => { setRows([]); setView(VIEW.UPLOAD); setFilter('all'); setServerResult(null) }}>Upload another file</button>
                  <Link href="/dashboard/employees" className="bu-btn secondary">View roster →</Link>
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
.bu-root{font-family:'DM Sans',sans-serif;background:${T.surface};min-height:100vh;color:${T.ink}}
.bu-layout{display:grid;grid-template-columns:260px 1fr;min-height:100vh}
.bu-sidebar{background:${T.tealDark};padding:36px 28px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
.bu-logo{font-family:'DM Mono',monospace;font-size:13px;color:${T.tealText};letter-spacing:.06em;margin-bottom:36px;text-decoration:none}
.bu-sidebar-title{font-family:'Fraunces',serif;font-size:22px;font-weight:300;color:#fff;line-height:1.3;margin-bottom:8px}
.bu-sidebar-sub{font-size:12px;color:${T.tealText};line-height:1.6;margin-bottom:32px}
.bu-mode-btns{display:flex;flex-direction:column;gap:8px;margin-bottom:32px}
.bu-mode-btn{padding:12px 14px;border-radius:10px;border:none;background:rgba(255,255,255,.08);color:rgba(255,255,255,.6);font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;cursor:pointer;text-align:left;display:flex;align-items:center;gap:10px;transition:background .15s,color .15s;text-decoration:none}
.bu-mode-btn:hover{background:rgba(255,255,255,.12);color:#fff}
.bu-mode-btn.active{background:rgba(255,255,255,.15);color:#fff}
.bu-mode-icon{font-size:16px}
.bu-col-list{flex:1;overflow-y:auto}
.bu-col-title{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.4);margin-bottom:10px}
.bu-col-item{display:flex;align-items:baseline;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.bu-col-key{font-family:'DM Mono',monospace;font-size:11px;color:${T.tealText};flex-shrink:0}
.bu-col-req{font-size:10px;color:#e87777;flex-shrink:0}
.bu-col-desc{font-size:10px;color:rgba(255,255,255,.3);line-height:1.4}
.bu-sidebar-footer{padding-top:20px;border-top:1px solid rgba(255,255,255,.08);font-size:11px;color:rgba(255,255,255,.25);line-height:1.5}
.bu-main{padding:48px 52px}
.bu-page-header{margin-bottom:36px}
.bu-page-tag{font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:${T.tealMid};margin-bottom:8px}
.bu-page-h{font-family:'Fraunces',serif;font-size:34px;font-weight:300;color:${T.ink};line-height:1.15;margin-bottom:8px}
.bu-page-h em{font-style:italic;color:${T.tealMid}}
.bu-page-sub{font-size:14px;color:${T.inkLight};line-height:1.6}
.bu-template-box{background:${T.white};border:1px solid ${T.border};border-radius:16px;padding:28px 32px;margin-bottom:28px;display:flex;align-items:center;justify-content:space-between;gap:24px}
.bu-template-label{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${T.tealMid};margin-bottom:6px}
.bu-template-title{font-size:18px;font-weight:600;color:${T.ink};margin-bottom:4px}
.bu-template-desc{font-size:13px;color:${T.inkLight};line-height:1.5}
.bu-dl-btn{display:flex;align-items:center;gap:8px;padding:13px 22px;border-radius:10px;border:1.5px solid ${T.tealMid};background:${T.tealLight};color:${T.teal};font-family:'DM Sans',sans-serif;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0}
.bu-dl-btn:hover{background:#c8ecdf;border-color:${T.teal}}
.bu-drop-zone{border:2px dashed ${T.tealBorder};border-radius:16px;background:${T.white};padding:52px 40px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;cursor:pointer;transition:border-color .15s,background .15s;margin-bottom:28px;gap:12px}
.bu-drop-zone:hover,.bu-drop-zone.drag{border-color:${T.tealMid};background:${T.tealLight}}
.bu-drop-icon{font-size:44px}
.bu-drop-title{font-size:18px;font-weight:600;color:${T.ink}}
.bu-drop-sub{font-size:13px;color:${T.inkLight}}
.bu-drop-sub strong{color:${T.teal}}
.bu-drop-formats{font-family:'DM Mono',monospace;font-size:11px;color:${T.inkLight};background:${T.surface};padding:4px 10px;border-radius:6px}
.bu-results-bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px}
.bu-results-stats{display:flex;gap:12px}
.bu-stat-pill{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:20px;font-size:12px;font-weight:600}
.bu-stat-pill.total{background:${T.surface};color:${T.inkMid};border:1px solid ${T.border}}
.bu-stat-pill.valid{background:${T.greenBg};color:${T.green};border:1px solid ${T.tealBorder}}
.bu-stat-pill.error{background:${T.redBg};color:${T.red};border:1px solid ${T.redBorder}}
.bu-table-wrap{border:1px solid ${T.border};border-radius:14px;overflow:hidden;margin-bottom:28px;background:${T.white}}
.bu-table{width:100%;border-collapse:collapse;font-size:13px}
.bu-table thead tr{background:${T.tealDark}}
.bu-table thead th{padding:11px 14px;text-align:left;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${T.tealText};white-space:nowrap;font-family:'DM Mono',monospace}
.bu-table tbody tr{border-bottom:1px solid ${T.border}}
.bu-table tbody tr:last-child{border-bottom:none}
.bu-table tbody tr:hover{background:${T.surface}}
.bu-table tbody tr.row-error{background:#fff8f8}
.bu-table td{padding:11px 14px;color:${T.ink};vertical-align:middle}
.bu-table td.mono{font-family:'DM Mono',monospace;font-size:12px;color:${T.inkMid}}
.bu-row-num{font-family:'DM Mono',monospace;font-size:11px;color:${T.inkLight}}
.bu-status-dot{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:3px 8px;border-radius:20px;white-space:nowrap}
.bu-status-dot.ok{background:${T.greenBg};color:${T.green}}
.bu-status-dot.err{background:${T.redBg};color:${T.red}}
.bu-err-list{display:flex;flex-direction:column;gap:3px;margin-top:3px}
.bu-err-msg{font-size:11px;color:${T.red};line-height:1.3}
.bu-btn{padding:12px 22px;border-radius:10px;border:none;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:opacity .1s,background .15s;text-decoration:none}
.bu-btn.primary{background:${T.tealMid};color:#fff}.bu-btn.primary:hover{background:${T.teal}}
.bu-btn.primary:disabled{opacity:.4;cursor:not-allowed}
.bu-btn.secondary{background:${T.white};color:${T.inkMid};border:1.5px solid ${T.border}}.bu-btn.secondary:hover{border-color:${T.tealBorder};color:${T.teal}}
.bu-info{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border-radius:10px;margin-bottom:20px;font-size:13px;line-height:1.6}
.bu-info.teal{background:${T.tealLight};border:1px solid ${T.tealBorder};color:${T.teal}}
.bu-info.amber{background:${T.amberBg};border:1px solid ${T.amberBorder};color:${T.amber}}
.bu-info.red{background:${T.redBg};border:1px solid ${T.redBorder};color:${T.red}}
.bu-info strong{font-weight:600}
.bu-info-icon{font-size:17px;flex-shrink:0;margin-top:1px}
.bu-success{display:flex;flex-direction:column;align-items:center;text-align:center;padding:60px 40px}
.bu-success-ring{width:110px;height:110px;border-radius:50%;background:${T.tealMid};display:flex;align-items:center;justify-content:center;font-size:52px;color:#fff;margin-bottom:28px;animation:popIn .35s cubic-bezier(.175,.885,.32,1.275)}
@keyframes popIn{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}
.bu-success-h{font-family:'Fraunces',serif;font-size:30px;font-weight:300;color:${T.ink};margin-bottom:10px}
.bu-success-h em{font-style:italic;color:${T.tealMid}}
.bu-success-sub{font-size:14px;color:${T.inkLight};line-height:1.6;max-width:420px;margin-bottom:36px}
.bu-success-cards{display:flex;gap:16px;margin-bottom:36px}
.bu-success-card{background:${T.white};border:1px solid ${T.border};border-radius:12px;padding:18px 28px;text-align:center}
.bu-success-card-val{font-family:'DM Mono',monospace;font-size:28px;font-weight:500;color:${T.tealDark};margin-bottom:4px}
.bu-success-card-label{font-size:11px;font-weight:600;color:${T.inkLight};text-transform:uppercase;letter-spacing:.06em}
.bu-uploading{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 40px;text-align:center;gap:20px}
.bu-spinner{width:52px;height:52px;border:3px solid ${T.tealLight};border-top-color:${T.tealMid};border-radius:50%;animation:spin .75s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.bu-uploading-title{font-size:18px;font-weight:600;color:${T.ink}}
.bu-uploading-sub{font-size:13px;color:${T.inkLight}}
.bu-filter-tabs{display:flex;gap:4px;background:${T.surface};border-radius:10px;padding:4px;border:1px solid ${T.border}}
.bu-filter-tab{padding:6px 14px;border-radius:7px;border:none;background:none;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;color:${T.inkLight};cursor:pointer}
.bu-filter-tab.active{background:${T.white};color:${T.teal};box-shadow:0 1px 3px rgba(0,0,0,.07)}
`
