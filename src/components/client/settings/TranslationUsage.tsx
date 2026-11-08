'use client'

import { useId } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { ButtonLink } from '@/components/app/ui/Button'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { ProgressBar } from '@/components/app/ui/ProgressBar'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import type { TranslationUsageView } from '@/lib/translate/usage-view'

/**
 * Settings → Translations (Tom, 2026-11-08). How many characters the site has
 * translated with the Translate button this month, against its monthly limit.
 * Read-only for everyone who can open Settings: the limit is set by Abluo.
 *
 * Shown only when the Translate module is on (the page passes null otherwise).
 * `view === 'unavailable'` = the count could not be read: say so, never show 0.
 */
export function TranslationUsage({ projectSlug, view }: { projectSlug: string; view: TranslationUsageView | 'unavailable' }) {
  const t = useTranslations('clientDashboard.settings.translations')
  const locale = useLocale()
  const headingId = useId()
  const n = (v: number) => new Intl.NumberFormat(locale).format(v)

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <SectionHeading id={headingId} title={t('title')} />
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      {view === 'unavailable' ? (
        <Notice tone="info">{t('unavailable')}</Notice>
      ) : (
        <Panel padding="lg" className="flex flex-col gap-3">
          <p className="text-[0.9375rem] font-semibold text-foreground">
            {view.limit === null ? t('usedNoLimit', { used: n(view.used) }) : t('usedOfLimit', { used: n(view.used), limit: n(view.limit) })}
          </p>
          {view.share !== null ? <ProgressBar value={view.share} decorative /> : null}
          <p className="text-sm text-muted-foreground">
            {view.limit === null ? t('noLimit') : t('resets', { date: formatDay(view.resetsOn, locale) })}
          </p>
          {view.state === 'near' ? <Notice tone="info">{t('near', { percent: Math.round((view.share ?? 0) * 100) })}</Notice> : null}
          {view.state === 'reached' ? (
            <Notice
              tone="info"
              action={
                <ButtonLink variant="secondary" href={`/${projectSlug}/support`}>
                  {t('support')}
                </ButtonLink>
              }
            >
              {t('reached', { date: formatDay(view.resetsOn, locale) })}
            </Notice>
          ) : null}
        </Panel>
      )}
    </section>
  )
}

/** "1 December" in the person's language. The day is a calendar date, so it is formatted in UTC. */
function formatDay(isoDay: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${isoDay}T00:00:00Z`))
  } catch {
    return isoDay
  }
}
