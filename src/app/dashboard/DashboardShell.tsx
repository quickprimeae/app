'use client'
// src/app/dashboard/DashboardShell.tsx
// Persistent ops navigation shell. Wraps every /dashboard/* page so the sidebar
// (Operations / Payroll / Admin) stays mounted across navigations — sub-pages
// render into the content column to the right and keep their own headers.
// Collapsible on desktop; a hamburger drawer below ~900px.

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase'

const T = {
  bg: '#0a0f0d', bgCard: '#111815', bgHover: '#161e1a', bgSubtle: '#0f1712',
  border: '#1e2b24', borderMid: '#243329', teal: '#0F6E56', tealBright: '#25D09A',
  tealText: '#5DCAA5', tealFaint: '#0d1f18', white: '#f0f7f4', whiteMid: '#c8ddd6',
  dim: '#6b8078', dimMid: '#4a6058', red: '#ef4444',
}

type NavItem = { icon: string; label: string; href: string }

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: 'Operations',
    items: [
      { icon: '⬛', label: 'Live dashboard', href: '/dashboard' },
      { icon: '👥', label: 'Employees', href: '/dashboard/employees' },
      { icon: '📍', label: 'Locations', href: '/dashboard/locations' },
      { icon: '🔔', label: 'All alerts', href: '/dashboard/alerts' },
    ],
  },
  {
    label: 'Schedule',
    items: [
      { icon: '📅', label: 'Roster', href: '/dashboard/roster' },
      { icon: '📥', label: 'Import schedule', href: '/dashboard/roster/import' },
    ],
  },
  {
    label: 'Payroll',
    items: [
      { icon: '🕐', label: 'Hours & verification', href: '/dashboard/payroll/hours' },
      { icon: '🧾', label: 'Invoices', href: '/dashboard/invoices' },
      { icon: '💰', label: 'Payroll summary', href: '/dashboard/payroll' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { icon: '➕', label: 'Add employees', href: '/dashboard/employees/new' },
      { icon: '🔗', label: 'Pending invites', href: '/dashboard/employees/invites' },
    ],
  },
]

const ALL_ITEMS = NAV.flatMap((s) => s.items)

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setMobileOpen(false) }, [pathname])

  // Pick the single most-specific matching nav item as the active route.
  const activeHref = ALL_ITEMS
    .filter((n) => pathname === n.href || pathname.startsWith(n.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href

  const signOut = useCallback(async () => {
    await createBrowserSupabaseClient().auth.signOut()
    router.replace('/login')
    router.refresh()
  }, [router])

  return (
    <>
      <style>{css}</style>
      <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
        <button
          className="shell-hamburger"
          aria-label="Open navigation"
          onClick={() => setMobileOpen((o) => !o)}
        >
          {mobileOpen ? '✕' : '☰'}
        </button>

        {mobileOpen && <div className="shell-scrim" onClick={() => setMobileOpen(false)} />}

        <aside className={`shell-sidebar ${mobileOpen ? 'open' : ''}`}>
          <div className="shell-brand">
            <Link href="/dashboard" className="shell-logo">{collapsed ? 'OP' : 'OPSPRO'}</Link>
            <button
              className="shell-collapse"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={() => setCollapsed((c) => !c)}
            >
              {collapsed ? '»' : '«'}
            </button>
          </div>

          <nav className="shell-nav">
            {NAV.map((section) => (
              <div key={section.label} className="shell-nav-section">
                <div className="shell-nav-label">{section.label}</div>
                {section.items.map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`shell-nav-item ${n.href === activeHref ? 'active' : ''}`}
                    title={collapsed ? n.label : undefined}
                  >
                    <span className="shell-nav-icon">{n.icon}</span>
                    <span className="shell-nav-text">{n.label}</span>
                  </Link>
                ))}
              </div>
            ))}
          </nav>

          <div className="shell-footer">
            <button className="shell-nav-item" onClick={signOut} title={collapsed ? 'Sign out' : undefined}>
              <span className="shell-nav-icon">⏏</span>
              <span className="shell-nav-text">Sign out</span>
            </button>
          </div>
        </aside>

        <div className="shell-content">{children}</div>
      </div>
    </>
  )
}

