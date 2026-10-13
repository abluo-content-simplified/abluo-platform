'use client'

import { PublicationDateField } from '@/components/app/lifecycle/PublicationDateField'
import { validateWindow } from '@/lib/lifecycle/time'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { ICONS } from './post-bits'

export { BarButton, SheetItem } from '@/components/app/ui/BarButton'

/** Posts list: the end-date and category sheets. BarButton / SheetItem now live in ui/BarButton (re-exported here). */

/**
 * "Set unpublish date" (ADR-032 slice 6): one date, entered in the site's time
 * zone with the shared PublicationDateField; must be in the future.
 */
export function EndDateSheet({
  open,
  busy,
  zone,
  onClose,
  onSave,
  onRemove,
}: {
  open: boolean
  busy: boolean
  /** The site's time zone. */
  zone: string
  onClose: () => void
  onSave: (iso: string) => void
  /** "Remove unpublish date" (the selection can hold posts that have one). */
  onRemove?: () => void
}) {
  const t = useTranslations('clientDashboard.posts.card')
  const tl = useTranslations('app.lifecycle')
  const [iso, setIso] = useState<string | null>(null)
  const problem = iso ? validateWindow({ expiresAt: iso }, new Date()) : null
  const valid = !!iso && !problem
  return (
    <BottomSheet open={open} title={t('endDateSheet.title')} onClose={onClose}>
      <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('endDateSheet.helper')}</p>
      <PublicationDateField
        id="posts-end-date"
        className="mt-4"
        label={tl('dates.unpublishOn')}
        value={iso}
        onChange={setIso}
        zone={zone}
        inputClassName="mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 text-base text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
      {problem === 'unpublish_in_past' ? <p className="mt-2 text-sm text-destructive">{tl('dates.mustBeFuture')}</p> : null}
      <button
        type="button"
        disabled={!valid || busy}
        onClick={() => iso && onSave(iso)}
        className="mt-4 inline-flex h-12 items-center justify-center rounded-xl bg-action px-5 text-[0.9375rem] font-semibold text-action-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40"
      >
        {t('endDateSheet.save')}
      </button>
      {onRemove ? (
        <button
          type="button"
          disabled={busy}
          onClick={onRemove}
          className="mt-2 inline-flex h-12 items-center justify-center rounded-xl px-5 text-[0.9375rem] font-medium text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40"
        >
          {tl('actions.removeUnpublishDate')}
        </button>
      ) : null}
    </BottomSheet>
  )
}

export function CategorySheet({
  open,
  busy,
  categories,
  onClose,
  onSave,
}: {
  open: boolean
  busy: boolean
  categories: { value: string; label: string }[]
  onClose: () => void
  onSave: (keys: string[]) => void
}) {
  const t = useTranslations('clientDashboard.posts.card')
  const [picked, setPicked] = useState<string[]>([])
  return (
    <BottomSheet open={open} title={t('categorySheet.title')} onClose={onClose}>
      <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('categorySheet.helper')}</p>
      <div role="group" aria-label={t('categorySheet.title')} className="mt-4 flex flex-wrap items-start gap-2">
        {categories.map((c) => {
          const on = picked.includes(c.value)
          return (
            <button
              key={c.value}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => setPicked((p) => (on ? p.filter((x) => x !== c.value) : [...p, c.value]))}
              className={`inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-[0.9375rem] font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                on ? 'border-action bg-action text-action-foreground' : 'border-border bg-card text-foreground hover:bg-hover'
              }`}
            >
              {on ? ICONS.tick : null}
              {c.label}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => onSave(picked)}
        className="mt-4 inline-flex h-12 items-center justify-center rounded-xl bg-action px-5 text-[0.9375rem] font-semibold text-action-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40"
      >
        {t('categorySheet.save')}
      </button>
    </BottomSheet>
  )
}
