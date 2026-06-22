'use client'
// Shown when an authenticated Supabase user has no matching ops_users row.

import { createBrowserSupabaseClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function NoProfile({ email }: { email: string | null }) {
  const router = useRouter()
  async function signOut() {
    await createBrowserSupabaseClient().auth.signOut()
    router.replace('/login')
    router.refresh()
  }
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <div style={{ fontFamily: "var(--font-jakarta), sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--white)', marginBottom: 10 }}>
          No ops profile linked
        </div>
        <p style={{ color: 'var(--dim)', fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
          You&apos;re signed in as <strong style={{ color: 'var(--white-mid)' }}>{email}</strong>, but
          there&apos;s no <code>ops_users</code> record linked to this account. Ask an admin to add you,
          then sign in again.
        </p>
        <button
          onClick={signOut}
          style={{ background: 'var(--teal-mid)', color: '#1B2B2B', border: 'none', borderRadius: 10, padding: '12px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
