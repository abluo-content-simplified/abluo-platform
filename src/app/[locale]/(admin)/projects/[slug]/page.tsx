import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { PageShell } from '@/components/app/ui/PageShell'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { StatGrid } from '@/components/app/ui/StatGrid'
import { StatTile } from '@/components/app/ui/StatTile'
import { FactRow } from '@/components/app/ui/FactRow'
import { LinkCard } from '@/components/app/ui/LinkCard'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { LocalDate } from '@/components/app/ui/list/cells'
import { LatestList, type LatestItem } from '@/components/client/home/LatestList'
import { ProjectStatusPill } from '@/components/admin/projects/ProjectStatusPill'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { getAdminProject } from '@/lib/api/admin-dashboard/project'
import { recordAdminAudit } from '@/lib/admin/audit'
import { liveSiteUrl, previewSiteUrl } from '@/lib/admin/projects-filter'
import { percentChange } from '@/lib/client/home-cards'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import { ProjectAnalyticsBlock } from '@/components/admin/analytics/ProjectAnalyticsBlock'
import { ViewAsClient } from '@/components/admin/projects/ViewAsClient'

export const dynamic = 'force-dynamic'

const ICON = {
  eye: <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />,
  studio: <path d="M4 4h16v16H4zM4 9h16M9 9v11" />,
  globe: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z" />,
}
const icon = (d: ReactNode) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
)

/**
 * Admin project page (ADR-030 §5.1): who the project is, then "What the
 * client sees" — the client Home's own widgets (StatTile, LatestList) fed by
 * the admin providers, read-only (no links into the client editor) — then the
 * admin facts (modules, languages, Owners, pending invitations, created,
 * links). Every view is written to the internal admin audit log. Unknown
 * slug → 404. "View as client" opens the client dashboard in support mode
 * (ADR-028 §8, docs/engineering/support-mode.md).
 */
