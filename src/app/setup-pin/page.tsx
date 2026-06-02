'use client'
// src/app/setup-pin/page.tsx
// Picker follows their one-time WhatsApp link to set a 6-digit clock-in PIN.
// ?token=... -> validate (GET) -> enter PIN -> confirm -> save (POST).

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

const TEAL = '#0F6E56'
const TEAL_MID = '#1D9E75'
const TEAL_LIGHT = '#E1F5EE'
const TEAL_DARK = '#085041'

type Phase = 'loading' | 'invalid' | 'enter' | 'confirm' | 'saving' | 'done'

function Keypad({ pin, onPress, onDelete, error }: {
  pin: number[]
  onPress: (d: number) => void
  onDelete: () => void
  error: boolean
}) {
  const keys: (number | 'del' | null)[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'del']
  return (
    <>
      <div className="sp-pin-display">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`sp-pin-dot ${pin.length > i ? (error ? 'error' : 'filled') : ''}`} />
        ))}
      </div>
      <div className="sp-keypad">
        {keys.map((k, i) => {
          if (k === null) return <div key={i} className="sp-key empty" />
          if (k === 'del') return <button key={i} className="sp-key delete" onClick={onDelete}>⌫</button>
          return <button key={i} className="sp-key" onClick={() => onPress(k)}>{k}</button>
        })}
      </div>
    </>
  )
}

