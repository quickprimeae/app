'use client'
// src/app/dashboard/employees/invites/InvitesClient.tsx
// Pending PIN invites: every active employee who hasn't set a PIN. Ops can mint
// a fresh setup link per employee, copy it, or open a prefilled WhatsApp chat.

import { useState } from 'react'
import Link from 'next/link'
import { phoneToWaDigits } from '@/lib/phone'

const T = {
  bg: '#0a0f0d', bgCard: '#111815', bgHover: '#161e1a', bgSubtle: '#0f1712',
  border: '#1e2b24', borderMid: '#243329', teal: '#0F6E56', tealMid: '#1D9E75',
  tealBright: '#25D09A', tealText: '#5DCAA5', tealFaint: '#0d1f18',
  green: '#22c55e', greenBg: '#0d2018', amber: '#f59e0b', amberBg: '#1f1608',
  red: '#ef4444', redBg: '#1f0d0d', white: '#f0f7f4', whiteMid: '#c8ddd6',
  dim: '#6b8078', dimMid: '#4a6058',
}

export type InviteRow = {
  id: string
  name: string
  empId: string
  phone: string
  linkExpires: string | null
}

function expiryLabel(iso: string | null) {
  if (!iso) return { text: 'No active link', stale: true }
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return { text: 'Link expired', stale: true }
  const h = Math.floor(ms / 3600000)
  return { text: h >= 1 ? `Link valid ~${h}h` : 'Link valid <1h', stale: false }
}

function waMessage(firstName: string, url: string) {
  return `Hi ${firstName}, welcome to OpsPro. Set up your clock-in PIN here: ${url}\n\nThis link expires in 24 hours. Do not share it with anyone.`
}

