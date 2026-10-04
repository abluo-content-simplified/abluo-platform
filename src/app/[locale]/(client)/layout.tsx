import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Inter } from 'next/font/google'
import { APP_THEME_COOKIE, appThemeAttribute, parseAppTheme } from '@/lib/app-theme'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'

/**
 * Client dashboard group layout (ADR-017 Phase 2 / task #81).
 *
 * Coarse authentication gate for the whole `(client)` route group: resolves the
 * caller's `TenantAuthorizationContext` once and redirects to `/login` when
 * there is no session. This is defence in depth — the proxy client-surface gate
 * (`src/proxy.ts` → `requireAuthenticatedInProxy`) already blocks anonymous
 * requests before the route renders — but the group must never assume the proxy
 * ran (e.g. a future host wiring, or direct RSC render). Per-project
 * authorization (which project, which modules) is decided deeper, in
 * `[tenant]/layout.tsx` and the data layer — never here.
 *
 * The project sidebar/shell is NOT built here: this layout sits above the
 * `[tenant]` (projectSlug) segment and has no active project. The user-level
 * `account` page renders directly inside this frame; project-scoped pages get
 * the sidebar from the nested `[tenant]/layout.tsx`.
 *
 * Abluo App design system (ADR-025 D7): this element is the `.abluo-app` root.
 * Its tokens are scoped here (globals.css) so tenant websites are untouched.
 * The theme comes from the `abluo-app-theme` cookie and is rendered on the
 * server, so the first paint is already right (no boot script, no flash).
 * Inter is loaded here only — tenant websites never download it.
 */
const inter = Inter({ subsets: ['latin'], variable: '--font-app', display: 'swap' })

export default async function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) {
    redirect(`/login?next=${encodeURIComponent(`/${locale}/account`)}`)
  }

  const theme = parseAppTheme((await cookies()).get(APP_THEME_COOKIE)?.value)

  return (
    <div
      className={`abluo-app ${inter.variable} min-h-screen`}
      data-theme={appThemeAttribute(theme)}
      data-surface="manage"
    >
      {children}
    </div>
  )
}
