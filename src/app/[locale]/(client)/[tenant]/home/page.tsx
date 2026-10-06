import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { MODULE_DASHBOARD_ROUTES, resolveProjectGrant } from '@/lib/modules/client-navigation'
import {
  getDashboardPostList,
  getDashboardSubmissions,
  getProjectSiteDomain,
  type DashboardPost,
  type DashboardSubmission,
} from '@/lib/api/client-dashboard'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { listPostDrafts, type PostDraftSummary } from '@/lib/api/post-drafts'
import { GALLERY_READ_PERMISSION, GALLERY_WRITE_PERMISSION, listGalleries, type GalleryListItem } from '@/lib/api/gallery-drafts'
import { getViewerFirstName } from '@/lib/api/viewer-profile'
import { draftProgress, requestCounts, timeAgo } from '@/lib/client/home-cards'
import { Greeting } from '@/components/client/home/Greeting'
import { ContinueEditing, type DraftCard } from '@/components/client/home/ContinueEditing'
import { LatestList, type LatestItem } from '@/components/client/home/LatestList'
import { getGalleryStatuses, type GalleryStatus } from '@/lib/api/gallery-status'

/**
 * Client dashboard home (canvas "Main", ADR-025 · spec "Dashboard home").
 *
 * One calm screen per project: a greeting, "View your site", continue an
 * unfinished draft (posts and galleries, each with a ⋯ menu), the latest
 * posts with their status, and new contact requests. Every section comes from
 * a module the project actually has; a module that is not installed (or a
 * permission the user lacks) simply leaves its section out — never an error.
 *
 * Reads go through the same enforced data layer as the list pages
 * (`assertModuleAction` → tenant-scoped client), so this page adds no new
 * access path; the menu's actions are the existing lifecycle server actions.
 */

async function settle<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch (error) {
    if (error instanceof TenantAuthorizationError) return null
    throw error
  }
}

/** The step a draft was on ("type" = just created → the title). */
function stepKey(step: PostDraftSummary['step']): string {
  if (step === 'type') return 'title'
  return step === 'done' || step === 'promote' ? 'review' : step
}

