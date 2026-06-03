import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      // Run before Next.js route matching.
      // preview.abluo.app/studiomartegani → /it/studiomartegani
      // preview.abluo.app/studiomartegani/blog → /it/studiomartegani/blog
      beforeFiles: [
        // preview.abluo.app/[slug] → /it/[slug]
        {
          source: '/:slug((?!it(?:/|$)|en(?:/|$)|de(?:/|$)|studio(?:/|$)|api(?:/|$)|_next|favicon\\.ico).*)',
          destination: '/it/:slug',
          has: [{ type: 'host', value: 'preview.abluo.app' }],
        },
        // admin.abluo.app/ → /en/admin/dashboard
        {
          source: '/',
          destination: '/en/admin/dashboard',
          has: [{ type: 'host', value: 'admin.abluo.app' }],
        },
        // admin.abluo.app/[path] → /en/admin/[path]
        {
          source: '/:path((?!en(?:/|$)|it(?:/|$)|de(?:/|$)|api(?:/|$)|_next|favicon\\.ico).*)',
          destination: '/en/admin/:path',
          has: [{ type: 'host', value: 'admin.abluo.app' }],
        },
      ],
    }
  },
}

export default withNextIntl(nextConfig)
