// src/lib/supabase-server.ts
// SERVER-ONLY. Cookie-bound Supabase client for Server Components and Route
// Handlers — sees the logged-in ops user's session. Kept separate from
// supabase.ts because it imports next/headers, which must never reach the
// browser bundle.

import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config'

export async function createServerComponentClient() {
  const cookieStore = await cookies()
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // Server Component context — middleware refreshes cookies.
        }
      },
    },
  })
}