export default async function DashboardHomePage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params

  const ctx = await getTenantAuthorizationContext()
  if (!ctx) redirect(`/login?next=/${projectSlug}/home`)

  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) notFound()

  const locale = await getLocale()
  const t = await getTranslations('clientDashboard')
  const ts = await getTranslations('clientDashboard.gallery.status')
  const enabled = new Set(grant.enabledModuleIds)
  const canEdit = grant.permissions.includes('blog.post.write')

  const canReadGalleries = enabled.has('gallery') && grant.permissions.includes(GALLERY_READ_PERMISSION)
  const [firstName, domain, postList, wizardDrafts, galleryList, submissions] = await Promise.all([
    getViewerFirstName(ctx),
    settle(() => getProjectSiteDomain(ctx, grant.projectId)).catch(() => null),
    enabled.has('blog') ? settle(() => getDashboardPostList(ctx, grant.projectId, { locale })) : null,
    enabled.has('blog') ? settle<PostDraftSummary[]>(() => listPostDrafts(ctx, grant.projectId)) : null,
    // Galleries with unpublished changes also wait under "Continue editing".
    canReadGalleries
      ? settle<GalleryListItem[]>(() => listGalleries(ctx, grant.projectId))
      : null,
    enabled.has('forms')
      ? settle<DashboardSubmission[]>(() => getDashboardSubmissions(ctx, grant.projectId, { limit: 200 }))
      : null,
  ])

  const posts: DashboardPost[] | null = postList ? postList.posts : null
  const categoryLabel = new Map((postList?.categories ?? []).map((c) => [c.value, c.label]))
  const postCards: DraftCard[] = (wizardDrafts ?? []).slice(0, 3).map((d) => {
    const ago = timeAgo(d.updatedAt, locale)
    return {
      kind: 'post',
      id: d.id,
      rev: d.rev,
      title: d.title ?? t('posts.untitledDraft'),
      thumb: d.coverThumb,
      topics: d.categoryKeys.length ? d.categoryKeys.map((k) => categoryLabel.get(k) ?? k.replace(/-/g, ' ')).join(' · ') : null,
      meta: d.hasLive
        ? t('home.meta.liveChanges', { ago })
        : t('home.meta.draft', { step: t(`create.stepNames.${stepKey(d.step)}`), ago }),
      progress: d.hasLive ? 1 : draftProgress(d.step),
      href: `/${projectSlug}/posts/write/${d.id}`,
      hasLive: d.hasLive,
      canDelete: true,
      previewLocale: Object.keys(d.titles).find((l) => d.titles[l]?.trim()) ?? '',
    }
  })
  const galleryCards: DraftCard[] = (galleryList ?? [])
    .filter((g) => g.hasDraft && grant.permissions.includes(GALLERY_WRITE_PERMISSION))
    .slice(0, 3)
    .map((g) => ({
      kind: 'gallery',
      id: g.id,
      rev: '',
      title: g.title || g.internalName || t('gallery.list.untitled'),
      thumb: g.coverThumb,
      topics: null,
      meta: g.isPublished
        ? t('home.meta.galleryChanges', { count: g.count })
        : t('home.meta.galleryDraft', { count: g.count }),
      // Galleries don't keep a wizard position: photos added = halfway.
      progress: g.isPublished ? 1 : g.count > 0 ? 0.5 : 0.25,
      href: `/${projectSlug}/galleries/${g.id}`,
      hasLive: g.isPublished,
      canDelete: grant.role === 'owner',
      previewLocale: '',
    }))
  const cards = [...postCards, ...galleryCards]

  const latestPosts: LatestItem[] = (posts ?? [])
    .filter((p): p is DashboardPost & { status: 'published' | 'scheduled' } => p.status === 'published' || p.status === 'scheduled')
    .slice(0, 3)
    .map((p) => ({
      id: p._id,
      title: p.title ?? t('posts.untitled'),
      thumb: (p as { coverThumb?: string | null }).coverThumb ?? null,
      status: p.status,
      publishedAt: p.publishedAt ?? null,
      href: canEdit ? `/${projectSlug}/posts/write/${p._id}` : null,
    }))
  const liveGalleries = (galleryList ?? []).filter((g) => g.isPublished).slice(0, 3)
  const galleryStatuses: Record<string, GalleryStatus> = liveGalleries.length
    ? await getGalleryStatuses(ctx, grant.projectId, liveGalleries.map((g) => g.id)).catch((): Record<string, GalleryStatus> => ({}))
    : {}
  const latestGalleries: LatestItem[] = liveGalleries.map((g) => {
    const u = galleryStatuses[g.id]?.usedOn
    const places = u
      ? [
          ...u.pages.map((pg) => (pg.published ? pg.title || ts('untitledPage') : ts('draftPage', { title: pg.title || ts('untitledPage') }))),
          ...(u.posts.published > 0 ? [ts('posts', { count: u.posts.published })] : []),
          ...(u.posts.draft > 0 ? [ts('draftPosts', { count: u.posts.draft })] : []),
        ]
      : []
    return {
      id: g.id,
      title: g.title || g.internalName || t('gallery.list.untitled'),
      thumb: g.coverThumb,
      line: places.length ? ts('shownOn', { places: places.join(' · ') }) : ts('notUsed'),
      href: grant.permissions.includes(GALLERY_WRITE_PERMISSION) ? `/${projectSlug}/galleries/${g.id}` : null,
    }
  })
  const requests = submissions ? requestCounts(submissions) : null
  const postsHref = `/${projectSlug}/${MODULE_DASHBOARD_ROUTES.blog}`
  const leadsHref = `/${projectSlug}/${MODULE_DASHBOARD_ROUTES.forms}`
  const galleriesHref = `/${projectSlug}/${MODULE_DASHBOARD_ROUTES.gallery}`
  const nothingYet = posts !== null && posts.length === 0 && cards.length === 0

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-7 pb-28 md:px-4 md:pb-8">
      <Greeting firstName={firstName} />

      {domain ? (
        <a
          href={`https://${domain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-[0.625rem] bg-accent text-accent-foreground">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.9375rem] font-semibold">{t('home.viewSite')}</span>
            <span className="block truncate text-sm text-muted-foreground">{domain}</span>
          </span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-1 shrink-0 text-muted-foreground">
            <path d="M7 17 17 7M8 7h9v9" />
          </svg>
          <span className="sr-only">{t('home.opensNewTab')}</span>
        </a>
      ) : null}

      {nothingYet && (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5">
          <h2 className="text-[1.0625rem] font-semibold">{t('home.emptyTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('home.emptyBody')}</p>
        </section>
      )}

      {cards.length > 0 ? <ContinueEditing projectSlug={projectSlug} cards={cards} /> : null}

      {latestPosts.length > 0 ? <LatestList kind="post" heading={t('home.latestPosts')} items={latestPosts} seeAllHref={postsHref} /> : null}

      {latestGalleries.length > 0 ? (
        <LatestList kind="gallery" heading={t('home.latestGalleries')} items={latestGalleries} seeAllHref={galleriesHref} />
      ) : null}

      {requests !== null && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[1.0625rem] leading-6 font-semibold">{t('home.newRequests')}</h2>
          <Link href={leadsHref} className="flex min-h-14 items-start gap-3 rounded-xl bg-muted px-4 py-3.5">
            <span className="text-2xl leading-7 font-semibold tabular-nums">{requests.week}</span>
            <span className="flex-1 pt-1 text-sm leading-5 text-muted-foreground">
              {t('home.requestsBody', { week: requests.week, open: requests.open })}
            </span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="mt-1 shrink-0">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </Link>
        </section>
      )}
    </div>
  )
}
