import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { AppRoot } from '@/components/app/AppRoot'
import { resolveAdminAccess } from '@/lib/api/auth'
import { getViewerAccount } from '@/lib/api/viewer-account'
import { APP_TEXT_SIZE_COOKIE, APP_THEME_COOKIE, parseAppTextSize, parseAppTheme } from '@/lib/app-theme'

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

  const [viewer, jar] = await Promise.all([getViewerAccount(actor.userId), cookies()])

  return (
    <AppRoot surface="admin">
      <div className="min-h-screen md:flex">
        <AdminSidebar
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
          <main className="p-4 md:p-6">{children}</main>
        </div>
      </div>
    </AppRoot>
  )
}
