'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Checkbox } from '@/components/app/ui/Checkbox'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'

/**
 * The strong confirmation for "Anonymise" (owner only, ADR-043 D4): says what
 * goes (photo, bios, contacts, links, private details), what stays (the empty
 * record, so content that names them does not break) and that it cannot be
 * undone — unlike archiving. The confirm button stays unavailable until the
 * box is ticked; the box says why.
 */
export function PersonAnonymiseDialog({
  open,
  name,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean
  name: string
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useTranslations('clientDashboard.persons.anonymise')
  const [understood, setUnderstood] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start unticked each time
    if (open) setUnderstood(false)
  }, [open])
  return (
    <ConfirmDialog
      open={open}
      title={t('title', { name })}
      body={t('body')}
      confirmLabel={t('confirm')}
      busy={busy || !understood}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <label className="flex cursor-pointer items-start gap-1 text-[0.9375rem] leading-6 text-foreground">
        <Checkbox checked={understood} aria-label={t('understood')} onChange={setUnderstood} />
        <span className="pt-2.5">{t('understood')}</span>
      </label>
    </ConfirmDialog>
  )
}
