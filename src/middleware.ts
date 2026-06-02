// src/middleware.ts
// Refreshes the Supabase auth session on every request and guards the
// ops dashboard. Pickers (PIN auth) and the login page are left alone.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '@/lib/supabase-config'

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req })

  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
          res = NextResponse.next({ request: req })
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: getUser() revalidates the token with Supabase (don't trust
  // getSession() alone in middleware).
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = req.nextUrl

  // Guard the ops dashboard.
  if (pathname.startsWith('/dashboard') && !user) {
    const loginUrl = req.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Bounce already-authenticated ops away from the login page.
  if (pathname === '/login' && user) {
    const dashUrl = req.nextUrl.clone()
    dashUrl.pathname = '/dashboard'
    dashUrl.search = ''
    return NextResponse.redirect(dashUrl)
  }

  return res
}

export const config = {
  // Run on dashboard + login only; skip static assets, API routes, and the
  // picker-facing pages (which use PIN auth, not Supabase sessions).
  matcher: ['/dashboard/:path*', '/login'],
}
