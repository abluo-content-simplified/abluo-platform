import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { PageShell } from '@/components/client/ui/PageShell'
import { DashboardArea, DashboardGrid } from '@/components/client/ui/DashboardGrid'
import { SectionHeading } from '@/components/client/ui/SectionHeading'
import { StatGrid } from '@/components/client/ui/StatGrid'
import { StatTile } from '@/components/client/ui/StatTile'
import { AttentionList, type AttentionRow } from '@/components/client/ui/AttentionList'
import { EmptyState } from '@/components/client/ui/EmptyState'
import { SiteStatus } from '@/components/client/ui/SiteStatus'
import { Greeting } from '@/components/client/home/Greeting'
import { ContinueEditing, type DraftCard } from '@/components/client/home/ContinueEditing'
import { LatestList, type LatestItem } from '@/components/client/home/LatestList'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import type { DashboardPost } from '@/lib/api/client-dashboard'
import type { PostDraftSummary } from '@/lib/api/post-drafts'
import { GALLERY_WRITE_PERMISSION, canDeleteGalleries } from '@/lib/api/gallery-drafts'
import { getViewerFirstName } from '@/lib/api/viewer-profile'
import { getBlogDashboard } from '@/lib/api/dashboard/blog'
import { getFormsDashboard } from '@/lib/api/dashboard/forms'
import { getGalleryDashboard } from '@/lib/api/dashboard/gallery'
import { getMediaDashboard } from '@/lib/api/dashboard/media'
import { getPeopleAttention } from '@/lib/api/dashboard/people'
import { getSiteStatus } from '@/lib/api/dashboard/site'
import { buildTenantSurfaces, hasWidget } from '@/lib/client/surfaces'
import { allowedAttentionRules, sortAttention, type AttentionItem } from '@/lib/client/attention'
import { draftProgress, navHref, percentChange, timeAgo } from '@/lib/client/home-cards'

/**
 * Client dashboard Home (ADR-029 §5) — an operational overview, never a
 * configuration surface.
 *
 * Every block is a registered widget (`src/lib/client/surfaces.ts`): Home
 * renders only what `buildTenantSurfaces(grant)` returns and reads data only
 * for those widgets. Each module's data comes from its provider in
 * `src/lib/api/dashboard/`, which goes through the existing enforced data
 * layer (`assertModuleAction` / tenant-scoped clients); a provider that fails
 * or is refused just leaves its block out. Links are derived from the
 * registry's nav entries, so a block never links to a page the person can't open.
 *
 * Phone: one column — greeting + site, needs your attention, continue
 * editing, at a glance, latest lists. Desktop: greeting + site · at a glance
 * · attention (8) | continue editing (4) · latest lists side by side.
 */

/** The step a draft was on ("type" = just created → the title). */
function stepKey(step: PostDraftSummary['step']): string {
  if (step === 'type') return 'title'
  return step === 'done' || step === 'promote' ? 'review' : step
}

/** Draft cards shown per kind under "Continue editing". */
const CONTINUE_PER_KIND = 3
/** Items in each "Latest" list. */
const LATEST_COUNT = 3