export default async function AdminProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams?: Promise<{ support?: string }>
}) {
  const { slug: raw } = await params
  const supportParam = (await searchParams)?.support
  const supportNotice = supportParam === 'unavailable' || supportParam === 'failed' ? supportParam : null
  let slug = raw
  try {
    slug = decodeURIComponent(raw)
  } catch {
    notFound()
  }
  const actor = await requireAbluoAdmin()
  if (!actor) notFound()

  const locale = await getLocale()
  const detail = await getAdminProject(slug, { locale })
  if (!detail) notFound()

  const { project, content, requests, invitations, ownersKnown } = detail
  await recordAdminAudit({ actorId: actor.userId, action: 'project.view', projectId: project.id, detail: { slug: project.slug } })

  const t = await getTranslations('admin.projectPage')
  const format = await getFormatter()
  const date = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : format.dateTime(d, { day: 'numeric', month: 'short', year: 'numeric' })
  }
  const languageName = (code: string) => {
    try {
      return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code
    } catch {
      return code
    }
  }
  const moduleLabel = (id: string) => MODULE_REGISTRY.find((m) => m.id === id)?.label ?? id

  const enabled = new Set(content?.enabledModuleIds ?? [])
  const live = project.status === 'active' ? liveSiteUrl(project.customDomain) : null

  // ── What the client sees: the same tiles and lists as the client Home ─────
  const tiles = content
    ? [
        enabled.has('blog') ? (
          <StatTile
            key="posts"
            label={t('glance.posts.label')}
            value={content.posts.published}
            sub={t('glance.posts.sub', { scheduled: content.posts.scheduled, drafts: content.posts.drafts })}
          />
        ) : null,
        enabled.has('forms') && requests ? (
          <StatTile
            key="requests"
            label={t('glance.requests.label')}
            value={requests.week}
            delta={(() => {
              const percent = percentChange(requests.week, requests.previousWeek)
              return percent === null ? null : { percent, period: t('lastWeek') }
            })()}
            sub={t('glance.requests.sub', { open: requests.open })}
          />
        ) : null,
        enabled.has('gallery') ? (
          <StatTile key="galleries" label={t('glance.galleries.label')} value={content.galleryCount} sub={t('glance.galleries.sub')} />
        ) : null,
        <StatTile key="photos" label={t('glance.photos.label')} value={content.media.photos} sub={t('glance.photos.sub', { missing: content.media.missingAlt })} />,
      ].filter(Boolean)
    : []

  const latestPosts: LatestItem[] = enabled.has('blog')
    ? (content?.latestPosts ?? []).map((p) => ({ id: p.id, title: p.title ?? t('untitled'), thumb: p.thumb, status: p.status, publishedAt: p.publishedAt, href: null }))
    : []
  const latestGalleries: LatestItem[] = enabled.has('gallery')
    ? (content?.latestGalleries ?? []).map((g) => ({ id: g.id, title: g.title ?? t('untitled'), thumb: g.thumb, line: t('galleryPhotos', { count: g.count }), href: null }))
    : []

  // ── Admin facts ───────────────────────────────────────────────────────────
  const unknown = <span className="text-muted-foreground">{t('facts.unknown')}</span>
  const owners = !ownersKnown ? (
    unknown
  ) : project.owners.length ? (
    <span className="flex flex-col items-end">
      {project.owners.map((o) => (
        <span key={o.userId} className="break-all">
          {o.name ? `${o.name} · ${o.email}` : o.email || o.userId}
        </span>
      ))}
    </span>
  ) : (
    <span className="flex flex-col items-end">
      <span className="font-medium text-destructive">{t('facts.noOwner')}</span>
      <span className="text-sm text-muted-foreground">{t('facts.noOwnerHint')}</span>
    </span>
  )
  const invitationList =
    invitations === null ? (
      unknown
    ) : invitations.length ? (
      <span className="flex flex-col items-end gap-1">
        {invitations.map((i) => {
          const role = `${i.role}${i.scope === 'tenant' ? ` (${t('facts.invitationClientWide')})` : ''}`
          return (
            <span key={i.id} className="flex flex-col items-end">
              <span className="break-all">{i.email}</span>
              <span className={`text-sm ${i.expired ? 'text-destructive' : 'text-muted-foreground'}`}>
                {t(i.expired ? 'facts.invitationExpired' : 'facts.invitationExpires', { role, date: date(i.expiresAt) })}
              </span>
            </span>
          )
        })}
      </span>
    ) : (
      <span className="text-muted-foreground">{t('facts.noInvitations')}</span>
    )

  return (
    <PageShell>
      <Link
        href="/projects"
        className="-my-2 inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="m15 6-6 6 6 6" />
        </svg>
        {t('back')}
      </Link>

      <div className="space-y-2">
        <PageHeader title={project.name} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm leading-5 text-muted-foreground">
          <ProjectStatusPill status={project.status} />
          <span className="break-all">{project.customDomain ?? t('noDomain')}</span>
          {project.client ? <span>{t('clientLine', { name: project.client.name })}</span> : null}
        </div>
      </div>

      <section aria-labelledby="client-sees" className="flex flex-col gap-4">
        <div className="space-y-1">
          <SectionHeading id="client-sees" title={t('clientSees.heading')} />
          <p className="text-sm leading-5 text-muted-foreground">{t('clientSees.body')}</p>
        </div>

        {content === null ? (
          <div role="alert" className="rounded-2xl border border-destructive px-4 py-3 text-sm text-destructive">
            {t('contentError')}
          </div>
        ) : (
          <>
            {tiles.length ? <StatGrid label={t('clientSees.heading')}>{tiles}</StatGrid> : null}
            {latestPosts.length || latestGalleries.length ? (
              <div className="grid gap-5 lg:grid-cols-2">
                {latestPosts.length ? <LatestList kind="post" heading={t('latestPosts')} items={latestPosts} seeAllHref="" /> : null}
                {latestGalleries.length ? <LatestList kind="gallery" heading={t('latestGalleries')} items={latestGalleries} seeAllHref="" /> : null}
              </div>
            ) : (
              <EmptyState compact titleAs="p" title={t('nothingYet')} />
            )}
          </>
        )}
      </section>

      <ViewAsClient projectId={project.id} slug={project.slug} notice={supportNotice} />

      <ProjectAnalyticsBlock projectId={project.id} />

      <section aria-labelledby="admin-facts" className="flex flex-col gap-3">
        <SectionHeading id="admin-facts" title={t('adminHeading')} />
        <dl className="rounded-xl border border-border bg-card px-4">
          <FactRow label={t('facts.status')}>
            <ProjectStatusPill status={project.status} />
          </FactRow>
          <FactRow label={t('facts.slug')}>
            <span className="font-mono text-sm">{project.slug}</span>
          </FactRow>
          <FactRow label={t('facts.modules')}>
            {content === null ? unknown : enabled.size ? [...enabled].map(moduleLabel).join(', ') : <span className="text-muted-foreground">{t('facts.noModules')}</span>}
          </FactRow>
          <FactRow label={t('facts.defaultLocale')}>{languageName(content?.defaultLocale || project.defaultLocale)}</FactRow>
          {content && content.supportedLocales.length > 1 ? (
            <FactRow label={t('facts.languages')}>{content.supportedLocales.map(languageName).join(', ')}</FactRow>
          ) : null}
          <FactRow label={t('facts.owners')}>{owners}</FactRow>
          <FactRow label={t('facts.invitations')}>{invitationList}</FactRow>
          <FactRow label={t('facts.created')}>
            <LocalDate iso={project.createdAt} empty="—" />
          </FactRow>
        </dl>

        <div className="grid gap-3 md:grid-cols-3">
          <LinkCard href={previewSiteUrl(project.slug)} external icon={icon(ICON.eye)} title={t('links.preview')} subline={`preview.abluo.app/${project.slug}`} />
          <LinkCard href="/studio" external icon={icon(ICON.studio)} title={t('links.studio')} />
          {live ? <LinkCard href={live} external icon={icon(ICON.globe)} title={t('links.live')} subline={live.replace(/^https:\/\//, '')} /> : null}
        </div>
      </section>
    </PageShell>
  )
}
