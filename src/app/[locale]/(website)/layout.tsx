import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'

/**
 * Website layout — wraps all public tenant website routes.
 *
 * This is intentionally minimal. Its only job is to mount Vercel Analytics
 * and Speed Insights for every public page served under (website)/[tenant].
 *
 * Admin, Studio, client dashboard, login, and API routes all live in
 * separate route groups / directories and are NOT affected.
 */
export default function WebsiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Analytics />
      <SpeedInsights />
    </>
  )
}
