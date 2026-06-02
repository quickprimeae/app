// src/lib/supabase-config.ts
// Resolves the Supabase URL + publishable (anon-equivalent) key.
//
// Supabase's new API keys come as opaque strings:
//   • sb_publishable_…  → browser / SSR (anon role, RLS-enforced)
//   • sb_secret_…       → server-only full access (resolved in supabase.ts)
// supabase-js (≥ 2.49) sends whatever key string you pass as the `apikey`
// header — it does NOT parse it as a JWT — so both the new format and legacy
// `eyJ…` keys work without any special handling.
//
// We accept the new canonical env var names and fall back to the legacy ones,
// so rotating to the new format only requires swapping the values (or adding
// the new-named vars). This module is dependency-free so it is safe to import
// from the browser, the edge middleware, and server code alike.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!

export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
