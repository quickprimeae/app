'use client'
// src/app/clock-in/page.tsx
// Picker clock-in / clock-out. Mobile-first, PIN auth, server-side geofence.
// Flow: identify by phone -> home -> (clock in/out) GPS -> PIN -> [selfie] -> done.

import { useState, useEffect, useRef } from 'react'

const TEAL = '#0F6E56'
const TEAL_MID = '#1D9E75'
const TEAL_LIGHT = '#E1F5EE'
const TEAL_DARK = '#085041'

type EmployeeInfo = {
  id: string
  first_name: string
  last_name: string
  employee_number: string
  pin_set: boolean
}
type LocationInfo = {
  id: string
  name: string
  chain: string | null
  area: string | null
  address: string | null
  shift_start: string | null
  shift_end: string | null
} | null
type TodayState = {
  clocked_in: boolean
  clocked_out: boolean
  clock_in_time: string | null
}

const STEPS = {
  IDENTIFY: 'identify',
  HOME: 'home',
  GPS: 'gps',
  PIN: 'pin',
  SELFIE: 'selfie',
  SUCCESS: 'success',
} as const
type Step = (typeof STEPS)[keyof typeof STEPS]

function useClock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

function formatTime(d: Date | null) {
  if (!d) return '--:--:--'
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function formatDate(d: Date | null) {
  if (!d) return ''
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}
function formatHm(d: Date | null) {
  if (!d) return '--:--'
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
function elapsed(start: Date | null, now: Date | null) {
  if (!start || !now) return ''
  const s = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 1000))
  const h = Math.floor(s / 3600).toString().padStart(2, '0')
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0')
  const sec = (s % 60).toString().padStart(2, '0')
  return `${h}:${m}:${sec}`
}
// "08:00:00" -> "08:00"
function hm(t: string | null) {
  if (!t) return '—'
  return t.slice(0, 5)
}
function durationHrs(start: string | null, end: string | null) {
  if (!start || !end) return null
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const mins = eh * 60 + em - (sh * 60 + sm)
  if (mins <= 0) return null
  return Math.round((mins / 60) * 10) / 10
}

function initials(first: string, last: string) {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase()
}

// Weak per-device identifier kept in localStorage (informational, not a control).
function getDeviceFingerprint() {
  if (typeof window === 'undefined') return undefined
  try {
    let id = localStorage.getItem('qp_device_id')
    if (!id) {
      id = (crypto.randomUUID?.() ?? `dev-${Date.now()}`)
      localStorage.setItem('qp_device_id', id)
    }
    return id
  } catch {
    return undefined
  }
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Location is not available on this device.'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    })
  })
}

function PinPad({
  onComplete,
  onBack,
  title,
  subtitle,
  error,
  busy,
  onClearError,
}: {
  onComplete: (pin: string) => void
  onBack: () => void
  title: string
  subtitle: React.ReactNode
  error: string | null
  busy: boolean
  onClearError: () => void
}) {
  const [pin, setPin] = useState<number[]>([])

  // Clear the entered digits whenever a new error arrives.
  useEffect(() => {
    if (error) setPin([])
  }, [error])

  function press(d: number) {
    if (busy) return
    if (error) onClearError()
    setPin((prev) => {
      if (prev.length >= 6) return prev
      const next = [...prev, d]
      if (next.length === 6) setTimeout(() => onComplete(next.join('')), 160)
      return next
    })
  }
  function del() {
    if (busy) return
    if (error) onClearError()
    setPin((p) => p.slice(0, -1))
  }

  const keys: (number | 'del' | null)[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'del']
  return (
    <div className="qp-overlay">
      <button className="qp-back" onClick={onBack} disabled={busy}>←</button>
      <div className="qp-step-icon">🔑</div>
      <div className="qp-step-title">{title}</div>
      <div className="qp-step-sub">{subtitle}</div>
      {error && (
        <div className="qp-error-box" style={{ maxWidth: 280 }}>
          <span className="qp-error-text">{error}</span>
        </div>
      )}
      <div className="qp-pin-display">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={`qp-pin-dot ${pin.length > i ? (error ? 'error' : 'filled') : ''}`}
          />
        ))}
      </div>
      <div className="qp-keypad">
        {keys.map((k, i) => {
          if (k === null) return <div key={i} className="qp-key empty" />
          if (k === 'del')
            return (
              <button key={i} className="qp-key delete" onClick={del}>⌫</button>
            )
          return (
            <button key={i} className="qp-key" onClick={() => press(k)}>{k}</button>
          )
        })}
      </div>
      {busy && <div className="qp-step-sub" style={{ marginTop: 18 }}>Checking…</div>}
    </div>
  )
}