export default async function DashboardHomePage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params

  const ctx = await getTenantAuthorizationContext()
  if (!ctx) redirect(`/login?next=/${projectSlug}/home`)

  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) notFound()

  const locale = await getLocale()
  const t = await getTranslations('clientDashboard')
  const th = await getTranslations('clientDashboard.home')
  const ts = await getTranslations('clientDashboard.gallery.status')

  // ── What this person may see (the registry is the only gate for Home) ────
  const surfaces = buildTenantSurfaces(grant)
  const show = (id: string) => hasWidget(surfaces, id)
  const rules = show('attention') ? allowedAttentionRules(grant) : new Set<never>()
  const link = (navId: string, query?: Record<string, string>) => navHref(projectSlug, navId, surfaces.nav, query)
  const enabled = new Set(grant.enabledModuleIds)
  const canEditPosts = grant.permissions.includes('blog.post.write')
  const canEditGalleries = grant.permissions.includes(GALLERY_WRITE_PERMISSION)

  const wantBlog = enabled.has('blog')
  const blogList = wantBlog && (show('glance.posts') || show('latest.posts') || show('continueEditing') || rules.has('scheduledSoon') || rules.has('missingLanguage'))
  const blogDrafts = wantBlog && canEditPosts && (show('continueEditing') || rules.has('stalePostDrafts'))
  const wantForms = show('glance.requests') || rules.has('newRequests')
  const wantGallery =
    enabled.has('gallery') && (show('glance.galleries') || show('latest.galleries') || (show('continueEditing') && canEditGalleries) || rules.has('staleGalleryDrafts'))
  const wantMedia = show('glance.media') || rules.has('missingAltText')
  const wantPeople = rules.has('pendingInvites')

  const [firstName, site, blog, forms, gallery, media, people] = await Promise.all([
    getViewerFirstName(ctx).catch(() => null),
    show('siteStatus') ? getSiteStatus(ctx, grant.projectId) : null,
    blogList || blogDrafts
      ? getBlogDashboard(ctx, grant.projectId, {
          locale,
          readList: blogList,
          readDrafts: blogDrafts,
          glance: show('glance.posts'),
          attention:
            rules.has('stalePostDrafts') || rules.has('scheduledSoon') || rules.has('missingLanguage')
              ? {
                  rules,
                  hrefs: {
                    drafts: link('blog', { status: 'draft' }) ?? '',
                    scheduled: link('blog', { status: 'scheduled' }) ?? '',
                    missingLanguage: link('blog', { status: 'published', tr: 'missing' }) ?? '',
                  },
                  untitled: t('posts.untitled'),
                  when: (iso) => timeAgo(iso, locale),
                }
              : null,
        })
      : null,
    wantForms ? getFormsDashboard(ctx, grant.projectId, { attentionHref: rules.has('newRequests') ? link('forms') : null }) : null,
    wantGallery
      ? getGalleryDashboard(ctx, grant.projectId, {
          latest: show('latest.galleries'),
          attention: rules.has('staleGalleryDrafts') ? { href: link('gallery', { status: 'draft' }) ?? '', untitled: t('gallery.list.untitled') } : null,
        })
      : null,
    wantMedia ? getMediaDashboard(ctx, grant.projectId, { attentionHref: rules.has('missingAltText') ? link('media') : null }) : null,
    wantPeople && link('people') ? getPeopleAttention(ctx, grant.projectId, link('people')!) : [],
  ])

  // ── Needs your attention ────────────────────────────────────────────────
  const attentionItems: AttentionItem[] = sortAttention([
    ...(forms?.attention ?? []),
    ...(blog?.attention ?? []),
    ...(gallery?.attention ?? []),
    ...(media?.attention ?? []),
    ...people,
  ]).filter((i) => i.href)
  const attentionRows: AttentionRow[] = attentionItems.map((i) => ({
    id: i.id,
    severity: i.severity,
    title: th(i.titleKey, i.params),
    detail: th(i.detailKey, i.params),
    actionLabel: th(i.actionKey, i.params),
    href: i.href,
  }))
  // Only when at least one rule this person may see actually got its data
  // (a failed read must not turn into a false "All caught up").
  const showAttention =
    (rules.has('newRequests') && forms !== null) ||
    ((rules.has('stalePostDrafts') || rules.has('scheduledSoon') || rules.has('missingLanguage')) && !!(blog?.list || blog?.drafts)) ||
    (rules.has('staleGalleryDrafts') && gallery !== null) ||
    (rules.has('missingAltText') && media !== null) ||
    (rules.has('pendingInvites') && !!link('people'))

  // ── Continue editing (unchanged behaviour: posts then galleries, ⋯ menu) ──
  const categoryLabel = new Map((blog?.list?.categories ?? []).map((c) => [c.value, c.label]))
  const postCards: DraftCard[] = show('continueEditing')
    ? (blog?.drafts ?? []).slice(0, CONTINUE_PER_KIND).map((d) => {
        const ago = timeAgo(d.updatedAt, locale)
        return {
          kind: 'post',
          id: d.id,
          rev: d.rev,
          title: d.title ?? t('posts.untitledDraft'),
          thumb: d.coverThumb,
          topics: d.categoryKeys.length ? d.categoryKeys.map((k) => categoryLabel.get(k) ?? k.replace(/-/g, ' ')).join(' · ') : null,
          meta: d.hasLive ? th('meta.liveChanges', { ago }) : th('meta.draft', { step: t(`create.stepNames.${stepKey(d.step)}`), ago }),
          progress: d.hasLive ? 1 : draftProgress(d.step),
          href: `/${projectSlug}/posts/write/${d.id}`,
          hasLive: d.hasLive,
          canDelete: true,
          previewLocale: Object.keys(d.titles).find((l) => d.titles[l]?.trim()) ?? '',
        }
      })
    : []
  const galleryCards: DraftCard[] =
    show('continueEditing') && canEditGalleries
      ? (gallery?.galleries ?? [])
          .filter((g) => g.hasDraft)
          .slice(0, CONTINUE_PER_KIND)
          .map((g) => ({
            kind: 'gallery',
            id: g.id,
            rev: '',
            title: g.title || g.internalName || t('gallery.list.untitled'),
            thumb: g.coverThumb,
            topics: null,
            meta: g.isPublished ? th('meta.galleryChanges', { count: g.count }) : th('meta.galleryDraft', { count: g.count }),
            // Galleries don't keep a wizard position: photos added = halfway.
            progress: g.isPublished ? 1 : g.count > 0 ? 0.5 : 0.25,
            href: `/${projectSlug}/galleries/${g.id}`,
            hasLive: g.isPublished,
            canDelete: canDeleteGalleries(grant),
            previewLocale: '',
          }))
      : []
  const cards = [...postCards, ...galleryCards]

  // ── Latest lists ────────────────────────────────────────────────────────
  const posts = blog?.list?.posts ?? null
  const latestPosts: LatestItem[] = show('latest.posts')
    ? (posts ?? [])
        .filter((p): p is typeof p & { status: 'published' | 'scheduled' } => p.status === 'published' || p.status === 'scheduled')
        .slice(0, LATEST_COUNT)
        .map((p: DashboardPost & { coverThumb?: string | null; status: 'published' | 'scheduled' }) => ({
          id: p._id,
          title: p.title ?? t('posts.untitled'),
          thumb: p.coverThumb ?? null,
          status: p.status,
          publishedAt: p.publishedAt ?? null,
          href: canEditPosts ? `/${projectSlug}/posts/write/${p._id}` : null,
        }))
    : []
  const latestGalleries: LatestItem[] = (gallery?.latest ?? []).map((g) => {
    const u = gallery?.statuses[g.id]?.usedOn
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
      href: canEditGalleries ? `/${projectSlug}/galleries/${g.id}` : null,
    }
  })
  const postsHref = link('blog')
  const galleriesHref = link('gallery')

  // ── At a glance ─────────────────────────────────────────────────────────
  const tiles = [
    show('glance.posts') && blog?.glance ? (
      <StatTile
        key="posts"
        label={th('glance.posts.label')}
        value={blog.glance.published}
        sub={th('glance.posts.sub', { drafts: blog.glance.drafts, scheduled: blog.glance.scheduled })}
        href={postsHref}
      />
    ) : null,
    show('glance.requests') && forms?.glance ? (
      <StatTile
        key="requests"
        label={th('glance.requests.label')}
        value={forms.glance.week}
        delta={(() => {
          const percent = percentChange(forms.glance.week, forms.glance.previousWeek)
          return percent === null ? null : { percent, period: th('glance.lastWeek') }
        })()}
        sub={th('glance.requests.sub', { open: forms.glance.open })}
        href={link('forms')}
      />
    ) : null,
    show('glance.galleries') && gallery ? (
      <StatTile
        key="galleries"
        label={th('glance.galleries.label')}
        value={gallery.glance.total}
        sub={th('glance.galleries.sub', { unpublished: gallery.glance.unpublished })}
        href={galleriesHref}
      />
    ) : null,
    show('glance.media') && media ? (
      <StatTile
        key="media"
        label={th('glance.media.label')}
        value={media.glance.photos}
        sub={th('glance.media.sub', { missing: media.glance.missingAlt })}
        href={link('media')}
      />
    ) : null,
  ].filter(Boolean)

  // First run: nothing written yet and nothing in progress.
  const nothingYet = posts !== null && posts.length === 0 && cards.length === 0
  const hasContinue = cards.length > 0

  return (
    <PageShell>
      <DashboardGrid>
        <DashboardArea span={site ? 8 : 12} desktopOrder={1}>
          <Greeting firstName={firstName} />
        </DashboardArea>

        {site ? (
          <DashboardArea span={4} desktopOrder={2}>
            <SiteStatus state={site.state} host={site.host} url={site.url} />
          </DashboardArea>
        ) : null}

        {nothingYet ? (
          <DashboardArea desktopOrder={3}>
            <EmptyState title={th('emptyTitle')} body={th('emptyBody')} />
          </DashboardArea>
        ) : null}

        {showAttention ? (
          <DashboardArea span={8} desktopOrder={5}>
            <section aria-labelledby="needs-attention" className="flex flex-col gap-3">
              <SectionHeading id="needs-attention" title={th('attention.heading')} />
              <AttentionList items={attentionRows} />
            </section>
          </DashboardArea>
        ) : null}

        {hasContinue ? (
          <DashboardArea span={showAttention ? 4 : 12} desktopOrder={6}>
            <ContinueEditing projectSlug={projectSlug} cards={cards} layout={showAttention ? 'stack' : 'grid'} />
          </DashboardArea>
        ) : null}

        {tiles.length ? (
          <DashboardArea desktopOrder={4}>
            <section aria-labelledby="at-a-glance" className="flex flex-col gap-3">
              <SectionHeading id="at-a-glance" title={th('glance.heading')} />
              <StatGrid>{tiles}</StatGrid>
            </section>
          </DashboardArea>
        ) : null}

        {latestPosts.length > 0 && postsHref ? (
          <DashboardArea span={6} desktopOrder={7}>
            <LatestList kind="post" heading={th('latestPosts')} items={latestPosts} seeAllHref={postsHref} />
          </DashboardArea>
        ) : null}

        {latestGalleries.length > 0 && galleriesHref ? (
          <DashboardArea span={6} desktopOrder={8}>
            <LatestList kind="gallery" heading={th('latestGalleries')} items={latestGalleries} seeAllHref={galleriesHref} />
          </DashboardArea>
        ) : null}
      </DashboardGrid>
    </PageShell>
  )
}