export default function InvitesClient({ initial }: { initial: InviteRow[] }) {
  const [rows] = useState(initial)
  const [links, setLinks] = useState<Record<string, string>>({}) // employee_id -> setup_url
  const [busyId, setBusyId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function generate(row: InviteRow) {
    setBusyId(row.id)
    setError(null)
    try {
      const res = await fetch('/api/employees/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: row.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not generate link.')
        return
      }
      setLinks((m) => ({ ...m, [row.id]: data.setup_url }))
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function copy(row: InviteRow) {
    const url = links[row.id]
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(row.id)
      setTimeout(() => setCopiedId((c) => (c === row.id ? null : c)), 1500)
    } catch {
      /* clipboard blocked — the link is visible to copy manually */
    }
  }

  function waHref(row: InviteRow) {
    const digits = phoneToWaDigits(row.phone)
    return `https://wa.me/${digits}?text=${encodeURIComponent(waMessage(row.name.split(' ')[0], links[row.id]))}`
  }

  return (
    <>
      <style>{css}</style>
      <div className="iv-root">
        <header className="iv-topbar">
          <div className="iv-title">Pending PIN invites</div>
          <div className="iv-right">
            <Link href="/dashboard/employees" className="iv-btn ghost">All employees →</Link>
          </div>
        </header>

        <main className="iv-main">
          <div className="iv-intro">
            <div className="iv-intro-count">{rows.length}</div>
            <div>
              <div className="iv-intro-title">employee{rows.length === 1 ? '' : 's'} haven&apos;t set a PIN yet</div>
              <div className="iv-intro-sub">Generate a fresh 24-hour setup link, then copy it or open WhatsApp to send it manually. Generating a new link invalidates any earlier one.</div>
            </div>
          </div>

          {error && <div className="iv-banner">{error}</div>}

          {rows.length === 0 ? (
            <div className="iv-empty">
              <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: T.whiteMid, marginBottom: 4 }}>Everyone&apos;s set up</div>
              <div style={{ fontSize: 13 }}>All active employees have set their PIN.</div>
            </div>
          ) : (
            <div className="iv-table-wrap">
              <table className="iv-table">
                <thead><tr><th>Employee</th><th>Phone</th><th>Link status</th><th style={{ width: '46%' }}>Setup link</th></tr></thead>
                <tbody>
                  {rows.map((row) => {
                    const exp = expiryLabel(row.linkExpires)
                    const url = links[row.id]
                    return (
                      <tr key={row.id}>
                        <td>{row.name}<div className="iv-sub">{row.empId}</div></td>
                        <td className="iv-mono">{row.phone}</td>
                        <td><span className={`iv-pill ${exp.stale ? 'stale' : 'ok'}`}>{exp.text}</span></td>
                        <td>
                          {!url ? (
                            <button className="iv-btn primary" disabled={busyId === row.id} onClick={() => generate(row)}>
                              {busyId === row.id ? 'Generating…' : '🔗 Generate link'}
                            </button>
                          ) : (
                            <div className="iv-linkrow">
                              <input className="iv-linkinput" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
                              <button className="iv-icon-btn" title="Copy link" onClick={() => copy(row)}>{copiedId === row.id ? '✓' : '📋'}</button>
                              <a className="iv-icon-btn wa" title="Send via WhatsApp" href={waHref(row)} target="_blank" rel="noopener noreferrer">🟢</a>
                              <button className="iv-icon-btn" title="Regenerate" disabled={busyId === row.id} onClick={() => generate(row)}>↻</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
    </>
  )
}

const css = `
*,*::before,*::after{box-sizing:border-box}
.iv-root{font-family:'DM Sans',sans-serif;background:${T.bg};min-height:100vh;color:${T.white}}
.iv-topbar{background:${T.bgCard};border-bottom:1px solid ${T.border};display:flex;align-items:center;padding:0 28px;height:56px;gap:14px;position:sticky;top:0;z-index:100}
.iv-logo{font-family:'DM Mono',monospace;font-size:13px;color:${T.tealBright};letter-spacing:.06em;text-decoration:none}
.iv-divider{width:1px;height:20px;background:${T.border}}
.iv-title{font-family:'Syne',sans-serif;font-size:15px;font-weight:600;color:${T.whiteMid}}
.iv-right{margin-left:auto;display:flex;align-items:center;gap:10px}
.iv-btn{padding:8px 16px;border-radius:8px;border:none;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.iv-btn.primary{background:${T.tealMid};color:#fff}.iv-btn.primary:hover{opacity:.9}.iv-btn.primary:disabled{opacity:.5;cursor:not-allowed}
.iv-btn.ghost{background:${T.bgSubtle};color:${T.whiteMid};border:1px solid ${T.border}}.iv-btn.ghost:hover{border-color:${T.teal};color:${T.tealBright}}
.iv-main{padding:28px 32px;max-width:1100px}
.iv-intro{display:flex;align-items:center;gap:18px;background:${T.bgCard};border:1px solid ${T.border};border-radius:12px;padding:18px 22px;margin-bottom:20px}
.iv-intro-count{font-family:'Syne',sans-serif;font-size:40px;font-weight:700;color:${T.amber};line-height:1}
.iv-intro-title{font-size:15px;font-weight:600;color:${T.white};margin-bottom:3px}
.iv-intro-sub{font-size:12px;color:${T.dim};line-height:1.5;max-width:620px}
.iv-banner{padding:12px 16px;border-radius:10px;font-size:13px;margin-bottom:16px;background:${T.redBg};border:1px solid #3d1a1a;color:${T.red}}
.iv-empty{text-align:center;padding:80px 0;color:${T.dim}}
.iv-table-wrap{background:${T.bgCard};border:1px solid ${T.border};border-radius:12px;overflow:hidden}
.iv-table{width:100%;border-collapse:collapse;font-size:13px}
.iv-table thead tr{background:${T.bgSubtle}}
.iv-table thead th{padding:11px 16px;text-align:left;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${T.dim};border-bottom:1px solid ${T.border}}
.iv-table tbody tr{border-bottom:1px solid ${T.border}}
.iv-table tbody tr:last-child{border-bottom:none}
.iv-table tbody tr:hover{background:${T.bgHover}}
.iv-table td{padding:12px 16px;color:${T.whiteMid};vertical-align:middle}
.iv-sub{font-family:'DM Mono',monospace;font-size:10px;color:${T.dim}}
.iv-mono{font-family:'DM Mono',monospace;font-size:12px;color:${T.whiteMid}}
.iv-pill{font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:.03em}
.iv-pill.ok{background:${T.greenBg};color:${T.green};border:1px solid #1a4030}
.iv-pill.stale{background:${T.bgSubtle};color:${T.dim};border:1px solid ${T.border}}
.iv-linkrow{display:flex;align-items:center;gap:6px}
.iv-linkinput{flex:1;background:${T.bgSubtle};border:1px solid ${T.border};border-radius:7px;padding:8px 10px;font-family:'DM Mono',monospace;font-size:11px;color:${T.tealText};outline:none}
.iv-linkinput:focus{border-color:${T.teal}}
.iv-icon-btn{width:32px;height:32px;flex-shrink:0;border-radius:7px;border:1px solid ${T.border};background:${T.bgSubtle};color:${T.whiteMid};font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;text-decoration:none;transition:all .12s}
.iv-icon-btn:hover{border-color:${T.tealMid};color:${T.tealBright}}
.iv-icon-btn.wa:hover{border-color:#25D366}
.iv-icon-btn:disabled{opacity:.5;cursor:not-allowed}
`
