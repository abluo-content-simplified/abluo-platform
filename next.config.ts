import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// All domain-based routing is handled in proxy.ts (middleware).
// next.config.ts rewrites are avoided because the has:[{type:'host'}]
// condition is unreliable — it applies to all domains regardless of the
// host filter, causing /studio to be rewritten to /it/studio everywhere.
const nextConfig: NextConfig = {}

export default withNextIntl(nextConfig)
