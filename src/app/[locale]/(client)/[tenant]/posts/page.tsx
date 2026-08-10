import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { getDashboardPosts, type DashboardPost } from '@/lib/api/client-dashboard'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'

/**
 * Client dashboard — Posts list. ADR-017 slice 6 (Phase 1 read path) relocated
 * under the `[tenant]` (projectSlug) segment in Phase 2 (task #81).
 *
 * The active project is now the URL's first path segment (`params.tenant`),
 * re-validated against `ctx.projects` via `resolveProjectGrant` — the ADR-017
 * no-silent-substitute rule (Tom's locked decision #1). An ungranted slug is a
 * `notFound()`, never a fallback to `ctx.projects[0]` (the Phase 1 behaviour
 * this page replaces).
 *
 * Defence in depth: `[tenant]/layout.tsx` already validates the slug and the
 * `(client)` layout already gates the session, but this page still checks both
 * itself — the same belt-and-braces posture as the rest of the dashboard.
 *
 * All user-facing copy comes from the `clientDashboard` next-intl namespace —
 * no hardcoded strings (Multilingual-First).
 */
export default async function PostsPage({
  params,
}: {
  params: Promise<{ tenant: string }>
}) {
  const { tenant: projectSlug } = await params

  const ctx = await getTenantAuthorizationContext()
  if (!ctx) {
    redirect(`/login?next=/${projectSlug}/posts`)
  }

  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) {
    notFound()
  }

  const locale = await getLocale()
  const t = await getTranslations('clientDashboard')

  let posts: DashboardPost[] = []
  let moduleNotInstalled = false
  try {
    posts = await getDashboardPosts(ctx, grant.projectId, { locale })
  } catch (error) {
    // A denial here (most likely: the blog module is not installed for this
    // project) is an expected, localized state — not a crash. Anything that
    // is NOT a TenantAuthorizationError is a real fault and re-thrown.
    if (error instanceof TenantAuthorizationError) {
      moduleNotInstalled = true
    } else {
      throw error
    }
  }

  return (
    <Shell title={t('posts.title')}>
      {moduleNotInstalled ? (
        <p className="text-sm text-muted-foreground">{t('posts.moduleNotInstalled')}</p>
      ) : posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('posts.emptyNoPosts')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 font-medium">{t('posts.columns.title')}</th>
              <th className="py-2 font-medium">{t('posts.columns.status')}</th>
              <th className="py-2 font-medium">{t('posts.columns.updated')}</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((post) => (
              <tr key={post._id} className="border-b border-border/60">
                <td className="py-2 font-medium">
                  {post.title ?? t('posts.untitled')}
                </td>
                <td className="py-2 text-muted-foreground">
                  {t(`posts.status.${post.status}`)}
                </td>
                <td className="py-2 text-muted-foreground">
                  {formatUpdated(post.updatedAt, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  )
}

/** Minimal page frame inside the dashboard shell. */
function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {children}
    </div>
  )
}

/** Locale-aware date formatting; falls back to the raw ISO string on error. */
function formatUpdated(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso))
  } catch {
    return iso
  }
}
