'use client'

import { useCallback, useId, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Button } from '@/components/app/ui/Button'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Tabs, tabPanelProps } from '@/components/app/ui/Tabs'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { signOutEveryoneAction } from '@/app/[locale]/(client)/[tenant]/access/actions'
import type { AccessActionError, AccessActionResult } from '@/lib/access/action-errors'
import type { AccessDashboardData } from '@/lib/access/dashboard'
import { errorText } from './access-bits'
import { DocumentsTab } from './DocumentsTab'
import { GroupsTab } from './GroupsTab'
import { PagesTab } from './PagesTab'

export type AccessRunner = {
  busy: boolean
  /** Runs one action: toast + refresh on success. Resolves true, or the error code. */
  run: (action: () => Promise<AccessActionResult>, done: string, opts?: { keepOpenOnError?: boolean }) => Promise<true | AccessActionError>
  /** A change finished elsewhere (an upload, a create): toast + refresh. */
  done: (message: string) => void
  fail: (message: string) => void
}

type TabId = 'groups' | 'documents' | 'pages'
const TABS: TabId[] = ['groups', 'documents', 'pages']

/**
 * Access (ADR-040 B2.5) — the tenant's one screen for members-only content:
 *
 *   Groups     who the members are, each with the password they share
 *   Documents  protected PDFs and who can open each
 *   Pages      who can see each page of the site
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
  initialTab,
}: {
  projectSlug: string
  data: AccessDashboardData
  canManage: boolean
  supportVisit: boolean
  initialTab: string | null
}) {
  const t = useTranslations('clientDashboard.access')
  const router = useRouter()
  const idBase = useId()
  const { toast, show } = useUndo()
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<TabId>(TABS.includes(initialTab as TabId) ? (initialTab as TabId) : 'groups')
  const [creating, setCreating] = useState<TabId | null>(null)
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

  const changeTab = (next: string) => {
    setTab(next as TabId)
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', next)
      window.history.replaceState(window.history.state, '', url)
    } catch {
      /* remembering the tab is a convenience */
    }
  }

  const usage = useMemo(() => {
    const u: Record<string, { pages: number; documents: number }> = {}
    if (data.notReady) return u
    for (const g of data.groups) u[g.id] = { pages: 0, documents: 0 }
    for (const p of data.pages) if (p.visibility === 'restricted') for (const id of p.groupIds) if (u[id]) u[id].pages++
    for (const d of data.documents) if (!d.archived) for (const id of d.groupIds) if (u[id]) u[id].documents++
    return u
  }, [data])

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

  const liveGroups = data.groups.filter((g) => !g.archived)
  const action =
    canManage && tab === 'groups' ? (
      <Button variant="primary" onClick={() => setCreating('groups')}>{t('groups.new')}</Button>
    ) : canManage && tab === 'documents' ? (
      <Button variant="primary" onClick={() => setCreating('documents')}>{t('documents.new')}</Button>
    ) : null

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

      <Tabs
        label={t('tabsLabel')}
        idBase={idBase}
        value={tab}
        onChange={changeTab}
        items={[
          { id: 'groups', label: t('tabs.groups'), count: liveGroups.length },
          { id: 'documents', label: t('tabs.documents'), count: data.documents.filter((d) => !d.archived).length },
          { id: 'pages', label: t('tabs.pages'), count: data.pages.filter((p) => p.visibility === 'restricted').length },
        ]}
      />

      <div {...tabPanelProps(idBase, tab)}>
        {tab === 'groups' ? (
          <GroupsTab
            projectSlug={projectSlug}
            groups={data.groups}
            usage={usage}
            canManage={canManage}
            limits={data.limits}
            creating={creating === 'groups'}
            onCreatingChange={(open) => setCreating(open ? 'groups' : null)}
            runner={runner}
          />
        ) : tab === 'documents' ? (
          <DocumentsTab
            projectSlug={projectSlug}
            documents={data.documents}
            groups={data.groups}
            site={data.site}
            canManage={canManage}
            maxBytes={data.limits.fileBytesMax}
            creating={creating === 'documents'}
            onCreatingChange={(open) => setCreating(open ? 'documents' : null)}
            onShowGroups={() => changeTab('groups')}
            runner={runner}
          />
        ) : (
          <PagesTab projectSlug={projectSlug} pages={data.pages} groups={data.groups} canManage={canManage} onShowGroups={() => changeTab('groups')} runner={runner} />
        )}
      </div>

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
