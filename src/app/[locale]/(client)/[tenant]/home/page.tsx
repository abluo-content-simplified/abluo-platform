import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { MODULE_DASHBOARD_ROUTES, resolveProjectGrant } from '@/lib/modules/client-navigation'
import {
  getDashboardPostRows,
  getDashboardSubmissions,
  type DashboardPost,
  type DashboardSubmission,
} from '@/lib/api/client-dashboard'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { listPostDrafts, type PostDraftSummary } from '@/lib/api/post-drafts'
import { firstPassDone, laterStep } from '@/lib/client/wizard-steps'

/**
 * Client dashboard home (S1, ADR-025 · spec "Dashboard home").
 *
 * One calm screen per project: continue an unfinished draft, see the latest
 * posts with their status, and see new contact requests. Every section comes
 * from a module the project actually has; a module that is not installed (or a
 * permission the user lacks) simply leaves its section out — never an error.
 *
 * Reads go through the same enforced data layer as the list pages
 * (`assertModuleAction` → tenant-scoped client), so this page adds no new
 * access path. "View your site" waits for domain resolution (S1b).
 */

async function settle<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch (error) {
    if (error instanceof TenantAuthorizationError) return null
    throw error
  }
}

/** Where "Continue" lands ("Next: Story", or the overview once the first pass is over). */
function stepKey(draft: Pick<PostDraftSummary, 'step' | 'furthest'>): string {
  const at = laterStep(draft.step, draft.furthest)
  if (firstPassDone(at)) return 'review'
  if (at === 'type') return 'title'
  return at
}

function formatDay(iso: string, locale: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

export default async function DashboardHomePage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params

  const ctx = await getTenantAuthorizationContext()
  if (!ctx) redirect(`/login?next=/${projectSlug}/home`)

  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) notFound()

  const locale = await getLocale()
  const t = await getTranslations('clientDashboard')
  const enabled = new Set(grant.enabledModuleIds)

  const [posts, wizardDrafts, submissions] = await Promise.all([
    enabled.has('blog') ? settle<DashboardPost[]>(() => getDashboardPostRows(ctx, grant.projectId, { locale })) : null,
    enabled.has('blog') ? settle<PostDraftSummary[]>(() => listPostDrafts(ctx, grant.projectId)) : null,
    enabled.has('forms')
      ? settle<DashboardSubmission[]>(() => getDashboardSubmissions(ctx, grant.projectId, { limit: 200 }))
      : null,
  ])

  // Continue editing = unfinished wizard drafts (ADR-025 D3), each reopening at its step.
  const drafts = (wizardDrafts ?? []).slice(0, 3)
  const recent = (posts ?? []).filter((p) => p.status === 'published').slice(0, 3)
  const newRequests = (submissions ?? []).filter((s) => s.status === 'new').length
  const postsHref = `/${projectSlug}/${MODULE_DASHBOARD_ROUTES.blog}`
  const leadsHref = `/${projectSlug}/${MODULE_DASHBOARD_ROUTES.forms}`
  const nothingYet = posts !== null && posts.length === 0 && drafts.length === 0

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 pb-28 md:pb-8">
      <h1 className="text-2xl font-semibold leading-[30px] tracking-tight">{t('home.title')}</h1>

      {nothingYet && (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5">
          <h2 className="text-[17px] font-semibold">{t('home.emptyTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('home.emptyBody')}</p>
        </section>
      )}

      {drafts.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[17px] font-semibold">{t('home.continueEditing')}</h2>
          {drafts.map((draft) => (
            <div key={draft.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
              <div>
                <p className="text-[15px] font-semibold leading-[22px]">{draft.title ?? t('posts.untitledDraft')}</p>
                <p className="text-sm text-muted-foreground">
                  {t('home.atStep', { step: t(`create.stepNames.${stepKey(draft)}`) })} ·{' '}
                  {t('home.edited', { date: formatDay(draft.updatedAt, locale) })}
                </p>
              </div>
              <Link
                href={`/${projectSlug}/posts/write/${draft.id}`}
                className="inline-flex h-11 w-fit items-center rounded-md bg-action px-4 text-[15px] font-semibold text-action-foreground"
              >
                {t('home.continue')}
              </Link>
            </div>
          ))}
        </section>
      )}

      {posts !== null && recent.length > 0 && (
        <section className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[17px] font-semibold">{t('home.recentPosts')}</h2>
            <Link href={postsHref} className="inline-flex min-h-8 items-center text-sm font-medium text-primary">
              {t('home.seeAll')}
            </Link>
          </div>
          <ul>
            {recent.map((post) => (
              <li key={post._id} className="flex items-center gap-3 border-b border-border-subtle py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium leading-[22px]">{post.title ?? t('posts.untitled')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('posts.status.published')} · {formatDay(post.updatedAt, locale)}
                  </p>
                </div>
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-success" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {submissions !== null && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[17px] font-semibold">{t('home.newRequests')}</h2>
          <Link href={leadsHref} className="flex min-h-14 items-center gap-3 rounded-xl bg-muted px-4 py-3">
            <span className="text-2xl font-semibold tabular-nums">{newRequests}</span>
            <span className="flex-1 text-sm text-muted-foreground">{t('home.newRequestsBody', { count: newRequests })}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </Link>
        </section>
      )}
    </div>
  )
}
