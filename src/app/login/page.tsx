'use client'
// src/app/login/page.tsx
// Ops team login via Supabase Auth (email + password).

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') || '/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createBrowserSupabaseClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (signInError) {
      setError(signInError.message)
      setLoading(false)
      return
    }

    // Full reload so middleware + server components pick up the new cookies.
    router.replace(next)
    router.refresh()
  }

  return (
    <div className="lg-root">
      <style>{css}</style>
      <form className="lg-card" onSubmit={handleSubmit}>
        <div className="lg-logo">OPSPRO</div>
        <h1 className="lg-title">Ops sign in</h1>
        <p className="lg-sub">Workforce management dashboard</p>

        <label className="lg-label" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          className="lg-input"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <label className="lg-label" htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          className="lg-input"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && <div className="lg-error">{error}</div>}

        <button className="lg-btn" type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

const css = `
.lg-root {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(1200px 600px at 50% -10%, #0d1f18 0%, var(--bg) 60%);
}
.lg-card {
  width: 100%;
  max-width: 380px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 36px 32px;
  display: flex;
  flex-direction: column;
}
.lg-logo {
  font-family: 'DM Mono', monospace;
  font-size: 13px;
  letter-spacing: 0.08em;
  color: var(--teal-bright);
  margin-bottom: 28px;
}
.lg-title {
  font-family: 'Syne', sans-serif;
  font-size: 24px;
  font-weight: 700;
  color: var(--white);
  margin-bottom: 4px;
}
.lg-sub { font-size: 13px; color: var(--dim); margin-bottom: 28px; }
.lg-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--dim);
  margin-bottom: 6px;
}
.lg-input {
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 11px 12px;
  font-family: 'DM Sans', sans-serif;
  font-size: 14px;
  color: var(--white);
  margin-bottom: 18px;
  outline: none;
  transition: border-color 0.15s;
}
.lg-input:focus { border-color: var(--teal); }
.lg-error {
  background: var(--red-bg);
  border: 1px solid #3d1a1a;
  color: #fca5a5;
  font-size: 13px;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 16px;
}
.lg-btn {
  background: var(--teal-mid);
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 13px;
  font-family: 'DM Sans', sans-serif;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 4px;
  transition: opacity 0.15s, transform 0.1s;
}
.lg-btn:hover:not(:disabled) { opacity: 0.9; }
.lg-btn:active:not(:disabled) { transform: scale(0.99); }
.lg-btn:disabled { opacity: 0.5; cursor: not-allowed; }
`
