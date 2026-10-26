'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CardMenu } from '@/components/app/ui/CardMenu'
import { DragGrip, DropLine } from '@/components/app/ui/DragGrip'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { Panel } from '@/components/app/ui/Panel'
import { Pill } from '@/components/app/ui/list/cells'
import { dropIndex, usePointerDrag } from '@/components/app/ui/use-pointer-drag'
import { removeDocumentFromPageAction, reorderPageDocumentsAction } from '@/app/[locale]/(client)/[tenant]/document-library/actions'
import type { DocumentsDashboardData, DocumentView } from '@/lib/access/documents-dashboard'
import type { DownloadPage } from '@/lib/access/download-pages'
import { documentErrorText } from './document-bits'

type Ready = Extract<DocumentsDashboardData, { notReady: false }>

/**
 * Pages (ADR-040 §15) — a READ-ONLY recap of the pages that can show
 * documents (they have a Download section, added by Abluo in Studio): public
 * or protected, for which groups, and the documents on each, in order. The
 * client can reorder the documents on a page and take one off a page; the
 * page itself is never edited here.
 */
export function DocumentPagesRecap({
  projectSlug,
  data,
  canManage,
  onDone,
  onFail,
}: {
  projectSlug: string
  data: Ready
  canManage: boolean
  onDone: (message: string) => void
  onFail: (message: string) => void
}) {
  const t = useTranslations('clientDashboard.documents')
  if (data.pages.length === 0) return <EmptyState title={t('noPages.title')} body={t('noPages.body')} />
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-[0.9375rem] leading-6 text-muted-foreground">{t('pagesIntro')}</p>
      <ul className="flex flex-col gap-4">
        {data.pages.map((page) => (
          <PageCard key={page.id} projectSlug={projectSlug} page={page} data={data} canManage={canManage} onDone={onDone} onFail={onFail} />
        ))}
      </ul>
    </div>
  )
}

function PageCard({
  projectSlug,
  page,
  data,
  canManage,
  onDone,
  onFail,
}: {
  projectSlug: string
  page: DownloadPage
  data: Ready
  canManage: boolean
  onDone: (message: string) => void
  onFail: (message: string) => void
}) {
  const t = useTranslations('clientDashboard.documents')
  const groupName = useMemo(() => new Map(data.groups.map((g) => [g.id.toLowerCase(), g.name])), [data.groups])
  const placed = useMemo(
    () => data.documents
      .filter((d) => !d.archived && d.pageIds.includes(page.id))
      .sort((a, b) => (a.pageOrder[page.id] ?? 0) - (b.pageOrder[page.id] ?? 0) || a.createdAt.localeCompare(b.createdAt)),
    [data.documents, page.id]
  )
  const [order, setOrder] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const ids = order ?? placed.map((d) => d.id)
  const byId = new Map(placed.map((d) => [d.id, d]))
  const pageName = page.isHome ? t('homePage') : page.title

  async function save(next: string[]) {
    setOrder(next)
    setBusy(true)
    try {
      const r = await reorderPageDocumentsAction({ projectSlug, pageId: page.id, documentIds: next })
      if (!r.ok) { setOrder(null); onFail(documentErrorText(t, r.error)); return }
      onDone(t('orderSaved', { page: pageName }))
    } catch {
      setOrder(null)
      onFail(t('errors.failed'))
    } finally {
      setBusy(false)
    }
  }
  const move = (id: string, dir: -1 | 1) => {
    const i = ids.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    const next = [...ids]
    next.splice(i, 1)
    next.splice(j, 0, id)
    void save(next)
  }
  const drag = usePointerDrag((key, over) => {
    const at = dropIndex(ids, key, over)
    if (at === null) return
    const rest = ids.filter((k) => k !== key)
    rest.splice(at, 0, key)
    void save(rest)
  })
  async function remove(d: DocumentView) {
    setBusy(true)
    try {
      const r = await removeDocumentFromPageAction({ projectSlug, documentId: d.id, pageId: page.id })
      if (!r.ok) return onFail(documentErrorText(t, r.error))
      onDone(t('removedFromPage', { title: d.title, page: pageName }))
    } catch {
      onFail(t('errors.failed'))
    } finally {
      setBusy(false)
    }
  }

  const groups = page.groupIds.map((g) => groupName.get(g) ?? t('unknownGroup'))
  return (
    <Panel as="li" padding="md" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-[1.0625rem] leading-6 font-semibold break-words text-foreground">{pageName}</h3>
          <span className="text-sm text-muted-foreground" translate="no">/{page.path}</span>
        </div>
        <span className="flex flex-wrap gap-1.5">
          {page.restricted ? <Pill tone="outline">{t('pageProtected', { groups: groups.join(', ') || t('noGroup') })}</Pill> : <Pill tone="muted">{t('pagePublic')}</Pill>}
        </span>
      </div>
      {ids.length === 0 ? (
        <p className="text-[0.9375rem] text-muted-foreground">{t('pageEmpty')}</p>
      ) : (
        <ol className="flex flex-col gap-2" aria-label={t('pageListLabel', { page: pageName })}>
          {ids.map((id, n) => {
            const d = byId.get(id)
            if (!d) return null
            return (
              <Panel
                as="li"
                key={id}
                data-drag-key={id}
                padding="none"
                tone="muted"
                className={`relative flex items-start gap-1 p-1 ${drag.dragging === id ? 'opacity-50' : ''}`}
              >
                <DropLine edge={drag.edge(id)} />
                {canManage && ids.length > 1 ? (
                  <DragGrip
                    label={t('move', { title: d.title, position: n + 1, total: ids.length })}
                    drag={drag.gripProps(id)}
                    onMove={(dir) => move(id, dir)}
                    disabled={busy}
                  />
                ) : null}
                <div className={`flex min-w-0 flex-1 flex-col items-start gap-1 py-2 ${canManage && ids.length > 1 ? '' : 'pl-3'}`}>
                  <span className="text-[0.9375rem] font-medium break-words text-foreground">{d.title}</span>
                  <span className="text-sm text-muted-foreground">{d.visibility === 'everyone' ? t('everyone') : d.groupIds.map((g) => groupName.get(g.toLowerCase()) ?? t('unknownGroup')).join(', ')}</span>
                </div>
                {canManage ? (
                  <CardMenu
                    label={t('menuFor', { title: d.title })}
                    items={[
                      { key: 'open', label: t('openDocument'), href: `/${projectSlug}/document-library/${d.id}`, onSelect: () => undefined },
                      { key: 'remove', label: t('removeFromPage'), onSelect: () => void remove(d), destructive: true, separated: true },
                    ]}
                  />
                ) : null}
              </Panel>
            )
          })}
        </ol>
      )}
    </Panel>
  )
}