function SetupPinFlow() {
  const params = useSearchParams()
  const token = params.get('token')

  const [phase, setPhase] = useState<Phase>('loading')
  const [firstName, setFirstName] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [first, setFirst] = useState<number[]>([])
  const [confirm, setConfirm] = useState<number[]>([])
  const [pinErr, setPinErr] = useState(false)

  useEffect(() => {
    if (!token) {
      setPhase('invalid')
      setError('This link is missing its token. Ask your supervisor for a new one.')
      return
    }
    ;(async () => {
      try {
        const res = await fetch(`/api/setup-pin?token=${encodeURIComponent(token)}`)
        const data = await res.json()
        if (data.valid) {
          setFirstName(data.first_name || '')
          setPhase('enter')
        } else {
          setPhase('invalid')
          setError(data.error || 'This link is no longer valid.')
        }
      } catch {
        setPhase('invalid')
        setError('Network error. Please try again.')
      }
    })()
  }, [token])

  async function save(pin: string) {
    setPhase('saving')
    setError(null)
    try {
      const res = await fetch('/api/setup-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, pin }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not save your PIN.')
        // Let them retry from the start.
        setFirst([])
        setConfirm([])
        setPhase('enter')
        return
      }
      setFirstName(data.first_name || firstName)
      setPhase('done')
    } catch {
      setError('Network error. Please try again.')
      setFirst([])
      setConfirm([])
      setPhase('enter')
    }
  }

  function pressEnter(d: number) {
    setFirst((prev) => {
      if (prev.length >= 6) return prev
      const next = [...prev, d]
      if (next.length === 6) setTimeout(() => setPhase('confirm'), 180)
      return next
    })
  }

  function pressConfirm(d: number) {
    if (pinErr) {
      setPinErr(false)
      setConfirm([d])
      return
    }
    setConfirm((prev) => {
      if (prev.length >= 6) return prev
      const next = [...prev, d]
      if (next.length === 6) {
        setTimeout(() => {
          if (next.join('') === first.join('')) {
            save(next.join(''))
          } else {
            setPinErr(true)
          }
        }, 180)
      }
      return next
    })
  }

  return (
    <div className="sp-root">
      <style>{css}</style>
      <div className="sp-phone">
        <div className="sp-header">
          <div className="sp-logo">QUICKPRIME</div>
        </div>

        <div className="sp-body">
          {phase === 'loading' && (
            <>
              <div className="sp-spinner" />
              <div className="sp-title">Checking your link…</div>
            </>
          )}

          {phase === 'invalid' && (
            <>
              <div className="sp-icon" style={{ background: '#FCEBEB' }}>⚠️</div>
              <div className="sp-title">Link not valid</div>
              <div className="sp-sub">{error}</div>
            </>
          )}

          {(phase === 'enter' || phase === 'saving') && (
            <>
              <div className="sp-icon">🔑</div>
              <div className="sp-title">
                {firstName ? `Hi ${firstName}, set your PIN` : 'Set your PIN'}
              </div>
              <div className="sp-sub">
                Choose a <strong>6-digit PIN</strong> you&apos;ll use to clock in. Don&apos;t share it
                with anyone.
              </div>
              {error && <div className="sp-error">{error}</div>}
              <Keypad pin={first} onPress={pressEnter} onDelete={() => setFirst((p) => p.slice(0, -1))} error={false} />
              {phase === 'saving' && <div className="sp-sub" style={{ marginTop: 18 }}>Saving…</div>}
            </>
          )}

          {phase === 'confirm' && (
            <>
              <div className="sp-icon">🔁</div>
              <div className="sp-title">Confirm your PIN</div>
              <div className="sp-sub">
                {pinErr ? 'PINs did not match. Enter it again.' : 'Type the same 6 digits once more.'}
              </div>
              <Keypad pin={confirm} onPress={pressConfirm} onDelete={() => setConfirm((p) => p.slice(0, -1))} error={pinErr} />
              <button className="sp-link" onClick={() => { setFirst([]); setConfirm([]); setPinErr(false); setPhase('enter') }}>
                Start over
              </button>
            </>
          )}

          {phase === 'done' && (
            <>
              <div className="sp-success">✓</div>
              <div className="sp-title">PIN set{firstName ? `, ${firstName}` : ''}!</div>
              <div className="sp-sub">You can now clock in from the QuickPrime app.</div>
              <a className="sp-btn" href="/clock-in">Go to clock-in</a>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function SetupPinPage() {
  return (
    <Suspense fallback={null}>
      <SetupPinFlow />
    </Suspense>
  )
}

const css = `
  *, *::before, *::after { box-sizing: border-box; }
  .sp-root { font-family: 'DM Sans', sans-serif; background: #f0f4f2; min-height: 100vh; display: flex; justify-content: center; -webkit-tap-highlight-color: transparent; user-select: none; }
  .sp-phone { width: 100%; max-width: 390px; min-height: 100vh; background: #fff; display: flex; flex-direction: column; }
  .sp-header { background: ${TEAL_DARK}; padding: 52px 24px 24px; }
  .sp-logo { font-family: 'DM Mono', monospace; font-size: 15px; font-weight: 500; color: #5DCAA5; letter-spacing: 0.04em; }
  .sp-body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 36px 28px; }
  .sp-icon { width: 80px; height: 80px; border-radius: 50%; background: ${TEAL_LIGHT}; display: flex; align-items: center; justify-content: center; font-size: 36px; margin-bottom: 24px; }
  .sp-title { font-size: 22px; font-weight: 600; color: ${TEAL_DARK}; text-align: center; margin-bottom: 8px; line-height: 1.2; }
  .sp-sub { font-size: 14px; color: #6b7280; text-align: center; line-height: 1.6; margin-bottom: 32px; max-width: 280px; }
  .sp-sub strong { color: ${TEAL_DARK}; font-weight: 600; }
  .sp-error { background: #FCEBEB; border: 1px solid #F7C1C1; border-radius: 12px; padding: 12px 16px; font-size: 13px; color: #791F1F; line-height: 1.5; max-width: 300px; margin-bottom: 22px; text-align: center; }
  .sp-pin-display { display: flex; gap: 14px; margin-bottom: 32px; }
  .sp-pin-dot { width: 18px; height: 18px; border-radius: 50%; border: 2px solid #d1d5db; transition: all 0.15s ease; }
  .sp-pin-dot.filled { background: ${TEAL_MID}; border-color: ${TEAL_MID}; transform: scale(1.1); }
  .sp-pin-dot.error { background: #E24B4A; border-color: #E24B4A; animation: shake 0.3s ease; }
  @keyframes shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
  .sp-keypad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; width: 100%; max-width: 280px; }
  .sp-key { aspect-ratio: 1; border-radius: 14px; border: none; background: #f3f4f6; font-family: 'DM Sans', sans-serif; font-size: 22px; font-weight: 500; color: ${TEAL_DARK}; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.1s, transform 0.1s; }
  .sp-key:active { background: #e5e7eb; transform: scale(0.93); }
  .sp-key.delete { background: transparent; font-size: 18px; color: #9ca3af; }
  .sp-key.empty { background: transparent; cursor: default; }
  .sp-spinner { width: 56px; height: 56px; border: 3px solid ${TEAL_LIGHT}; border-top-color: ${TEAL_MID}; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 28px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .sp-success { width: 100px; height: 100px; border-radius: 50%; background: ${TEAL_MID}; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 48px; margin-bottom: 28px; animation: popIn 0.3s cubic-bezier(0.175,0.885,0.32,1.275); }
  @keyframes popIn { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  .sp-btn { display: inline-block; padding: 16px 28px; border-radius: 14px; background: ${TEAL_MID}; color: #fff; font-size: 16px; font-weight: 600; text-decoration: none; }
  .sp-link { margin-top: 18px; background: none; border: none; color: ${TEAL}; font-family: 'DM Sans', sans-serif; font-size: 14px; cursor: pointer; }
`
