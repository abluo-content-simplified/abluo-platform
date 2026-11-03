'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AppIcon } from '@/components/app/shell/AppIcon'
import { Button } from '@/components/app/ui/Button'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { LinkCard } from '@/components/app/ui/LinkCard'
import { Notice } from '@/components/app/ui/Notice'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { StatGrid } from '@/components/app/ui/StatGrid'
import { StatTile } from '@/components/app/ui/StatTile'
import type { SetupSource } from '@/lib/modules/catalogue/settings/model'
import { completeCatalogueSetupAction } from '@/app/[locale]/(client)/[tenant]/catalogue/setup/settings-actions'
import { setupHref, type SetupSection } from './setup-model'
import { SetupHeader, useFailText, useSetupToast } from './setup-ui'

export type SetupOverviewData = {
  rev: string
  completedAt: string | null
  source: SetupSource | null
  counts: { items: number; categories: number; tags: number; channels: number; activeChannels: number; formatTemplates: number }
  publicName: string | null
  publicSegment: string | null
  currency: string | null
}

/** Icon paths (24×24 strokes) of the section cards. */
const ICON: Record<Exclude<SetupSection, 'overview'>, string> = {
  starters: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12 4 7.5',
  categories: 'M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z',
  channels: 'M3 12h4l3-8 4 16 3-8h4',
  defaults: 'M4 7h16M4 12h10M4 17h6M17 14l3 3-3 3',
  website: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
}

/**
 * Catalogue → Setup → Overview (spec §10.1): whether setup is complete (D-14: starting empty, a
 * starter structure, or marking it complete by hand), the counts, and one card per section.
 * Publication standards and Import / Export are later slices and have no card yet.
 */
export function SetupOverview({ projectSlug, data }: { projectSlug: string; data: SetupOverviewData }) {
  const t = useTranslations('catalogue.setup.overview')
  const ui = useLocale()
  const [completedAt, setCompletedAt] = useState(data.completedAt)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useSetupToast()
  const failText = useFailText()
  const c = data.counts
  const when = completedAt ? new Intl.DateTimeFormat(ui, { dateStyle: 'long' }).format(new Date(completedAt)) : null

  async function complete() {
    setBusy(true)
    setError(null)
    const r = await completeCatalogueSetupAction({ projectSlug, rev: data.rev, source: 'manual' })
    setBusy(false)
    if (!r.ok) return setError(failText(r))
    setCompletedAt(r.completedAt)
    setAsking(false)
    toast.show(t('completedDone'))
  }

  const cards: { section: Exclude<SetupSection, 'overview'>; subline: string }[] = [
    { section: 'starters', subline: t('startersLine') },
    { section: 'categories', subline: t('categoriesLine', { categories: c.categories, tags: c.tags }) },
    { section: 'channels', subline: c.channels ? t('channelsLine', { active: c.activeChannels, total: c.channels }) : t('channelsNone') },
    { section: 'defaults', subline: t('defaultsLine', { count: c.formatTemplates }) },
    { section: 'website', subline: data.publicSegment ? t('websiteLine', { name: data.publicName ?? '—', segment: `/${data.publicSegment}`, currency: data.currency ?? '—' }) : t('websiteNone') },
  ]

  return (
    <div className="space-y-6">
      <SetupHeader title={t('title')} intro={t('intro')} />
      {completedAt ? (
        <Notice tone="info" title={t('completeTitle')}>
          {data.source && completedAt === data.completedAt ? t(`completeBody.${data.source}`, { date: when ?? '' }) : t('completeBody.manual', { date: when ?? '' })}
        </Notice>
      ) : (
        <Notice
          tone="neutral"
          title={t('incompleteTitle')}
          action={
            <Button variant="secondary" onClick={() => setAsking(true)}>
              {t('markComplete')}
            </Button>
          }
        >
          {t('incompleteBody')}
        </Notice>
      )}

      <StatGrid label={t('countsLabel')}>
        <StatTile label={t('counts.items')} value={c.items} href={`/${projectSlug}/catalogue/items`} />
        <StatTile label={t('counts.categories')} value={c.categories} href={setupHref(projectSlug, 'categories')} />
        <StatTile label={t('counts.tags')} value={c.tags} href={setupHref(projectSlug, 'categories')} />
        <StatTile label={t('counts.channels')} value={c.activeChannels} sub={c.channels !== c.activeChannels ? t('counts.channelsOff', { count: c.channels - c.activeChannels }) : undefined} href={setupHref(projectSlug, 'channels')} />
      </StatGrid>

      <section className="space-y-3" aria-labelledby="setup-sections">
        <SectionHeading id="setup-sections" title={t('sections')} />
        <div className="grid gap-3 md:grid-cols-2">
          {cards.map((card) => (
            <LinkCard key={card.section} href={setupHref(projectSlug, card.section)} icon={<AppIcon d={ICON[card.section]} size={20} />} title={t(`titles.${card.section}`)} subline={card.subline} sublineLines={2} />
          ))}
        </div>
      </section>

      <ConfirmDialog
        open={asking}
        title={t('confirmTitle')}
        body={t('confirmBody')}
        confirmLabel={t('markComplete')}
        busy={busy}
        error={error}
        onConfirm={() => void complete()}
        onCancel={() => setAsking(false)}
      />
      {toast.node}
    </div>
  )
}