export default function PickerClockIn() {
  const now = useClock()

  const [step, setStep] = useState<Step>(STEPS.IDENTIFY)
  const [action, setAction] = useState<'in' | 'out'>('in')

  // Identity / data
  const [phone, setPhone] = useState('')
  const [identifyError, setIdentifyError] = useState<string | null>(null)
  const [identifying, setIdentifying] = useState(false)
  const [employee, setEmployee] = useState<EmployeeInfo | null>(null)
  const [location, setLocation] = useState<LocationInfo>(null)
  const [clockedInAt, setClockedInAt] = useState<Date | null>(null)
  const [clockedOut, setClockedOut] = useState(false)
  const [hoursWorked, setHoursWorked] = useState<number | null>(null)

  // Action transient state
  const [coords, setCoords] = useState<{ lat: number; lng: number; acc: number } | null>(null)
  const [pinError, setPinError] = useState<string | null>(null)
  const [pinBusy, setPinBusy] = useState(false)
  const [overlayError, setOverlayError] = useState<string | null>(null)
  const [pendingEventId, setPendingEventId] = useState<string | null>(null)
  const selfieInput = useRef<HTMLInputElement | null>(null)
  const [selfieBusy, setSelfieBusy] = useState(false)

  const isClockedIn = !!clockedInAt && !clockedOut

  // Light theme for the picker view (see globals.css body.picker-view).
  useEffect(() => {
    document.body.classList.add('picker-view')
    return () => document.body.classList.remove('picker-view')
  }, [])

  async function handleIdentify(e: React.FormEvent) {
    e.preventDefault()
    setIdentifyError(null)
    const trimmed = phone.trim()
    if (!trimmed) return
    setIdentifying(true)
    try {
      const res = await fetch(`/api/employees/lookup?phone=${encodeURIComponent(trimmed)}`)
      const data = await res.json()
      if (!res.ok) {
        setIdentifyError(data.error || 'Could not find your record.')
        return
      }
      setEmployee(data.employee)
      setLocation(data.location)
      if (data.today.clock_in_time) setClockedInAt(new Date(data.today.clock_in_time))
      setClockedOut(!!data.today.clocked_out)
      setStep(STEPS.HOME)
    } catch {
      setIdentifyError('Network error. Please try again.')
    } finally {
      setIdentifying(false)
    }
  }

  async function beginAction(which: 'in' | 'out') {
    if (!location) {
      setOverlayError('No location assigned to you yet. Contact your supervisor.')
      setStep(STEPS.SUCCESS) // reuse overlay to show the message
      return
    }
    setAction(which)
    setOverlayError(null)
    setPinError(null)
    setStep(STEPS.GPS)
    try {
      const pos = await getPosition()
      setCoords({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        acc: pos.coords.accuracy,
      })
      setStep(STEPS.PIN)
    } catch (err: any) {
      setOverlayError(
        err?.code === 1
          ? 'Location permission denied. Enable location and try again.'
          : 'Could not get your location. Make sure GPS is on and try again.'
      )
      setStep(STEPS.SUCCESS)
    }
  }

  async function submitPin(pin: string) {
    if (!employee || !location || !coords) return
    setPinBusy(true)
    setPinError(null)
    const endpoint = action === 'in' ? '/api/clock-in' : '/api/clock-out'
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employee.id,
          location_id: location.id,
          lat: coords.lat,
          lng: coords.lng,
          gps_accuracy: coords.acc,
          pin,
          device_fingerprint: getDeviceFingerprint(),
          user_agent: navigator.userAgent,
        }),
      })
      const data = await res.json()

      if (res.status === 401) {
        setPinError(
          typeof data.remaining === 'number'
            ? `Incorrect PIN. ${data.remaining} attempt(s) left.`
            : 'Incorrect PIN. Try again.'
        )
        return
      }
      if (!res.ok) {
        // geofence / lockout / inactive / duplicate
        setOverlayError(data.error || 'Could not complete. Please try again.')
        setStep(STEPS.SUCCESS)
        return
      }

      if (action === 'in') {
        setClockedInAt(new Date(data.timestamp ?? Date.now()))
        setClockedOut(false)
        if (data.selfie_required && data.clock_event_id) {
          setPendingEventId(data.clock_event_id)
          setStep(STEPS.SELFIE)
        } else {
          setStep(STEPS.SUCCESS)
        }
      } else {
        setHoursWorked(typeof data.hours_worked === 'number' ? data.hours_worked : null)
        setClockedOut(true)
        setStep(STEPS.SUCCESS)
      }
    } catch {
      setOverlayError('Network error. Please try again.')
      setStep(STEPS.SUCCESS)
    } finally {
      setPinBusy(false)
    }
  }

  async function handleSelfieFile(file: File | null) {
    if (!file || !pendingEventId) {
      setStep(STEPS.SUCCESS)
      return
    }
    setSelfieBusy(true)
    try {
      const fd = new FormData()
      fd.append('clock_event_id', pendingEventId)
      fd.append('file', file)
      await fetch('/api/clock-in/selfie', { method: 'POST', body: fd })
    } catch {
      // Best-effort: the clock-in is already recorded server-side.
    } finally {
      setSelfieBusy(false)
      setPendingEventId(null)
      setStep(STEPS.SUCCESS)
    }
  }

  function dismissOverlay() {
    setOverlayError(null)
    setHoursWorked(null)
    setStep(STEPS.HOME)
  }

  // ── Identify screen ───────────────────────────────────────
  if (step === STEPS.IDENTIFY) {
    return (
      <>
        <style>{css}</style>
        <div className="qp-root">
          <div className="qp-phone">
            <div className="qp-header" style={{ paddingBottom: 32 }}>
              <div>
                <div className="qp-logo">QUICKPRIME</div>
                <div className="qp-greeting">
                  <div className="qp-greeting-sub">Welcome</div>
                  <div className="qp-greeting-name">Clock in</div>
                </div>
              </div>
            </div>
            <div className="qp-status-section" style={{ justifyContent: 'flex-start', paddingTop: 40 }}>
              <form onSubmit={handleIdentify} style={{ width: '100%', maxWidth: 320 }}>
                <div className="qp-step-title" style={{ fontSize: 18, marginBottom: 8, textAlign: 'left' }}>
                  Enter your phone number
                </div>
                <div className="qp-step-sub" style={{ textAlign: 'left', marginBottom: 20 }}>
                  Use the number registered with QuickPrime.
                </div>
                <input
                  className="qp-text-input"
                  type="tel"
                  inputMode="tel"
                  placeholder="+971 5X XXX XXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoFocus
                />
                {identifyError && (
                  <div className="qp-error-box" style={{ marginTop: 16 }}>
                    <span className="qp-error-text">{identifyError}</span>
                  </div>
                )}
                <button className="qp-full-btn" type="submit" disabled={identifying} style={{ marginTop: 20, maxWidth: '100%' }}>
                  {identifying ? 'Checking…' : 'Continue'}
                </button>
              </form>
            </div>
          </div>
        </div>
      </>
    )
  }

  const shiftStart = hm(location?.shift_start ?? null)
  const shiftEnd = hm(location?.shift_end ?? null)
  const dur = durationHrs(location?.shift_start ?? null, location?.shift_end ?? null)

  return (
    <>
      <style>{css}</style>
      <div className="qp-root">
        <div className="qp-phone">
          {/* Header */}
          <div className="qp-header">
            <div>
              <div className="qp-logo">QUICKPRIME</div>
              <div className="qp-greeting">
                <div className="qp-greeting-sub">Hello,</div>
                <div className="qp-greeting-name">
                  {employee ? `${employee.first_name} ${employee.last_name?.[0] ?? ''}.` : ''}
                </div>
              </div>
            </div>
            <div className="qp-avatar">
              {employee ? initials(employee.first_name, employee.last_name) : ''}
            </div>
          </div>

          {/* Shift card */}
          <div className="qp-shift-card">
            <div className="qp-shift-label">Today&apos;s shift</div>
            {location ? (
              <>
                <div className="qp-shift-location">{location.name}</div>
                <div className="qp-shift-address">
                  {location.address || [location.chain, location.area].filter(Boolean).join(' · ')}
                </div>
                <div className="qp-shift-row">
                  <div className="qp-shift-pill">
                    <span className="qp-shift-pill-label">Start</span>
                    <span className="qp-shift-pill-val">{shiftStart}</span>
                  </div>
                  <div className="qp-shift-pill">
                    <span className="qp-shift-pill-label">End</span>
                    <span className="qp-shift-pill-val">{shiftEnd}</span>
                  </div>
                  {dur != null && (
                    <div className="qp-shift-pill">
                      <span className="qp-shift-pill-label">Duration</span>
                      <span className="qp-shift-pill-val">{dur} hrs</span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="qp-shift-address" style={{ marginBottom: 0 }}>
                No location assigned. Contact your supervisor.
              </div>
            )}
          </div>

          {/* Main area */}
          <div className="qp-status-section">
            <div className="qp-clock">{formatTime(now)}</div>
            <div className="qp-date">{formatDate(now)}</div>

            {isClockedIn && (
              <div className="qp-clocked-status">
                <div className="qp-status-dot" />
                <div className="qp-status-text">
                  <div className="qp-status-label">Clocked in at</div>
                  <div className="qp-status-time">{formatHm(clockedInAt)}</div>
                </div>
                <div className="qp-elapsed">{elapsed(clockedInAt, now)}</div>
              </div>
            )}

            <div className="qp-cta-wrap">
              {clockedOut ? (
                <div className="qp-clocked-status" style={{ marginBottom: 0 }}>
                  <div className="qp-status-text">
                    <div className="qp-status-label">Shift complete</div>
                    <div className="qp-status-time" style={{ fontSize: 14 }}>
                      See you next shift
                    </div>
                  </div>
                </div>
              ) : !isClockedIn ? (
                <button
                  className="qp-cta-btn clock-in"
                  onClick={() => beginAction('in')}
                  disabled={!location}
                >
                  <span className="qp-cta-icon">⏱</span>
                  Clock in
                </button>
              ) : (
                <button className="qp-cta-btn clock-out" onClick={() => beginAction('out')}>
                  <span className="qp-cta-icon">⏹</span>
                  Clock out
                </button>
              )}
            </div>
          </div>

          {/* ── Overlays ── */}
          {step === STEPS.GPS && (
            <div className="qp-overlay">
              <div className="qp-spinner" />
              <div className="qp-step-title">Checking your location</div>
              <div className="qp-step-sub">
                Make sure you&apos;re inside<br />
                <strong>{location?.name}</strong>
              </div>
            </div>
          )}

          {step === STEPS.PIN && (
            <PinPad
              title={action === 'in' ? 'Enter your PIN' : 'Confirm clock out'}
              subtitle={<>Your 6-digit PIN. <strong>Never share it</strong> with anyone.</>}
              error={pinError}
              busy={pinBusy}
              onClearError={() => setPinError(null)}
              onComplete={submitPin}
              onBack={() => setStep(STEPS.HOME)}
            />
          )}

          {step === STEPS.SELFIE && (
            <div className="qp-overlay">
              <div className="qp-step-title" style={{ marginBottom: 8 }}>Quick selfie check</div>
              <div className="qp-step-sub" style={{ marginBottom: 24 }}>
                A random check to confirm it&apos;s you. Take a clear photo of your face.
              </div>
              <div className="qp-camera-frame">
                🤳
                <div className="qp-camera-corner tl" />
                <div className="qp-camera-corner tr" />
                <div className="qp-camera-corner bl" />
                <div className="qp-camera-corner br" />
              </div>
              <input
                ref={selfieInput}
                type="file"
                accept="image/*"
                capture="user"
                style={{ display: 'none' }}
                onChange={(e) => handleSelfieFile(e.target.files?.[0] ?? null)}
              />
              <button
                className="qp-full-btn"
                disabled={selfieBusy}
                onClick={() => selfieInput.current?.click()}
              >
                {selfieBusy ? 'Uploading…' : 'Take photo'}
              </button>
              <button
                className="qp-full-btn ghost"
                disabled={selfieBusy}
                onClick={() => handleSelfieFile(null)}
              >
                Skip for now
              </button>
            </div>
          )}

          {step === STEPS.SUCCESS && (
            <div className="qp-overlay">
              {overlayError ? (
                <>
                  <div className="qp-step-icon" style={{ background: '#FCEBEB' }}>⚠️</div>
                  <div className="qp-step-title">Couldn&apos;t complete</div>
                  <div className="qp-step-sub">{overlayError}</div>
                  <button className="qp-full-btn" onClick={dismissOverlay}>Back</button>
                </>
              ) : (
                <>
                  <div className="qp-success-icon">✓</div>
                  <div className="qp-step-title">
                    {action === 'in' ? 'Clocked in!' : 'Clocked out!'}
                  </div>
                  <div className="qp-step-sub">
                    {action === 'in' ? (
                      <>
                        Your shift has started at <strong>{formatHm(clockedInAt)}</strong>. Have a good
                        shift{employee ? `, ${employee.first_name}` : ''}.
                      </>
                    ) : (
                      <>
                        Your shift has ended
                        {hoursWorked != null ? <> — <strong>{hoursWorked} hrs</strong> recorded</> : null}.
                        Total hours will be confirmed by your supervisor.
                      </>
                    )}
                  </div>
                  <button className="qp-full-btn" onClick={() => setStep(STEPS.HOME)}>Done</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

const css = `
  *, *::before, *::after { box-sizing: border-box; }

  .qp-root {
    font-family: 'DM Sans', sans-serif;
    background: #f0f4f2;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  }
  .qp-phone {
    width: 100%;
    max-width: 390px;
    min-height: 100vh;
    background: #fff;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
  }
  .qp-header {
    background: ${TEAL_DARK};
    padding: 52px 24px 24px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
  }
  .qp-logo {
    font-family: 'DM Mono', monospace;
    font-size: 15px; font-weight: 500;
    color: #5DCAA5; letter-spacing: 0.04em;
  }
  .qp-greeting { margin-top: 18px; }
  .qp-greeting-sub { font-size: 13px; color: #5DCAA5; font-weight: 400; margin-bottom: 3px; }
  .qp-greeting-name { font-size: 26px; font-weight: 600; color: #fff; line-height: 1.1; }
  .qp-avatar {
    width: 44px; height: 44px; border-radius: 50%;
    background: ${TEAL_MID}; display: flex; align-items: center; justify-content: center;
    font-size: 18px; font-weight: 600; color: #fff; flex-shrink: 0; margin-top: 4px;
  }
  .qp-shift-card {
    margin: 20px 20px 0; background: ${TEAL_LIGHT}; border-radius: 16px;
    padding: 18px 20px; border: 1px solid #9FE1CB;
  }
  .qp-shift-label {
    font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
    color: ${TEAL}; margin-bottom: 10px;
  }
  .qp-shift-location { font-size: 18px; font-weight: 600; color: ${TEAL_DARK}; margin-bottom: 4px; line-height: 1.2; }
  .qp-shift-address { font-size: 13px; color: ${TEAL}; margin-bottom: 14px; }
  .qp-shift-row { display: flex; gap: 12px; }
  .qp-shift-pill {
    background: #fff; border-radius: 8px; padding: 8px 12px;
    display: flex; flex-direction: column; gap: 2px; border: 1px solid #9FE1CB;
  }
  .qp-shift-pill-label { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: ${TEAL}; }
  .qp-shift-pill-val { font-size: 15px; font-weight: 600; color: ${TEAL_DARK}; font-family: 'DM Mono', monospace; }

  .qp-status-section {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 28px 24px 20px;
  }
  .qp-clock { font-family: 'DM Mono', monospace; font-size: 52px; font-weight: 500; color: ${TEAL_DARK}; letter-spacing: -0.02em; margin-bottom: 4px; line-height: 1; }
  .qp-date { font-size: 14px; color: #6b7280; margin-bottom: 32px; font-weight: 400; }

  .qp-text-input {
    width: 100%; padding: 16px 16px; border-radius: 14px; border: 1.5px solid #d1d5db;
    font-family: 'DM Mono', monospace; font-size: 18px; color: ${TEAL_DARK};
    outline: none; transition: border-color 0.15s;
  }
  .qp-text-input:focus { border-color: ${TEAL_MID}; }

  .qp-cta-wrap { width: 100%; margin-bottom: 16px; }
  .qp-cta-btn {
    width: 100%; padding: 22px 24px; border-radius: 18px; border: none;
    font-family: 'DM Sans', sans-serif; font-size: 18px; font-weight: 600; cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 10px;
    transition: transform 0.12s ease, opacity 0.12s ease; position: relative; overflow: hidden;
  }
  .qp-cta-btn:active { transform: scale(0.97); }
  .qp-cta-btn.clock-in { background: ${TEAL_MID}; color: #fff; }
  .qp-cta-btn.clock-out { background: #fff; color: ${TEAL_DARK}; border: 2px solid ${TEAL_MID}; }
  .qp-cta-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
  .qp-cta-icon { font-size: 22px; line-height: 1; }

  .qp-clocked-status {
    width: 100%; background: ${TEAL_LIGHT}; border-radius: 14px; padding: 16px 20px;
    display: flex; align-items: center; gap: 14px; margin-bottom: 14px; border: 1px solid #9FE1CB;
  }
  .qp-status-dot { width: 12px; height: 12px; border-radius: 50%; background: ${TEAL_MID}; flex-shrink: 0; animation: pulse 2s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  .qp-status-text { flex: 1; }
  .qp-status-label { font-size: 12px; color: ${TEAL}; font-weight: 500; margin-bottom: 2px; }
  .qp-status-time { font-size: 16px; font-weight: 600; color: ${TEAL_DARK}; font-family: 'DM Mono', monospace; }
  .qp-elapsed { font-size: 12px; color: ${TEAL}; font-family: 'DM Mono', monospace; }

  .qp-overlay {
    position: absolute; inset: 0; background: #fff;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 32px 28px; animation: slideUp 0.22s ease; z-index: 10;
  }
  @keyframes slideUp { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  .qp-step-icon {
    width: 80px; height: 80px; border-radius: 50%; background: ${TEAL_LIGHT};
    display: flex; align-items: center; justify-content: center; font-size: 36px; margin-bottom: 24px;
  }
  .qp-step-title { font-size: 22px; font-weight: 600; color: ${TEAL_DARK}; text-align: center; margin-bottom: 8px; line-height: 1.2; }
  .qp-step-sub { font-size: 14px; color: #6b7280; text-align: center; line-height: 1.6; margin-bottom: 36px; max-width: 280px; }
  .qp-step-sub strong { color: ${TEAL_DARK}; font-weight: 600; }

  .qp-pin-display { display: flex; gap: 14px; margin-bottom: 36px; }
  .qp-pin-dot { width: 18px; height: 18px; border-radius: 50%; border: 2px solid #d1d5db; transition: all 0.15s ease; }
  .qp-pin-dot.filled { background: ${TEAL_MID}; border-color: ${TEAL_MID}; transform: scale(1.1); }
  .qp-pin-dot.error { background: #E24B4A; border-color: #E24B4A; animation: shake 0.3s ease; }
  @keyframes shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
  .qp-keypad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; width: 100%; max-width: 280px; }
  .qp-key {
    aspect-ratio: 1; border-radius: 14px; border: none; background: #f3f4f6;
    font-family: 'DM Sans', sans-serif; font-size: 22px; font-weight: 500; color: ${TEAL_DARK};
    cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.1s, transform 0.1s;
  }
  .qp-key:active { background: #e5e7eb; transform: scale(0.93); }
  .qp-key.delete { background: transparent; font-size: 18px; color: #9ca3af; }
  .qp-key.empty { background: transparent; cursor: default; }

  .qp-spinner { width: 56px; height: 56px; border: 3px solid ${TEAL_LIGHT}; border-top-color: ${TEAL_MID}; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 28px; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .qp-camera-frame {
    width: 220px; height: 220px; border-radius: 50%; border: 3px solid ${TEAL_MID}; background: ${TEAL_LIGHT};
    display: flex; align-items: center; justify-content: center; font-size: 72px; margin-bottom: 28px; position: relative; overflow: hidden;
  }
  .qp-camera-corner { position: absolute; width: 28px; height: 28px; border-color: ${TEAL_MID}; border-style: solid; border-width: 0; }
  .qp-camera-corner.tl { top: 12px; left: 12px; border-top-width: 3px; border-left-width: 3px; border-radius: 4px 0 0 0; }
  .qp-camera-corner.tr { top: 12px; right: 12px; border-top-width: 3px; border-right-width: 3px; border-radius: 0 4px 0 0; }
  .qp-camera-corner.bl { bottom: 12px; left: 12px; border-bottom-width: 3px; border-left-width: 3px; border-radius: 0 0 0 4px; }
  .qp-camera-corner.br { bottom: 12px; right: 12px; border-bottom-width: 3px; border-right-width: 3px; border-radius: 0 0 4px 0; }

  .qp-success-icon {
    width: 100px; height: 100px; border-radius: 50%; background: ${TEAL_MID};
    display: flex; align-items: center; justify-content: center; font-size: 48px; margin-bottom: 28px;
    animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }
  @keyframes popIn { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }

  .qp-error-box {
    background: #FCEBEB; border: 1px solid #F7C1C1; border-radius: 12px; padding: 14px 18px;
    display: flex; gap: 10px; align-items: flex-start; width: 100%; max-width: 320px;
  }
  .qp-error-text { font-size: 13px; color: #791F1F; line-height: 1.5; }

  .qp-back { position: absolute; top: 52px; left: 20px; background: none; border: none; font-size: 26px; color: #9ca3af; cursor: pointer; padding: 4px; line-height: 1; z-index: 20; }
  .qp-back:disabled { opacity: 0.4; }

  .qp-full-btn {
    width: 100%; max-width: 320px; padding: 18px; border-radius: 14px; border: none;
    background: ${TEAL_MID}; color: #fff; font-family: 'DM Sans', sans-serif; font-size: 16px; font-weight: 600;
    cursor: pointer; transition: transform 0.1s, opacity 0.1s;
  }
  .qp-full-btn:active { transform: scale(0.97); }
  .qp-full-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .qp-full-btn.ghost { background: transparent; color: ${TEAL}; margin-top: 10px; }
`
