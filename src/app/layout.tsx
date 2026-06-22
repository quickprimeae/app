// src/app/layout.tsx
import type { Metadata, Viewport } from 'next'
import './globals.css'

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
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700&family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&family=Fraunces:ital,wght@0,300;0,400;1,300&display=swap"
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
