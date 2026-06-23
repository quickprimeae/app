'use client'
// src/app/dashboard/employees/new/OnboardingClient.tsx
// 4-step onboarding wizard wired to POST /api/employees and reference-photo
// upload. Creating an employee no longer sends a PIN invite — admins send the
// setup link afterwards from the Pending invites page. Fixes the
// URL.createObjectURL leak (bug #7) by revoking the previous blob URL on
// replace and on unmount.

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { normalizePhone } from '@/lib/phone'
import { BULK_PLACEHOLDER_SALARY } from '@/lib/salary'

import { LT as T } from '@/lib/theme'

type Loc = { id: string; name: string }
type Sup = { id: string; name: string | null }

const STEPS_META = [
  { label: 'Personal details', desc: 'Name, phone, nationality' },
  { label: 'Shift', desc: 'Shift type, days, supervisor' },
  { label: 'Reference photo', desc: 'For identity verification' },
  { label: 'Review & confirm', desc: 'Check before creating' },
]

// DEMO: pay is hidden in the UI, but the create API still requires a positive
// monthly_salary (it derives hourly_rate from it). When the (now-hidden) salary
// field is left empty, we submit BULK_PLACEHOLDER_SALARY — the SAME intentional
// stand-in the bulk CSV import writes (see @/lib/salary). The real figure is
// entered post-onboarding in the super-admin dashboard. To restore real pay
// entry: un-hide the salary input in step 1 and drop this fallback.

const EMPTY = {
  firstName: '', lastName: '', phone: '', empId: '', nationality: '', startDate: '',
  locationId: '', monthlySalary: '', shiftType: '8h' as '8h' | '10h', shiftDays: 'Mon-Fri',
  supervisorId: '', branch: '', photoUrl: '', photoFile: null as File | null,
}

