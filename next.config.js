/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this project (a stale Next 14 scaffold one level
  // up also has a lockfile, which otherwise confuses Next's root inference).
  outputFileTracingRoot: __dirname,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        port: '',
        pathname: '/storage/v1/object/**',
      },
    ],
  },
  // Security headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',         value: 'DENY' },
          { key: 'X-Content-Type-Options',   value: 'nosniff' },
          { key: 'Referrer-Policy',          value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',       value: 'geolocation=(self), camera=(self)' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
