// src/app/layout.tsx
import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'

// next/font hashes the family name, so it MUST be referenced via its CSS
// variable (--font-jakarta) — which every component's CSS already uses. DM Mono
// stays on the trimmed Google <link> below because components reference the
// literal 'DM Mono' name for tabular figures (clock/IDs).
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'OpsPro',
  description: 'Workforce Management Platform',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

// Colocate functions with the ap-south-1 (Mumbai) Supabase DB. bom1 = Vercel
// Mumbai; default was iad1 (US East), so every DB/auth call was crossing
// DC↔Mumbai. Cascades to nested route segments.
export const preferredRegion = 'bom1'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={jakarta.variable}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
