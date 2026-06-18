import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const packageJson = require('./package.json') as { version: string }

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// All domain-based routing is handled in proxy.ts (middleware).
const nextConfig: NextConfig = {
  // ── Build-time deployment metadata ─────────────────────────────────────────
  // Baked in at build time so client components can read them as NEXT_PUBLIC_*
  // without exposing server-only VERCEL_* variables.
  env: {
    NEXT_PUBLIC_VERCEL_ENV:     process.env.VERCEL_ENV            ?? 'development',
    NEXT_PUBLIC_APP_VERSION:    packageJson.version,
    NEXT_PUBLIC_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
    NEXT_PUBLIC_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF ?? 'local',
    NEXT_PUBLIC_BUILD_TIME:     new Date().toISOString(),
  },
  async headers() {
    return [
      {
        // Prevent Vercel CDN from caching any tenant website response.
        // Without this, a 404 on /[slug] gets cached before middleware runs.
        source: '/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ]
  },
}

export default withNextIntl(nextConfig)