const css = `
.shell { display: flex; min-height: 100vh; background: ${T.bg}; }
.shell-sidebar {
  width: 220px; flex-shrink: 0; background: ${T.bgCard}; border-right: 1px solid ${T.border};
  display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh;
  align-self: flex-start; overflow-y: auto; transition: width 0.16s ease; z-index: 300;
}
.shell.collapsed .shell-sidebar { width: 64px; }
.shell-brand { display: flex; align-items: center; justify-content: space-between; padding: 16px 16px 14px; height: 56px; border-bottom: 1px solid ${T.border}; }
.shell-logo { font-family: 'DM Mono', monospace; font-size: 13px; font-weight: 500; color: ${T.tealBright}; letter-spacing: 0.06em; text-decoration: none; white-space: nowrap; }
.shell-collapse { background: none; border: 1px solid ${T.border}; color: ${T.dim}; width: 24px; height: 24px; border-radius: 6px; cursor: pointer; font-size: 13px; line-height: 1; flex-shrink: 0; transition: color 0.12s, border-color 0.12s; }
.shell-collapse:hover { color: ${T.tealBright}; border-color: ${T.teal}; }
.shell.collapsed .shell-collapse { display: none; }
.shell.collapsed .shell-brand { justify-content: center; padding: 16px 0 14px; }
.shell-nav { flex: 1; padding: 18px 0; }
.shell-nav-section { padding: 0 12px; margin-bottom: 24px; }
.shell-nav-label { font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: ${T.dimMid}; padding: 0 8px; margin-bottom: 6px; }
.shell.collapsed .shell-nav-label { opacity: 0; height: 6px; margin-bottom: 0; overflow: hidden; }
.shell-nav-item { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px; cursor: pointer; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; color: ${T.dim}; transition: background 0.12s, color 0.12s; border: none; background: none; width: 100%; text-align: left; text-decoration: none; }
.shell-nav-item:hover { background: ${T.bgHover}; color: ${T.whiteMid}; }
.shell-nav-item.active { background: ${T.tealFaint}; color: ${T.tealBright}; }
.shell-nav-icon { font-size: 15px; width: 18px; text-align: center; flex-shrink: 0; }
.shell-nav-text { white-space: nowrap; overflow: hidden; }
.shell.collapsed .shell-nav-text { display: none; }
.shell.collapsed .shell-nav-item { justify-content: center; padding: 9px 0; }
.shell-footer { padding: 12px; border-top: 1px solid ${T.border}; }
.shell-content { flex: 1; min-width: 0; }
.shell-hamburger { display: none; }
.shell-scrim { display: none; }

@media (max-width: 900px) {
  .shell-sidebar {
    position: fixed; top: 0; left: 0; height: 100vh; width: 240px;
    transform: translateX(-100%); transition: transform 0.2s ease;
  }
  .shell.collapsed .shell-sidebar { width: 240px; }
  .shell-sidebar.open { transform: none; box-shadow: 0 0 40px rgba(0,0,0,0.5); }
  .shell.collapsed .shell-nav-text, .shell.collapsed .shell-nav-label { display: block; opacity: 1; height: auto; }
  .shell.collapsed .shell-nav-item { justify-content: flex-start; padding: 9px 10px; }
  .shell-collapse { display: none; }
  .shell.collapsed .shell-collapse { display: none; }
  .shell-scrim { display: block; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 290; }
  .shell-hamburger {
    display: flex; align-items: center; justify-content: center;
    position: fixed; top: 9px; left: 10px; z-index: 350;
    width: 38px; height: 38px; border-radius: 9px;
    background: ${T.bgCard}; border: 1px solid ${T.borderMid}; color: ${T.tealBright};
    font-size: 17px; cursor: pointer;
  }
  /* Shift sub-page sticky headers clear of the floating hamburger. */
  .db-topbar, .ep-topbar, .lp-topbar, .al-topbar, .iv-topbar, .py-topbar, .hv-topbar, .si-topbar, .rs-topbar { padding-left: 58px !important; }
}
`
