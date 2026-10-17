'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { changeTypeWarning } from '@/lib/modules/catalogue/change-type'
import type { ItemProfile } from '@/lib/modules/catalogue/dashboard-form'

import { ProfileField } from './item-fields'
import { Button } from '@/components/app/ui/Button'

/**
 * "Change type" (Amendment I-4): the same type cards as the first step, current
 * one marked. Choosing another type applies it straight away, unless it would
 * clear the allergen declaration (warning first) or hide filled book details
 * (a lighter note). Choosing the current type just closes.
 */
export function ChangeTypeSheet({ open, current, hasBookDetails, onClose, onChange }: { open: boolean; current: ItemProfile | null; hasBookDetails: boolean; onClose: () => void; onChange: (next: ItemProfile) => void }) {
  const t = useTranslations('catalogue.dashboard.item.editor.type')
  const [pending, setPending] = useState<ItemProfile | null>(null)
  const warning = pending ? changeTypeWarning({ from: current, to: pending, hasBookDetails }) : null
  const close = () => {
    setPending(null)
    onClose()
  }
  const apply = (next: ItemProfile) => {
    setPending(null)
    onChange(next)
    onClose()
  }
  return (
    <BottomSheet open={open} title={t('change')} onClose={close}>
      {pending && warning ? (
        <div>
          <p role="alert" className="text-[0.9375rem] leading-6 text-foreground">
            {t(warning === 'allergens' ? 'warnAllergens' : 'warnBookDetails')}
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
            <Button variant="primary" onClick={() => apply(pending)}>
              {t('confirm')}
            </Button>
            <Button variant="secondary" onClick={() => setPending(null)}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <ProfileField
          value={current}
          currentLabel={t('current')}
          onChange={(next) => {
            if (next === current) return close()
            if (changeTypeWarning({ from: current, to: next, hasBookDetails })) return setPending(next)
            apply(next)
          }}
        />
      )}
    </BottomSheet>
  )
}
