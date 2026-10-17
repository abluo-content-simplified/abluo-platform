'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { Chip } from '@/components/app/ui/Chip'
import { ICONS } from './post-bits'

export { BarButton, SheetItem } from '@/components/app/ui/BarButton'

/** Posts list: the category sheet (the end-date sheet is the shared UnpublishDateSheet). BarButton / SheetItem now live in ui/BarButton (re-exported here). */

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
            <Chip key={c.value} selected={on} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== c.value) : [...p, c.value]))}>
              {on ? ICONS.tick : null}
              {c.label}
            </Chip>
          )
        })}
      </div>
      <Button variant="primary" size="lg" className="mt-4" disabled={busy} onClick={() => onSave(picked)}>
        {t('categorySheet.save')}
      </Button>
    </BottomSheet>
  )
}
