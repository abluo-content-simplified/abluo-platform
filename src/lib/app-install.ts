import type { Metadata, Viewport } from 'next'

/**
 * Installable dashboards ("Add to Home Screen") — the client dashboard and the
 * admin only. Tenant websites never reference the manifest (a client's site is
 * the client's own, not an Abluo app); a test guards that.
 *
 * Static files live in `public/dashboard/` (placeholder icons, regenerate with
 * `scripts/make-app-icons.mjs`). The manifest is `.json` so `src/proxy.ts`'s
 * static-asset bypass serves it without auth, locale or tenant routing.
 */
export const DASHBOARD_MANIFEST_URL = '/dashboard/manifest.json'

/** Light / dark `--background` of `.abluo-app` (globals.css). */
export const DASHBOARD_THEME_LIGHT = '#ffffff'
export const DASHBOARD_THEME_DARK = '#0f1012'

export const dashboardAppMetadata: Metadata = {
  manifest: DASHBOARD_MANIFEST_URL,
  appleWebApp: { capable: true, title: 'Abluo', statusBarStyle: 'default' },
  icons: { apple: [{ url: '/dashboard/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }] },
}

export const dashboardViewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: DASHBOARD_THEME_LIGHT },
    { media: '(prefers-color-scheme: dark)', color: DASHBOARD_THEME_DARK },
  ],
  viewportFit: 'cover',
}
