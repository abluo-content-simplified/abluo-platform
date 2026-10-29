'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { PublicationDates } from '@/components/app/lifecycle/PublicationDates'
import { datesSentence, shortMoment } from '@/components/app/lifecycle/publish-plan'
import { publishedStatus } from '@/lib/lifecycle/status'
import type { useCatalogueDraft } from './use-catalogue-draft'
import { useCatalogueError } from './catalogue-ui'
import { useDateLocale } from '@/lib/i18n/date-locale-context'

export type CatalogueLive = { rev: string; publishedAt: string | null; expiresAt: string | null }

/**
 * "On your website" for a published item or collection (ADR-032 D8): the shared
 * From / Until rows bound to the live dates. Every change applies at once on
 * both versions (the draft's content stays a draft until it is published).
 * Used by the item editor and the collection builder.
 *
 *   <CatalogueDates id="item-dates" live={live} onLive={setLive} draft={draft} zone={zone} disabled={busy} onNotice={show} />
 */
export function CatalogueDates({
  id,
  live,
  onLive,
  draft,
  zone,
  disabled = false,
  onNotice,
}: {
  id: string
  live: CatalogueLive
  /** The new live state after a change (the caller keeps it, so the next change uses the new revision). */
  onLive: (next: CatalogueLive) => void
  draft: Pick<ReturnType<typeof useCatalogueDraft>, 'setDates'>
  /** The site's IANA time zone. */
  zone: string
  /** The caller is busy with something else. */
  disabled?: boolean
  onNotice: (n: { message: string; tone: 'status' | 'error' }) => void
}) {
  const t = useTranslations('catalogue.dashboard.dates')
  const tp = useTranslations('app.lifecycle.publish')
  const dateLocale = useDateLocale()
  const errorText = useCatalogueError()
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const online = publishedStatus({ publishedAt: live.publishedAt, expiresAt: live.expiresAt, archivedAt: null }, 'optional', now) === 'published'
  const sv = datesSentence(live, now)
  const m = (iso?: string) => (iso ? tp('moment', shortMoment(iso, zone, dateLocale)) : '')

  async function save(next: { from: string | null; until: string | null }) {
    if (busy || disabled) return
    const keepStart = next.from !== null && next.from === live.publishedAt
    setBusy(true)
    try {
      const r = await draft.setDates({ rev: live.rev, ...(keepStart ? {} : { publishedAt: next.from ?? 'now' }), expiresAt: next.until })
      if (!r.ok) return onNotice({ message: errorText(r.error), tone: 'error' })
      setNow(new Date())
      onLive({ rev: r.live.rev, publishedAt: r.live.publishedAt, expiresAt: r.live.expiresAt })
      onNotice({ message: t('saved'), tone: 'status' })
    } catch {
      onNotice({ message: errorText('failed'), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <PublicationDates
      id={id}
      from={live.publishedAt}
      until={live.expiresAt}
      zone={zone}
      busy={busy || disabled}
      fromNote={online ? t('fromNote') : undefined}
      onChange={(next) => void save(next)}
      sentence={tp(sv.key, { start: m(sv.start), end: m(sv.end) })}
    />
  )
}
