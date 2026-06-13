// src/app/dashboard/layout.tsx
// Shared layout for every /dashboard/* page: renders the persistent navigation
// shell around the page content. Per-page session guards still live in each
// page.tsx (a redirect there short-circuits this layout's output).
import DashboardShell from './DashboardShell'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>
}
