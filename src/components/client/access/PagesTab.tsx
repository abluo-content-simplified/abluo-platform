'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { RadioList } from '@/components/app/ui/RadioList'
import { Pill } from '@/components/app/ui/list/cells'
import { setPageAccessAction } from '@/app/[locale]/(client)/[tenant]/access/actions'
import type { AccessGroupView } from '@/lib/access/dashboard'
import type { AccessPageItem } from '@/lib/access/page-visibility'
import { errorText, GroupChecklist, groupNames } from './access-bits'
import type { AccessRunner } from './AccessScreen'

/**
 * Who can see each page (ADR-040 B2.5). The home page is always public. A
 * members-only page shows a short "members only" notice and the password
 * prompt to everyone else; its content never leaves the server for them.
 */
export function PagesTab({
  projectSlug,
  pages,
  groups,
  canManage,
  onShowGroups,
  runner,
}: {
  projectSlug: string
  pages: AccessPageItem[]
  groups: AccessGroupView[]
  canManage: boolean
  onShowGroups: () => void
  runner: AccessRunner
}) {
  const t = useTranslations('clientDashboard.access')
  const [editing, setEditing] = useState<AccessPageItem | null>(null)

  if (pages.length === 0) return <EmptyState title={t('pages.emptyTitle')} body={t('pages.emptyBody')} />

  return (
    <div className="flex flex-col gap-4">
      <Panel padding="none">
        <ul className="divide-y divide-border">
          {pages.map((p) => {
            const who = groupNames(groups, p.groupIds, (n) => t('groups.archivedName', { name: n }))
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-5">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-[0.9375rem] leading-6 font-medium text-foreground">{p.title}</span>
                  <span className="truncate text-sm text-muted-foreground" translate="no">/{p.path}</span>
                  {p.closedBy && p.visibility === 'public' ? (
                    <span className="text-sm text-muted-foreground">{t('pages.closedBy', { title: p.closedBy })}</span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {p.isHome ? (
                    <Pill tone="outline">{t('pages.alwaysPublic')}</Pill>
                  ) : p.visibility === 'restricted' ? (
                    <Pill tone="highlight">{who.length ? t('pages.membersOf', { groups: who.join(', ') }) : t('pages.membersNobody')}</Pill>
                  ) : (
                    <Pill tone="outline">{t('pages.everyone')}</Pill>
                  )}
                  {canManage && !p.isHome ? (
                    <Button variant="secondary" size="md" aria-label={t('pages.changeFor', { title: p.title })} onClick={() => setEditing(p)}>
                      {t('pages.change')}
                    </Button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      </Panel>

      <PageAccessSheet
        page={editing}
        groups={groups}
        onShowGroups={() => {
          setEditing(null)
          onShowGroups()
        }}
        onClose={() => setEditing(null)}
        onSave={async (value) => {
          const p = editing!
          const ok = await runner.run(
            () => setPageAccessAction({ projectSlug, pageId: p.id, rev: p.rev, draftRev: p.draftRev, ...value }),
            value.visibility === 'public' ? t('pages.savedPublic', { title: p.title }) : t('pages.savedMembers', { title: p.title }),
            { keepOpenOnError: true }
          )
          if (ok === true) setEditing(null)
          return ok
        }}
      />
    </div>
  )
}

type Value = { visibility: 'public' | 'restricted'; groupIds: string[]; navigation: 'hidden' | 'locked' }

function PageAccessSheet({
  page,
  groups,
  onShowGroups,
  onClose,
  onSave,
}: {
  page: AccessPageItem | null
  groups: AccessGroupView[]
  onShowGroups: () => void
  onClose: () => void
  onSave: (value: Value) => Promise<true | string>
}) {
  const t = useTranslations('clientDashboard.access')
  const [value, setValue] = useState<Value>({ visibility: 'public', groupIds: [], navigation: 'hidden' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const liveGroups = groups.filter((g) => !g.archived)

  useEffect(() => {
    if (!page) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start from the page's current rule
    setValue({ visibility: page.visibility, groupIds: page.groupIds.filter((id) => liveGroups.some((g) => g.id === id)), navigation: page.navigation })
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when another page opens
  }, [page?.id])

  const restricting = value.visibility === 'restricted'
  const wasRestricted = page?.visibility === 'restricted'
  const blocked = restricting && page?.hasFileDownload

  async function save() {
    if (busy || !page) return
    if (restricting && value.groupIds.length === 0) return setError(t('errors.groups_needed'))
    setBusy(true)
    setError(null)
    try {
      const r = await onSave(value)
      if (typeof r === 'string') setError(errorText(t, r))
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={page !== null} title={t('pages.sheetTitle', { title: page?.title ?? '' })} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <RadioList
          legend={t('pages.whoCanSee')}
          name="access-page-visibility"
          value={value.visibility}
          onChange={(v) => {
            setValue((x) => ({ ...x, visibility: v }))
            setError(null)
          }}
          options={[
            { value: 'public', label: t('pages.everyone'), description: t('pages.everyoneHint') },
            { value: 'restricted', label: t('pages.membersOnly'), description: t('pages.membersOnlyHint') },
          ]}
        />

        {restricting ? (
          blocked ? (
            <Notice tone="error">{t('errors.page_file_download')}</Notice>
          ) : liveGroups.length === 0 ? (
            <Notice tone="info" action={<Button variant="secondary" onClick={onShowGroups}>{t('documents.goToGroups')}</Button>}>
              {t('pages.noGroupsYet')}
            </Notice>
          ) : (
            <>
              <GroupChecklist legend={t('pages.whichGroups')} groups={groups} value={value.groupIds} onChange={(ids) => setValue((x) => ({ ...x, groupIds: ids }))} disabled={busy} />
              <RadioList
                legend={t('pages.inMenu')}
                name="access-page-navigation"
                value={value.navigation}
                onChange={(v) => setValue((x) => ({ ...x, navigation: v }))}
                options={[
                  { value: 'hidden', label: t('pages.menuHidden'), description: t('pages.menuHiddenHint') },
                  { value: 'locked', label: t('pages.menuLocked'), description: t('pages.menuLockedHint') },
                ]}
              />
            </>
          )
        ) : wasRestricted ? (
          <Notice tone="info">{t('pages.makingPublic')}</Notice>
        ) : null}

        {page?.closedBy ? <p className="text-sm text-muted-foreground">{t('pages.closedBy', { title: page.closedBy })}</p> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" type="submit" disabled={busy || Boolean(blocked) || (restricting && liveGroups.length === 0)}>
            {busy ? t('saving') : wasRestricted && !restricting ? t('pages.makePublic') : t('save')}
          </Button>
        </div>
      </form>
    </BottomSheet>
  )
}
