'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '../ui/Button'
import { DateTimeSheet } from '../ui/DateTimePicker'
import { shortMoment } from './publish-plan'
import { useDateLocale } from '@/lib/i18n/date-locale-context'

/**
 * When something is on the website, as two rows (ADR-032 D8: entered in the
 * SITE's zone):
 *
 *   From   "Now" · "3 Nov at 9:00" (Back to now · Change) · "Since 17 Oct at 22:22" (Change)
 *   Until  "No end date" (Add an end date) · "31 Oct at 18:00" (Remove · Change)
 *
 * plus one plain `sentence` underneath (aria-live) that the caller words for
 * its situation. Used by PublishChoice's Schedule and by an editor's
 * Publication block (post overview), where every change applies at once.
 * `onChange` gets both dates: a From later than the Until drops the Until.
 *
 *   <PublicationDates id="post-dates" from={publishedAt} until={expiresAt} zone={zone}
 *     onChange={({ from, until }) => save(from, until)} sentence={sentence} />
 */
export function PublicationDates({
  id,
  from,
  until,
  onChange,
  zone,
  allowUntil = true,
  busy = false,
  fromNote,
  sentence,
}: {
  /** Prefix for the element ids. */
  id: string
  /** Go-live moment (UTC ISO); null = now. A past moment reads "Since …". */
  from: string | null
  /** End moment (UTC ISO); null = no end date. */
  until: string | null
  onChange: (next: { from: string | null; until: string | null }) => void
  /** The site's IANA time zone. */
  zone: string
  /** Offer the Until row (default true). */
  allowUntil?: boolean
  /** Keeps the buttons off while the caller saves. */
  busy?: boolean
  /** Shown in the From picker above Done: what a later moment will do. */
  fromNote?: string
  /** One plain sentence about the result. */
  sentence?: ReactNode
}) {
  const t = useTranslations('app.lifecycle.publish')
  const dateLocale = useDateLocale()
  const [editing, setEditing] = useState<'from' | 'until' | null>(null)
  const [openedAt] = useState(() => Date.now())
  const moment = (iso: string) => t('moment', shortMoment(iso, zone, dateLocale))
  const past = !!from && Date.parse(from) <= openedAt
  const end = allowUntil ? until : null

  return (
    <div>
      <div className="flex flex-col">
        <Row id={`${id}-from`} label={t('from')} value={!from ? t('nowLabel') : past ? t('sinceMoment', { moment: moment(from) }) : moment(from)}>
          {from && !past ? (
            <Button variant="quiet" disabled={busy} onClick={() => onChange({ from: null, until: end })}>
              {t('backToNow')}
            </Button>
          ) : null}
          <Button variant="secondary" disabled={busy} aria-describedby={`${id}-from`} onClick={() => setEditing('from')}>
            {t('change')}
          </Button>
        </Row>
        {allowUntil ? (
          <Row id={`${id}-until`} label={t('until')} value={end ? moment(end) : t('noEnd')}>
            {end ? (
              <>
                <Button variant="quiet" disabled={busy} onClick={() => onChange({ from, until: null })}>
                  {t('remove')}
                </Button>
                <Button variant="secondary" disabled={busy} aria-describedby={`${id}-until`} onClick={() => setEditing('until')}>
                  {t('change')}
                </Button>
              </>
            ) : (
              <Button variant="secondary" disabled={busy} onClick={() => setEditing('until')}>
                {t('addEnd')}
              </Button>
            )}
          </Row>
        ) : null}
      </div>

      {sentence ? (
        <p className="mt-3 text-[0.9375rem] leading-6 font-medium text-foreground" aria-live="polite">
          {sentence}
        </p>
      ) : null}

      <DateTimeSheet
        open={editing === 'from'}
        title={t('from')}
        value={from && !past ? from : null}
        zone={zone}
        note={fromNote}
        onClose={() => setEditing(null)}
        onDone={(utc) => {
          setEditing(null)
          // A From after the Until drops the Until (it would be invalid).
          onChange({ from: utc, until: end && Date.parse(end) <= Date.parse(utc) ? null : end })
        }}
      />
      <DateTimeSheet
        open={editing === 'until'}
        title={t('until')}
        value={end}
        zone={zone}
        after={from}
        onClose={() => setEditing(null)}
        onDone={(utc) => {
          setEditing(null)
          onChange({ from, until: utc })
        }}
      />
    </div>
  )
}

function Row({ id, label, value, children }: { id: string; label: string; value: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border py-3">
      <div id={id} className="min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-[1.0625rem] font-medium text-foreground">{value}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}
