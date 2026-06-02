// src/app/page.tsx
// Root route — redirects based on session
// Ops team → /dashboard
// Pickers → /clock-in
// Not logged in → /login

import { redirect } from 'next/navigation'

export default function RootPage() {
  // For now redirect to login. 
  // Once auth middleware is added this will check session first.
  redirect('/login')
}
