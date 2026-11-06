import type { Metadata, Viewport } from 'next'

/**
 * Installable dashboards ("Add to Home Screen") — the client dashboard and the
 * admin only. Tenant websites never reference the manifest (a client's site is
 * the client's own, not an Abluo app); a test guards that.
 *
 * Two icon sets from the abluo sigil "a." (Tom, 2026-11-06): the LIGHT one
 * (white tile) for everything clients see — the client dashboard and the
 * sign-in / invite pages — in `public/dashboard/`; the DARK one (charcoal tile)
 * for everything admin-facing — the Abluo admin and Studio — in
 * `public/dashboard/admin/`, which is also the platform `/favicon.ico`.
 * Master artwork + build script: ~/Abluo/Abluo/company/brand/logo/option-2/favicon/.
 * The manifests are `.json` so `src/proxy.ts`'s static-asset bypass serves them
 * without auth, locale or tenant routing.
 */
export const DASHBOARD_MANIFEST_URL = '/dashboard/manifest.json'
export const ADMIN_MANIFEST_URL = '/dashboard/admin/manifest.json'

/** Browser-tab icons: SVG first, a 32px PNG for browsers without SVG favicons. */
const tabIcons = (dir: string) => [
  { url: `${dir}/favicon.svg`, type: 'image/svg+xml' },
  { url: `${dir}/favicon-32.png`, sizes: '32x32', type: 'image/png' },
]

/** Light set — client-facing pages (client dashboard, sign-in, invite). */
export const clientIcons: Metadata['icons'] = {
  icon: tabIcons('/dashboard'),
  apple: [{ url: '/dashboard/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
}

/** Dark set — admin-facing pages (Abluo admin, Studio). */
export const adminIcons: Metadata['icons'] = {
  icon: tabIcons('/dashboard/admin'),
  apple: [{ url: '/dashboard/admin/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
}

/** Light / dark `--background` of `.abluo-app` (globals.css). */
export const DASHBOARD_THEME_LIGHT = '#ffffff'
export const DASHBOARD_THEME_DARK = '#0f1012'

/** The client dashboard (installable, light icons). */
export const dashboardAppMetadata: Metadata = {
  manifest: DASHBOARD_MANIFEST_URL,
  appleWebApp: { capable: true, title: 'Abluo', statusBarStyle: 'default' },
  icons: clientIcons,
}

/** The Abluo admin (installable, dark icons). */
export const adminAppMetadata: Metadata = {
  manifest: ADMIN_MANIFEST_URL,
  appleWebApp: { capable: true, title: 'Abluo Admin', statusBarStyle: 'default' },
  icons: adminIcons,
}

export const dashboardViewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: DASHBOARD_THEME_LIGHT },
    { media: '(prefers-color-scheme: dark)', color: DASHBOARD_THEME_DARK },
  ],
  viewportFit: 'cover',
}
