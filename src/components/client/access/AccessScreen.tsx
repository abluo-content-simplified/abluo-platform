'use client'

import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Button } from '@/components/app/ui/Button'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { signOutEveryoneAction } from '@/app/[locale]/(client)/[tenant]/access/actions'
import type { AccessActionError, AccessActionResult } from '@/lib/access/action-errors'
import type { AccessDashboardData } from '@/lib/access/dashboard'
import { errorText } from './access-bits'
import { AccessGroupsBrowser } from './AccessGroupsBrowser'

export type AccessRunner = {
  busy: boolean
  /** Runs one action: toast + refresh on success. Resolves true, or the error code. */
  run: (action: () => Promise<AccessActionResult>, done: string, opts?: { keepOpenOnError?: boolean }) => Promise<true | AccessActionError>
  /** A change finished elsewhere (an upload, a create): toast + refresh. */
  done: (message: string) => void
  fail: (message: string) => void
}

/**
 * Access (ADR-040 B2.5, trimmed in R9 §15) — the groups of visitors who may
 * open protected pages and documents, each with the password they share, and
 * who is signed in now. Which pages are protected is set in Studio; which
 * documents a group opens, in Documents.
 *
 * Written for someone who has never configured security: everyday words,
 * one sheet per task, every consequence said before it happens (who gets
 * signed out, who loses access) and confirmed after. Every action is
 * re-checked on the server; a support visit and people without
 * `members.access.manage` see everything read-only.
 */
export function AccessScreen({
  projectSlug,
  data,
  canManage,
  supportVisit,
}: {
  projectSlug: string
  data: AccessDashboardData
  canManage: boolean
  supportVisit: boolean
}) {
  const t = useTranslations('clientDashboard.access')
  const router = useRouter()
  const { toast, show } = useUndo()
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  const done = useCallback(
    (message: string) => {
      show({ message, tone: 'status' })
      router.refresh()
    },
    [router, show]
  )
  const fail = useCallback((message: string) => show({ message, tone: 'error' }), [show])

  const runner: AccessRunner = useMemo(
    () => ({
      busy,
      done,
      fail,
      async run(action, message, opts) {
        if (busy) return 'failed'
        setBusy(true)
        try {
          const r = await action()
          if (!r.ok) {
            if (!opts?.keepOpenOnError) fail(errorText(t, r.error))
            return r.error
          }
          done(message)
          return true
        } catch {
          if (!opts?.keepOpenOnError) fail(t('errors.failed'))
          return 'failed'
        } finally {
          setBusy(false)
        }
      },
    }),
    [busy, done, fail, t]
  )

  const readOnlyNotice = supportVisit ? (
    <Notice tone="info">{t('supportReadOnly')}</Notice>
  ) : !canManage ? (
    <Notice tone="info">{t('readOnly')}</Notice>
  ) : null

  if (data.notReady) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('title')} />
        <p className="max-w-2xl text-[0.9375rem] leading-6 text-muted-foreground">{t('intro')}</p>
        <Notice tone="info" title={t('notReady.title')}>{t('notReady.body')}</Notice>
      </div>
    )
  }

  const action = canManage ? <Button variant="primary" onClick={() => setCreating(true)}>{t('groups.new')}</Button> : null

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} actions={action} />
      <p className="max-w-2xl text-[0.9375rem] leading-6 text-muted-foreground">{t('intro')}</p>
      {readOnlyNotice}

      {data.signedInTotal !== null ? (
        <Notice
          tone="neutral"
          layout="row"
          action={
            canManage && data.signedInTotal > 0 ? (
              <Button variant="destructive" onClick={() => setConfirmSignOut(true)}>{t('signOutEveryone')}</Button>
            ) : undefined
          }
        >
          {data.signedInTotal > 0 ? t('signedInNow', { count: data.signedInTotal }) : t('signedInNobody')}
        </Notice>
      ) : null}

      <AccessGroupsBrowser
        projectSlug={projectSlug}
        groups={data.groups}
        canManage={canManage}
        limits={data.limits}
        creating={creating}
        onCreatingChange={setCreating}
        runner={runner}
      />

      {canManage ? (
        <ConfirmDialog
          open={confirmSignOut}
          title={t('signOutConfirm.title')}
          body={t('signOutConfirm.body', { count: data.signedInTotal ?? 0 })}
          confirmLabel={t('signOutEveryone')}
          busy={busy}
          onConfirm={() => {
            setConfirmSignOut(false)
            void (async () => {
              setBusy(true)
              try {
                const r = await signOutEveryoneAction({ projectSlug })
                if (!r.ok) return fail(errorText(t, r.error))
                done(t('signedOutToast', { count: r.signedOut }))
              } catch {
                fail(t('errors.failed'))
              } finally {
                setBusy(false)
              }
            })()
          }}
          onCancel={() => setConfirmSignOut(false)}
        />
      ) : null}

      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </div>
  )
}
