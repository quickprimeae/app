'use client'
// src/app/dashboard/PickerQuickInfo.tsx
// ONE shared read-only quick-info card for a picker, used by BOTH the Live
// Dashboard (location drawer + card pills) and the Locations page. Shows just
// name + phone and a "More Info →" that redirects to that specific picker on the
// Employees page — the single detailed/editable view. No editing here.

import Link from 'next/link'
import { T } from '@/lib/theme'

export type QuickInfoPicker = { empId: string; name: string; phone: string | null }

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
}

export default function PickerQuickInfo({ picker, onClose }: { picker: QuickInfoPicker | null; onClose: () => void }) {
  if (!picker) return null
  return (
    <>
      <style>{qiCss}</style>
      <div className="qi-overlay" onClick={onClose}>
        <div className="qi-card" onClick={(e) => e.stopPropagation()}>
          <div className="qi-head">
            <div className="qi-avatar">{initials(picker.name)}</div>
            <div className="qi-idblock">
              <div className="qi-name">{picker.name}</div>
              <div className="qi-emp">{picker.empId}</div>
            </div>
            <button className="qi-close" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <div className="qi-row">
            <span className="qi-label">Phone</span>
            <span className="qi-val">{picker.phone || '—'}</span>
          </div>
          <Link href={`/dashboard/employees?picker=${encodeURIComponent(picker.empId)}`} className="qi-more">
            More Info →
          </Link>
        </div>
      </div>
    </>
  )
}

const qiCss = `
.qi-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:400;display:flex;align-items:center;justify-content:center;animation:qiFade .12s ease;padding:16px}
@keyframes qiFade{from{opacity:0}to{opacity:1}}
.qi-card{width:300px;max-width:100%;background:${T.bgCard};border:1px solid ${T.borderMid};border-radius:14px;padding:16px 18px 18px;box-shadow:0 12px 40px rgba(0,0,0,.4)}
.qi-head{display:flex;align-items:center;gap:12px}
.qi-avatar{width:40px;height:40px;border-radius:10px;background:${T.bgSubtle};border:1px solid ${T.border};display:flex;align-items:center;justify-content:center;font-family:var(--font-jakarta),sans-serif;font-size:14px;font-weight:600;color:${T.tealText};flex-shrink:0}
.qi-idblock{flex:1;min-width:0}
.qi-name{font-family:var(--font-jakarta),sans-serif;font-size:16px;font-weight:600;color:${T.white};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qi-emp{font-family:'DM Mono',monospace;font-size:11px;color:${T.dim};margin-top:2px}
.qi-close{background:none;border:1px solid ${T.border};color:${T.dim};width:26px;height:26px;border-radius:6px;cursor:pointer;font-size:13px;flex-shrink:0}
.qi-close:hover{color:${T.white};border-color:${T.borderMid}}
.qi-row{display:flex;align-items:center;justify-content:space-between;margin-top:14px;padding:10px 12px;background:${T.bgSubtle};border:1px solid ${T.border};border-radius:9px}
.qi-label{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:${T.dim}}
.qi-val{font-family:'DM Mono',monospace;font-size:14px;color:${T.white}}
.qi-more{display:block;margin-top:14px;text-align:center;padding:11px;border-radius:9px;background:${T.tealMid};color:#1B2B2B;font-family:var(--font-jakarta),sans-serif;font-size:14px;font-weight:600;text-decoration:none}
.qi-more:hover{opacity:.9}
`
