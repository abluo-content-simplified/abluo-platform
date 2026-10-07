'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { BottomSheet } from '@/components/client/ui/BottomSheet'
import { ICONS } from './post-bits'

export { BarButton, SheetItem } from '@/components/client/ui/BarButton'

/** Posts list: the end-date and category sheets. BarButton / SheetItem now live in ui/BarButton (re-exported here). */

export function EndDateSheet({
  open,
  busy,
  onClose,
  onSave,
  onRemove,
}: {
  open: boolean
  busy: boolean
  onClose: () => void
  onSave: (iso: string) => void
  /** "Remove end date" (the selection can hold posts that have one). */
  onRemove?: () => void
}) {
  const t = useTranslations('clientDashboard.posts.card')
  const [value, setValue] = useState('')
  /** The chosen moment as ISO when it is in the future (checked as it changes), else ''. */
  const [iso, setIso] = useState('')
  const valid = !!iso
  return (
    <BottomSheet open={open} title={t('endDateSheet.title')} onClose={onClose}>
      <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('endDateSheet.helper')}</p>
      <label htmlFor="posts-end-date" className="mt-4 text-[0.9375rem] font-medium">
        {t('endDateSheet.label')}
      </label>
      <input
        id="posts-end-date"
        type="datetime-local"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          const at = Date.parse(e.target.value)
          setIso(!Number.isNaN(at) && at > Date.now() ? new Date(at).toISOString() : '')
        }}
        className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 text-base text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
      <button
        type="button"
        disabled={!valid || busy}
        onClick={() => onSave(iso)}
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
          {t('more.removeEndDate')}
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
