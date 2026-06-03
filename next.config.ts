import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// All domain-based routing is handled in proxy.ts (middleware).
const nextConfig: NextConfig = {
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
