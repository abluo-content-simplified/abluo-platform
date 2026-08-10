import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { getDashboardPosts, type DashboardPost } from '@/lib/api/client-dashboard'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'

/**
 * Client dashboard — Posts list. ADR-017 slice 6 / ADR-015 close-out.
 *
 * The first real client-dashboard read path. Resolves the caller's
 * `TenantAuthorizationContext`, picks their first project grant (the project
 * switcher is deferred to Phase 2), and lists that project's posts through
 * `getDashboardPosts`, which enforces the ADR-017 module-entitlement +
 * tenant-scoped-Sanity chain.
 *
 * Defence in depth: the `(client)` proxy gate already guarantees an
 * authenticated session before this route renders, but this page still checks
 * `ctx` itself (redirect to /login if null) rather than trusting the gate —
 * the same belt-and-braces posture as `account/page.tsx`.
 *
 * All user-facing copy comes from the `clientDashboard` next-intl namespace —
 * no hardcoded strings (Multilingual-First).
 */
export default async function PostsPage() {
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) {
    redirect('/login?next=/posts')
  }

  const locale = await getLocale()
  const t = await getTranslations('clientDashboard')

  // No project grants — the user is authenticated but not a member of any
  // project yet. Localized empty state; do not attempt a read.
  if (ctx.projects.length === 0) {
    return (
      <Shell title={t('posts.title')}>
        <p className="text-sm text-muted-foreground">{t('posts.emptyNoProjects')}</p>
      </Shell>
    )
  }

  // Phase 1: first grant only. Project switcher is Phase 2 (task #81).
  const grant = ctx.projects[0]

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

/** Minimal page frame. The real dashboard shell is Phase 2 (task #81). */
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
