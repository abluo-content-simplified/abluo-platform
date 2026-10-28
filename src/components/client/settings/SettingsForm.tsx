'use client'

import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { SavePill } from '@/components/app/ui/SavePill'
import type { SaveState } from '@/lib/client/autosave/engine'
import type { FormNotificationsView } from '@/lib/notifications/form-recipients-service'
import { FormNotifications } from './FormNotifications'

/**
 * Client dashboard — Settings (Tom, 2026-10-18; 2026-10-28). The client's own
 * settings for their website. Today one block: Form notifications. (The
 * affiliate programs live only in Connected Apps; nothing affiliate is
 * imported here — a test keeps it that way.) Each change saves by itself;
 * the SavePill says "Saved" only after the server confirmed. People who may
 * only look get the same page with the controls hidden and a line saying why.
 */
export function SettingsForm({
  projectSlug,
  notifications,
  readOnly,
  supportVisit,
}: {
  projectSlug: string
  /** null = the project document could not be found (nothing to show). */
  notifications: FormNotificationsView | null
  /** True when a support visit has no edit access. */
  readOnly: boolean
  supportVisit: boolean
}) {
  const t = useTranslations('clientDashboard.settings')
  const tn = useTranslations('clientDashboard.settings.formNotifications')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const editable = Boolean(notifications?.canWrite) && !readOnly
  const reload = useCallback(() => window.location.reload(), [])

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t('title')} actions={editable ? <SavePill state={saveState} onReload={reload} /> : null} />

      {!editable ? <Notice tone="info">{supportVisit && readOnly ? tn('readOnlySupport') : tn('readOnly')}</Notice> : null}

      <FormNotifications projectSlug={projectSlug} initial={notifications} editable={editable} onSaveState={setSaveState} />
    </div>
  )
}
