'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { DatePicker } from '@/components/app/ui/DatePicker'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'

/**
 * "Change last date of classes" for the selected courses: one date, applied to
 * every active class of those courses. Repeating classes end on the last class
 * day on or before it (the intro says so); the result is reported per class by
 * the list. Nothing is sent until a date is chosen, and the button says why.
 */
export function CoursesLastDateDialog({
  open,
  count,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean
  /** How many courses are selected. */
  count: number
  busy?: boolean
  error?: string | null
  onClose: () => void
  onConfirm: (endsOn: string) => void
}) {
  const t = useTranslations('clientDashboard.courses.list.bulk.lastDate')
  const [day, setDay] = useState('')
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- each opening starts fresh
    if (open) setDay('')
  }, [open])
  return (
    <BottomSheet open={open} title={t('title', { count })} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (day && !busy) onConfirm(day)
        }}
      >
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('intro')}</p>
        <Field label={t('field')} hint={day ? undefined : t('needed')}>
          {(p) => <DatePicker {...p} value={day} onChange={setDay} disabled={busy} title={t('field')} placeholder={t('placeholder')} />}
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={!day || busy} aria-busy={busy || undefined}>
            {busy ? t('changing') : t('confirm')}
          </Button>
        </div>
      </form>
    </BottomSheet>
  )
}
