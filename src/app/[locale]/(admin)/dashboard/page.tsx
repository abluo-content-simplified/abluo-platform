import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { PageShell } from '@/components/app/ui/PageShell'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { StatGrid } from '@/components/app/ui/StatGrid'
import { StatTile } from '@/components/app/ui/StatTile'
import { AttentionList, type AttentionRow } from '@/components/app/ui/AttentionList'
import { Greeting } from '@/components/client/home/Greeting'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { getViewerAccount } from '@/lib/api/viewer-account'
import { getAdminHome } from '@/lib/api/admin-dashboard/home'
import { AdminAnalyticsSummary } from '@/components/admin/analytics/AdminAnalyticsSummary'

export const dynamic = 'force-dynamic'

/**
 * Admin Home (ADR-030 §5.1) — the cross-project summary: a greeting, projects
 * by status and what is waiting on someone (StatGrid), then what needs Tom
 * (AttentionList: projects with no Owner, contact requests unanswered for
 * over two days, invitations expired or about to, long previews). Data from
 * `getAdminHome` (service role, checks `requireAbluoAdmin()` itself); a
 * source that fails leaves its tile out and the attention list says it may be
 * incomplete instead of "All caught up".
 */
export default async function AdminHomePage() {
  const actor = await requireAbluoAdmin()
  if (!actor) notFound()

  const [t, home, viewer] = await Promise.all([getTranslations('admin.home'), getAdminHome(), getViewerAccount(actor.userId)])
  const firstName = viewer.name.trim().split(/\s+/)[0] || null

  const c = home.projectCounts
  const tiles = [
    c ? <StatTile key="live" label={t('glance.live.label')} value={c.active} sub={t('glance.live.sub')} href="/projects?status=active" /> : null,
    c ? <StatTile key="preview" label={t('glance.preview.label')} value={c.preview} sub={t('glance.preview.sub')} href="/projects?status=preview" /> : null,
    c ? <StatTile key="draft" label={t('glance.draft.label')} value={c.draft} sub={t('glance.draft.sub')} href="/projects?status=draft" /> : null,
    home.requests ? (
      <StatTile
        key="requests"
        label={t('glance.requests.label')}
        value={home.requests.total}
        sub={t('glance.requests.sub', { week: home.requests.week })}
      />
    ) : null,
    home.pendingInvitations !== null ? (
      <StatTile key="invitations" label={t('glance.invitations.label')} value={home.pendingInvitations} sub={t('glance.invitations.sub')} />
    ) : null,
  ].filter(Boolean)
  const someMissing = !c || !home.requests || home.pendingInvitations === null

  const rows: AttentionRow[] = home.attention.map((i) => ({
    id: i.id,
    severity: i.severity,
    title: t(i.titleKey as 'attention.noOwner.title', i.params),
    detail: t(i.detailKey as 'attention.noOwner.detail', i.params),
    actionLabel: t(i.actionKey as 'attention.noOwner.action', i.params),
    href: i.href,
  }))

  return (
    <PageShell>
      <Greeting firstName={firstName} />

      <section aria-labelledby="admin-glance" className="flex flex-col gap-3">
        <SectionHeading id="admin-glance" title={t('glance.heading')} />
        {tiles.length ? <StatGrid>{tiles}</StatGrid> : null}
        {someMissing ? (
          <p role="status" className="text-sm leading-5 text-muted-foreground">
            {t('loadError')}
          </p>
        ) : null}
      </section>

      <AdminAnalyticsSummary />

      <section aria-labelledby="admin-attention" className="flex flex-col gap-3">
        <SectionHeading id="admin-attention" title={t('attentionHeading')} />
        {!home.attentionComplete ? <p className="text-sm leading-5 text-muted-foreground">{t('attentionIncomplete')}</p> : null}
        {rows.length || home.attentionComplete ? <AttentionList items={rows} /> : null}
      </section>
    </PageShell>
  )
}
