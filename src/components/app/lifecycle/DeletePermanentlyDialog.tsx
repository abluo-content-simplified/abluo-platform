'use client'

import { useTranslations } from 'next-intl'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'

/**
 * ADR-032 slice 6 — the confirmation for "Delete permanently" (archived
 * content only; Owner / Site admin). Names the item; says Abluo can recover it
 * within 90 days (D9: never "irreversible"). One click — archiving first is
 * the safety step.
 */
export function DeletePermanentlyDialog({
  open,
  titles,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean
  /** The items' titles (one = named in the dialog). */
  titles: string[]
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useTranslations('app.lifecycle.deletePermanently')
  const count = titles.length
  const title = titles[0] ?? ''
  return (
    <ConfirmDialog
      open={open}
      title={t('title', { count, title })}
      body={t('body', { count, title })}
      confirmLabel={t('confirm')}
      busy={busy}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
