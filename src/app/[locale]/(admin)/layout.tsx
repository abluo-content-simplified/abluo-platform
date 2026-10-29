import { cookies } from 'next/headers'
import { dashboardAppMetadata, dashboardViewport } from '@/lib/app-install'
import { redirect } from 'next/navigation'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { NewVersionNotice } from '@/components/system/NewVersionNotice'
import { PresenceHeartbeat } from '@/components/system/PresenceHeartbeat'
import { AppRoot } from '@/components/app/AppRoot'
import { UploadsProvider } from '@/components/client/media/UploadsProvider'
import { resolveAdminAccess } from '@/lib/api/auth'
import { getViewerAccount } from '@/lib/api/viewer-account'
import { countAdminUnread } from '@/lib/support-tickets/service'
import { APP_TEXT_SIZE_COOKIE, APP_THEME_COOKIE, parseAppTextSize, parseAppTheme } from '@/lib/app-theme'

// Installable dashboard (manifest, icons, theme colour): dashboards only, never the websites.
export const metadata = dashboardAppMetadata
export const viewport = dashboardViewport

/**
 * Defence in depth for the admin dashboard. `src/proxy.ts` already gates every
 * admin surface on `abluo_admin` + two-factor (AAL2), but these pages read
 * with the SERVICE ROLE (e.g. `projects/page.tsx`), so they must not depend on
 * a middleware matcher alone being right. Same decision, same helper as every
 * admin API route (`resolveAdminAccess` → `admin-assurance.ts`).
 *
 * The frame is the shared Abluo App one (ADR-030): `AppRoot` (tokens, theme,
 * text size) + the admin's composition of `AppSidebar`. The account menu shows
 * the signed-in admin, read as themselves (`getViewerAccount`, no service
 * role), with the platform role as the role line. There is no admin profile
 * page yet, so the Profile row is hidden; Help shows only when configured.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { decision, actor } = await resolveAdminAccess()
  if (decision === 'login') redirect('/login')
  if (decision === 'unauthorized') redirect('/unauthorized')
  if (decision === 'mfa') redirect('/mfa')
  // `allow` always carries the actor; the check keeps that a fact, not an assumption.
  if (!actor) redirect('/login')

  // Unread support tickets for the nav badge. Never blocks the page: any failure (e.g. migration 046 not applied) is 0.
  const [viewer, jar, supportUnread] = await Promise.all([
    getViewerAccount(actor.userId),
    cookies(),
    countAdminUnread(actor.userId).catch(() => 0),
  ])

  return (
    <AppRoot surface="admin">
      <UploadsProvider>
      <div className="min-h-screen md:flex">
        <AdminSidebar
          supportUnread={supportUnread}
          account={{
            name: viewer.name,
            email: viewer.email,
            avatarUrl: viewer.avatarUrl,
            theme: parseAppTheme(jar.get(APP_THEME_COOKIE)?.value),
            textSize: parseAppTextSize(jar.get(APP_TEXT_SIZE_COOKIE)?.value),
            helpUrl: process.env.ABLUO_HELP_URL || null,
            profileHref: null,
            role: actor.platformRole,
          }}
        />
        <div className="min-h-screen min-w-0 flex-1 md:ml-56">
          {/* Phones: clear the fixed bottom bar (about 4.25rem) plus the home-indicator inset. */}
          <main className="p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:p-6 md:pb-6">
            <NewVersionNotice className="mb-4" />
            <PresenceHeartbeat />
            {children}
          </main>
        </div>
      </div>
      </UploadsProvider>
    </AppRoot>
  )
}