export default function OnboardingClient({ tenantId, locations, supervisors }: { tenantId: string; locations: Loc[]; supervisors: Sup[] }) {
  const [step, setStep] = useState(0) // 0–3 form, 4 success
  const [data, setData] = useState({ ...EMPTY })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ employee_number?: string } | null>(null)
  const photoUrlRef = useRef<string>('')

  // Revoke the last object URL when the component unmounts (bug #7).
  useEffect(() => () => { if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current) }, [])

  function onChange(key: keyof typeof EMPTY, val: any) {
    setData((d) => ({ ...d, [key]: val }))
  }
  function setPhoto(file: File | null) {
    if (!file || !file.type.startsWith('image/')) return
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current) // revoke previous (bug #7)
    const url = URL.createObjectURL(file)
    photoUrlRef.current = url
    setData((d) => ({ ...d, photoUrl: url, photoFile: file }))
  }

  // Same phone rule as bulk upload — must normalize to a valid UAE mobile.
  const phoneValid = !!normalizePhone(data.phone)

  function canAdvance() {
    if (step === 0) return data.firstName && data.lastName && phoneValid && data.startDate
    if (step === 1) return !!data.shiftType // pay hidden for demo; don't block on salary
    return true
  }

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          first_name: data.firstName,
          last_name: data.lastName,
          phone: data.phone.trim(),
          nationality: data.nationality || null,
          location_id: null, // assigned later from the Employees tab
          supervisor_id: data.supervisorId || null,
          monthly_salary: Number(data.monthlySalary) || BULK_PLACEHOLDER_SALARY,
          shift_type: data.shiftType,
          shift_days: data.shiftDays,
          branch: data.branch || null,
          // shift_start/shift_end omitted — picker inherits the location default.
          start_date: data.startDate,
        }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body.error || 'Could not create employee.'); return }

      // Upload the reference photo if one was provided.
      if (data.photoFile && body.employee_id) {
        const fd = new FormData()
        fd.append('employee_id', body.employee_id)
        fd.append('file', data.photoFile)
        await fetch('/api/employees/photo', { method: 'POST', body: fd })
      }
      setResult({ employee_number: body.employee_number })
      setStep(4)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function advance() {
    if (step < 3) setStep((s) => s + 1)
    else submit()
  }
  function reset() {
    if (photoUrlRef.current) { URL.revokeObjectURL(photoUrlRef.current); photoUrlRef.current = '' }
    setData({ ...EMPTY })
    setResult(null)
    setError(null)
    setStep(0)
  }

  const progress = step >= 4 ? 100 : Math.round((step / 4) * 100)
  const fullName = `${data.firstName} ${data.lastName}`.trim()

  return (
    <>
      <style>{css}</style>
      <div className="ob-root">
        <div className="ob-layout">
          <aside className="ob-sidebar">
            <Link href="/dashboard" className="ob-logo">OPSPRO</Link>
            <div className="ob-sidebar-title">New employee<br />onboarding</div>
            <div className="ob-sidebar-sub">Register a picker, then send their PIN setup link from Pending invites.</div>
            <div className="ob-steps">
              {STEPS_META.map((s, i) => {
                const state = i < step ? 'done' : i === step ? 'active' : 'upcoming'
                return (
                  <div key={i} className={`ob-step-item ${state}`}>
                    <div className="ob-step-num">{state === 'done' ? '✓' : i + 1}</div>
                    <div><div className="ob-step-name">{s.label}</div><div className="ob-step-desc">{s.desc}</div></div>
                  </div>
                )
              })}
            </div>
            <div className="ob-sidebar-footer">
              <Link href="/dashboard/employees/bulk" style={{ color: T.tealText, textDecoration: 'underline' }}>Bulk upload a CSV →</Link>
            </div>
          </aside>

          <main className="ob-main">
            {step < 4 ? (
              <>
                <div className="ob-progress"><div className="ob-progress-fill" style={{ width: `${progress}%` }} /></div>
                <div className="ob-step-header">
                  <div className="ob-step-tag">Step {step + 1} of 4</div>
                  <h1 className="ob-step-h">{['Who are we registering?', 'Where are they deployed?', 'Reference photo', 'Ready to create?'][step]}</h1>
                </div>

                {step === 0 && (
                  <div className="ob-form">
                    <div className="ob-row">
                      <Field label="First name" required><input className="ob-input" placeholder="Ahmed" value={data.firstName} onChange={(e) => onChange('firstName', e.target.value)} /></Field>
                      <Field label="Last name" required><input className="ob-input" placeholder="Al Rashidi" value={data.lastName} onChange={(e) => onChange('lastName', e.target.value)} /></Field>
                    </div>
                    <div className="ob-row">
                      <Field label="Mobile number" required hint={data.phone && !phoneValid ? 'Enter a valid UAE mobile (e.g. 05XXXXXXXX or +9715XXXXXXXX)' : 'Used to send the PIN setup link'}><input className="ob-input" placeholder="+971 50 123 4567" value={data.phone} onChange={(e) => onChange('phone', e.target.value)} /></Field>
                      <Field label="Nationality"><select className="ob-select" value={data.nationality} onChange={(e) => onChange('nationality', e.target.value)}><option value="">Select country</option>{['UAE', 'Philippines', 'India', 'Pakistan', 'Bangladesh', 'Egypt', 'Jordan', 'Sri Lanka', 'Nepal', 'Other'].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
                    </div>
                    <div className="ob-row">
                      <Field label="Start date" required><input className="ob-input" type="date" value={data.startDate} onChange={(e) => onChange('startDate', e.target.value)} /></Field>
                      <div />
                    </div>
                  </div>
                )}

                {step === 1 && (
                  <div className="ob-form">
                    {/* Pay hidden for demo: Monthly salary + Hourly-rate inputs removed
                        (and the pay info box). shift_type stays — it's schedule data. */}
                    <div className="ob-row">
                      <Field label="Shift type" required><select className="ob-select" value={data.shiftType} onChange={(e) => onChange('shiftType', e.target.value)}><option value="8h">8h</option><option value="10h">10h</option></select></Field>
                      <Field label="Shift days"><select className="ob-select" value={data.shiftDays} onChange={(e) => onChange('shiftDays', e.target.value)}>{['Mon-Fri', 'Mon-Sat', 'Sun-Thu', '7 days'].map((d) => <option key={d} value={d}>{d}</option>)}</select></Field>
                    </div>
                    <div className="ob-row">
                      <Field label="Supervisor"><select className="ob-select" value={data.supervisorId} onChange={(e) => onChange('supervisorId', e.target.value)}><option value="">Assign supervisor</option>{supervisors.map((s) => <option key={s.id} value={s.id}>{s.name ?? s.id}</option>)}</select></Field>
                      <Field label="Branch" hint="Optional branch label"><input className="ob-input" placeholder="e.g. MOE" value={data.branch} onChange={(e) => onChange('branch', e.target.value)} /></Field>
                    </div>
                    <div className="ob-info-box teal"><span className="ob-info-box-icon">🕒</span><div className="ob-info-box-text">Assign a location later from the Employees tab — they can&apos;t clock in until they have one.</div></div>
                  </div>
                )}

                {step === 2 && (
                  <div className="ob-form">
                    <div className="ob-photo-area">
                      <label className="ob-photo-preview">
                        {data.photoUrl ? <img src={data.photoUrl} alt="Reference" /> : <><div className="ob-photo-icon">📷</div><div className="ob-photo-label">Click to upload</div></>}
                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
                      </label>
                      <div className="ob-photo-rules">
                        {[{ icon: '✅', title: 'Clear face', body: 'Both eyes visible, no sunglasses' }, { icon: '✅', title: 'Good lighting', body: 'No harsh shadows' }, { icon: '✅', title: 'Looking straight', body: 'Neutral expression' }, { icon: '❌', title: 'No group photos', body: 'Employee only' }].map((r) => (
                          <div key={r.title} className="ob-photo-rule"><span className="ob-photo-rule-icon">{r.icon}</span><div className="ob-photo-rule-text"><strong>{r.title}</strong> — {r.body}</div></div>
                        ))}
                      </div>
                    </div>
                    {!data.photoUrl && <div className="ob-info-box amber"><span className="ob-info-box-icon">⚠️</span><div className="ob-info-box-text"><strong>No photo uploaded.</strong> The employee can still be registered, but selfie checks stay disabled until a reference photo is added.</div></div>}
                  </div>
                )}

                {step === 3 && (
                  <div>
                    <div className="ob-review-grid">
                      <div className="ob-review-photo">{data.photoUrl ? <img src={data.photoUrl} alt={fullName} /> : '👤'}</div>
                      <div>
                        <div className="ob-review-name">{fullName || '—'}</div>
                        <div className="ob-badges">
                          <span className="ob-badge" style={{ background: T.amberLight, color: T.amber, borderColor: '#FAC775' }}>📍 No location yet</span>
                          {data.shiftDays && <span className="ob-badge">📅 {data.shiftDays}</span>}
                          {data.shiftType && <span className="ob-badge">🕒 {data.shiftType}</span>}
                        </div>
                      </div>
                    </div>
                    <table className="ob-review-table"><tbody>
                      {[
                        ['Mobile', data.phone || '—'], ['Nationality', data.nationality || '—'], ['Start date', data.startDate || '—'],
                        ['Location', 'Assign from Employees tab'], ['Shift days', data.shiftDays || '—'],
                        ['Shift type', data.shiftType || '—'],
                        ['Supervisor', supervisors.find((s) => s.id === data.supervisorId)?.name ?? 'Unassigned'],
                        ['Reference photo', data.photoUrl ? '✓ Uploaded' : '⚠ Not uploaded'],
                      ].map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
                    </tbody></table>
                    <div className="ob-info-box teal"><span className="ob-info-box-icon">📱</span><div className="ob-info-box-text">After confirming, <strong>{data.firstName || 'the employee'}</strong> is created with no PIN yet. Send their secure 6-digit-PIN setup link from <strong>Pending invites</strong> (or their profile) when you&apos;re ready — it stays valid for 24 hours once sent.</div></div>
                  </div>
                )}

                {error && <div className="ob-info-box amber" style={{ background: T.redLight, borderColor: '#F7C1C1' }}><span className="ob-info-box-icon">⚠️</span><div className="ob-info-box-text" style={{ color: T.red }}>{error}</div></div>}

                <div className="ob-actions">
                  {step > 0 ? <button className="ob-btn secondary" onClick={() => setStep((s) => s - 1)} disabled={submitting}>← Back</button> : <Link href="/dashboard/employees" className="ob-btn ghost">Cancel</Link>}
                  <button className="ob-btn primary" disabled={!canAdvance() || submitting} onClick={advance}>{submitting ? 'Creating…' : step < 3 ? 'Continue →' : '✓ Confirm & create'}</button>
                </div>
              </>
            ) : (
              <div className="ob-success">
                <div className="ob-success-ring">✓</div>
                <div className="ob-success-h"><em>{fullName}</em> is registered</div>
                <div className="ob-success-sub">
                  Their profile has been created. They have no PIN yet — send their setup link to <strong>{data.phone}</strong> from{' '}
                  <Link href="/dashboard/employees/invites" style={{ color: T.tealMid, fontWeight: 600 }}>Pending invites</Link>.
                </div>
                <div className="ob-success-details">
                  <div className="ob-success-stat"><div className="ob-success-stat-val">{result?.employee_number || 'QP-AUTO'}</div><div className="ob-success-stat-label">Employee ID</div></div>
                  <div className="ob-success-stat"><div className="ob-success-stat-val" style={{ color: T.amber, fontSize: 15 }}>Assign next</div><div className="ob-success-stat-label">Location</div></div>
                  <div className="ob-success-stat"><div className="ob-success-stat-val">{data.shiftType}</div><div className="ob-success-stat-label">Shift type</div></div>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button className="ob-btn primary" onClick={reset}>+ Add another employee</button>
                  <Link href="/dashboard/employees" className="ob-btn secondary">View roster →</Link>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </>
  )
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="ob-field">
      <label className="ob-label">{label}{required && <span>*</span>}</label>
      {children}
      {hint && <span className="ob-hint">{hint}</span>}
    </div>
  )
}

const css = `
*,*::before,*::after{box-sizing:border-box}
.ob-root{font-family:var(--font-jakarta),sans-serif;background:${T.surface};min-height:100vh;color:${T.ink}}
.ob-layout{display:grid;grid-template-columns:280px 1fr;min-height:100vh}
.ob-sidebar{background:${T.tealDark};padding:36px 28px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
.ob-logo{font-family:'DM Mono',monospace;font-size:13px;color:${T.onTealPanel};letter-spacing:.06em;margin-bottom:40px;text-decoration:none}
.ob-sidebar-title{font-family:var(--font-jakarta),serif;font-size:22px;font-weight:300;color:#fff;line-height:1.3;margin-bottom:8px}
.ob-sidebar-sub{font-size:12px;color:${T.tealText};line-height:1.6;margin-bottom:40px}
.ob-steps{display:flex;flex-direction:column;gap:4px;flex:1}
.ob-step-item{display:flex;align-items:center;gap:14px;padding:12px 14px;border-radius:10px;transition:background .15s}
.ob-step-item.active{background:rgba(255,255,255,.1)}
.ob-step-item.done{opacity:.7}
.ob-step-item.upcoming{opacity:.35}
.ob-step-num{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0}
.ob-step-item.done .ob-step-num{background:${T.tealMid};color:#1B2B2B}
.ob-step-item.active .ob-step-num{background:#fff;color:${T.tealDark}}
.ob-step-item.upcoming .ob-step-num{background:rgba(255,255,255,.15);color:rgba(255,255,255,.5)}
.ob-step-name{font-size:13px;font-weight:500;color:#fff;line-height:1.2}
.ob-step-desc{font-size:11px;color:${T.tealText};margin-top:1px}
.ob-sidebar-footer{padding-top:24px;border-top:1px solid rgba(255,255,255,.1);font-size:11px;line-height:1.5}
.ob-main{padding:48px 60px;max-width:820px}
.ob-step-header{margin-bottom:32px}
.ob-step-tag{font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:${T.tealMid};margin-bottom:8px}
.ob-step-h{font-family:var(--font-jakarta),serif;font-size:32px;font-weight:300;color:${T.ink};line-height:1.15}
.ob-form{display:flex;flex-direction:column;gap:0}
.ob-row{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px}
.ob-row.single{grid-template-columns:1fr}
.ob-row.triple{grid-template-columns:1fr 1fr 1fr}
.ob-field{display:flex;flex-direction:column;gap:6px}
.ob-label{font-size:12px;font-weight:600;letter-spacing:.04em;color:${T.inkMid};text-transform:uppercase}
.ob-label span{color:${T.tealMid};margin-left:2px}
.ob-input,.ob-select{padding:13px 16px;border-radius:10px;border:1.5px solid ${T.border};background:${T.white};font-family:var(--font-jakarta),sans-serif;font-size:15px;color:${T.ink};outline:none;transition:border-color .15s,box-shadow .15s;width:100%}
.ob-input:focus,.ob-select:focus{border-color:${T.tealMid};box-shadow:0 0 0 3px ${T.tealLight}}
.ob-select{cursor:pointer;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7c75' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;padding-right:40px}
.ob-hint{font-size:11px;color:${T.inkLight};margin-top:2px}
.ob-photo-area{display:grid;grid-template-columns:200px 1fr;gap:28px;align-items:start;margin-bottom:28px}
.ob-photo-preview{width:200px;height:200px;border-radius:16px;background:${T.tealLight};border:2px dashed ${T.tealBorder};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:pointer;transition:border-color .15s;overflow:hidden}
.ob-photo-preview:hover{border-color:${T.tealMid}}
.ob-photo-preview img{width:100%;height:100%;object-fit:cover;border-radius:14px}
.ob-photo-icon{font-size:40px}
.ob-photo-label{font-size:12px;font-weight:500;color:${T.teal};text-align:center}
.ob-photo-rules{display:flex;flex-direction:column;gap:10px}
.ob-photo-rule{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;background:${T.white};border-radius:10px;border:1px solid ${T.border}}
.ob-photo-rule-icon{font-size:18px;flex-shrink:0;margin-top:1px}
.ob-photo-rule-text{font-size:13px;color:${T.inkMid};line-height:1.4}
.ob-photo-rule-text strong{color:${T.ink};font-weight:600}
.ob-review-grid{display:grid;grid-template-columns:140px 1fr;gap:24px;align-items:start;margin-bottom:28px}
.ob-review-photo{width:140px;height:140px;border-radius:12px;background:${T.tealLight};display:flex;align-items:center;justify-content:center;font-size:48px;border:2px solid ${T.tealBorder};overflow:hidden}
.ob-review-photo img{width:100%;height:100%;object-fit:cover}
.ob-review-name{font-family:var(--font-jakarta),serif;font-size:26px;font-weight:400;color:${T.ink};margin-bottom:10px}
.ob-badges{display:flex;gap:8px;flex-wrap:wrap}
.ob-badge{font-size:11px;font-weight:600;padding:4px 10px;border-radius:20px;background:${T.tealLight};color:${T.teal};border:1px solid ${T.tealBorder}}
.ob-review-table{width:100%;border-collapse:collapse;margin-bottom:24px}
.ob-review-table td{padding:11px 14px;font-size:13px;border-bottom:1px solid ${T.border}}
.ob-review-table td:first-child{font-weight:600;color:${T.inkMid};width:40%}
.ob-review-table tr:last-child td{border-bottom:none}
.ob-info-box{padding:14px 16px;border-radius:10px;display:flex;gap:12px;align-items:flex-start;margin-bottom:20px}
.ob-info-box.teal{background:${T.tealLight};border:1px solid ${T.tealBorder}}
.ob-info-box.amber{background:${T.amberLight};border:1px solid #FAC775}
.ob-info-box-icon{font-size:18px;flex-shrink:0;margin-top:1px}
.ob-info-box-text{font-size:13px;line-height:1.6}
.ob-info-box.teal .ob-info-box-text{color:${T.teal}}
.ob-info-box.amber .ob-info-box-text{color:${T.amber}}
.ob-info-box-text strong{font-weight:600}
.ob-success{display:flex;flex-direction:column;align-items:center;text-align:center;padding:60px 40px}
.ob-success-ring{width:120px;height:120px;border-radius:50%;background:${T.tealMid};display:flex;align-items:center;justify-content:center;font-size:56px;color:#1B2B2B;margin-bottom:32px;animation:popIn .35s cubic-bezier(.175,.885,.32,1.275)}
@keyframes popIn{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}
.ob-success-h{font-family:var(--font-jakarta),serif;font-size:32px;font-weight:300;color:${T.ink};margin-bottom:10px}
.ob-success-h em{font-style:italic;color:${T.tealMid}}
.ob-success-sub{font-size:15px;color:${T.inkLight};line-height:1.6;max-width:440px;margin-bottom:40px}
.ob-success-details{background:${T.white};border:1px solid ${T.border};border-radius:14px;padding:20px 28px;display:flex;gap:40px;margin-bottom:32px}
.ob-success-stat{text-align:center}
.ob-success-stat-val{font-family:'DM Mono',monospace;font-size:22px;font-weight:500;color:${T.tealDark};margin-bottom:4px}
.ob-success-stat-label{font-size:11px;color:${T.inkLight};text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.ob-actions{display:flex;align-items:center;gap:14px;padding-top:32px;border-top:1px solid ${T.border};margin-top:12px}
.ob-btn{padding:13px 28px;border-radius:10px;border:none;font-family:var(--font-jakarta),sans-serif;font-size:15px;font-weight:600;cursor:pointer;transition:opacity .1s,background .15s;display:flex;align-items:center;gap:8px;text-decoration:none}
.ob-btn.primary{background:${T.tealMid};color:#1B2B2B}.ob-btn.primary:hover{background:${T.teal}}
.ob-btn.secondary{background:${T.white};color:${T.inkMid};border:1.5px solid ${T.border}}.ob-btn.secondary:hover{border-color:${T.tealBorder};color:${T.teal}}
.ob-btn:disabled{opacity:.4;cursor:not-allowed}
.ob-btn.ghost{background:none;color:${T.inkLight}}.ob-btn.ghost:hover{color:${T.red}}
.ob-progress{height:3px;background:${T.border};border-radius:2px;margin-bottom:40px;overflow:hidden}
.ob-progress-fill{height:100%;background:${T.tealMid};border-radius:2px;transition:width .4s cubic-bezier(.4,0,.2,1)}
`
