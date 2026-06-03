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
        {
          source: '/:slug((?!it|en|de|studio|api|_next|favicon\\.ico).*)',
          destination: '/it/:slug',
          has: [{ type: 'host', value: 'preview.abluo.app' }],
        },
      ],
    }
  },
}

export default withNextIntl(nextConfig)
