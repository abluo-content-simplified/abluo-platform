'use client'

import { useCallback, useId, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { ButtonLink } from '@/components/app/ui/Button'
import { EmptyState } from '@/components/app/ui/EmptyState'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar } from '@/components/app/ui/ListToolbar'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Tabs, tabPanelProps } from '@/components/app/ui/Tabs'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { CellChips, CellPill, CellText, LocalDate, Pill } from '@/components/app/ui/list/cells'
import type { DocumentsDashboardData, DocumentView } from '@/lib/access/documents-dashboard'
import { useLanguageName } from '@/components/client/access/access-bits'
import { DocumentPagesRecap } from './DocumentPagesRecap'

type Ready = Extract<DocumentsDashboardData, { notReady: false }>
type Who = 'all' | 'everyone' | 'groups'
type Status = 'active' | 'archived' | 'all'

/**
 * Documents (ADR-040 §15, R9) — a Records list (ListToolbar + DataTable on
 * computers + ListRow on phones): every document with who can open it, its
 * languages and the pages it shows on. Opening one edits it; "Add document"
 * is the primary action. The Pages tab is a read-only recap of the pages that
 * can show documents, where the order on each page is set.
 */
export function DocumentsBrowser({
  projectSlug,
  data,
  canManage,
  supportVisit = false,
  initialTab,
}: {
  projectSlug: string
  data: DocumentsDashboardData
  canManage: boolean
  supportVisit?: boolean
  initialTab: 'documents' | 'pages'
}) {
  const t = useTranslations('clientDashboard.documents')
  const router = useRouter()
  const idBase = useId()
  const { toast, show } = useUndo()
  const [tab, setTab] = useState<'documents' | 'pages'>(initialTab)

  const done = useCallback((message: string) => { show({ message, tone: 'status' }); router.refresh() }, [router, show])
  const fail = useCallback((message: string) => show({ message, tone: 'error' }), [show])

  const addAction = canManage && !data.notReady ? <ButtonLink variant="primary" href={`/${projectSlug}/document-library/new`}>{t('add')}</ButtonLink> : null

  if (data.notReady) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('title')} />
        <p className="max-w-2xl text-[0.9375rem] leading-6 text-muted-foreground">{t('intro')}</p>
        <Notice tone="info" title={t('notReady.title')}>{t('notReady.body')}</Notice>
      </div>
    )
  }

  const changeTab = (next: string) => {
    setTab(next as 'documents' | 'pages')
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', next)
      window.history.replaceState(window.history.state, '', url)
    } catch {
      /* remembering the tab is a convenience */
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} actions={addAction} />
      <p className="max-w-2xl text-[0.9375rem] leading-6 text-muted-foreground">{t('intro')}</p>
      {!canManage ? <Notice tone="info">{supportVisit ? t('supportReadOnly') : t('readOnly')}</Notice> : null}
      {data.pages.length === 0 ? <Notice tone="info" title={t('noPages.title')}>{t('noPages.body')}</Notice> : null}

      <Tabs
        label={t('tabsLabel')}
        idBase={idBase}
        value={tab}
        onChange={changeTab}
        items={[
          { id: 'documents', label: t('tabs.documents'), count: data.documents.filter((d) => !d.archived).length },
          { id: 'pages', label: t('tabs.pages'), count: data.pages.length },
        ]}
      />
      <div {...tabPanelProps(idBase, tab)}>
        {tab === 'documents' ? (
          <DocumentsList projectSlug={projectSlug} data={data} canManage={canManage} />
        ) : (
          <DocumentPagesRecap projectSlug={projectSlug} data={data} canManage={canManage} onDone={done} onFail={fail} />
        )}
      </div>
      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </div>
  )
}

function DocumentsList({ projectSlug, data, canManage }: { projectSlug: string; data: Ready; canManage: boolean }) {
  const t = useTranslations('clientDashboard.documents')
  const locale = useLocale()
  const lang = useLanguageName()
  const [q, setQ] = useState('')
  const [who, setWho] = useState<Who>('all')
  const [status, setStatus] = useState<Status>('active')
  const [category, setCategory] = useState<string>('all')
  const d = data.site.defaultLocale
  const termName = (terms: Ready['categories'], key: string) => {
    const term = terms.find((x) => x.value === key)
    return term ? term.label[locale] ?? term.label[d] ?? Object.values(term.label)[0] ?? key : key
  }
  const categoryOf = (doc: DocumentView) => (doc.categoryKey ? termName(data.categories, doc.categoryKey) : null)
  const tagsOf = (doc: DocumentView) => doc.tagKeys.map((k) => termName(data.tags, k))

  const groupName = useMemo(() => new Map(data.groups.map((g) => [g.id, g.name])), [data.groups])
  const pageTitle = useMemo(() => new Map(data.pages.map((p) => [p.id, p.isHome ? t('homePage') : p.title])), [data.pages, t])

  const matches = (d: DocumentView, opts: { who?: Who; status?: Status; category?: string } = {}) => {
    const w = opts.who ?? who
    const s = opts.status ?? status
    const c = opts.category ?? category
    const needle = q.trim().toLowerCase()
    return (w === 'all' || d.visibility === w)
      && (s === 'all' || (s === 'archived') === d.archived)
      && (c === 'all' || (c === 'none' ? !d.categoryKey : d.categoryKey === c))
      && (!needle || `${d.title} ${Object.values(d.note ?? {}).join(' ')} ${categoryOf(d) ?? ''} ${tagsOf(d).join(' ')}`.toLowerCase().includes(needle))
  }
  const shown = data.documents.filter((d) => matches(d))
  const isDefault = !q && who === 'all' && status === 'active' && category === 'all'
  const hrefOf = (d: DocumentView) => `/${projectSlug}/document-library/${d.id}`

  const whoLabel = (d: DocumentView): string[] =>
    d.visibility === 'everyone' ? [t('everyone')] : d.groupIds.map((id) => groupName.get(id) ?? t('unknownGroup'))
  const languages = (d: DocumentView): string[] => {
    if (d.files.length === 0) return []
    if (data.site.locales.length > 1 && data.site.locales.every((l) => d.files.some((f) => f.locale === l))) return [t('allLanguages')]
    return d.files.map((f) => lang(f.locale))
  }
  const pagesOf = (d: DocumentView): string[] => d.pageIds.map((id) => pageTitle.get(id)).filter((x): x is string => Boolean(x))
  const statusPill = (d: DocumentView) =>
    d.archived ? <Pill tone="muted">{t('archived')}</Pill> : d.files.length === 0 ? <Pill tone="highlight">{t('noFileYet')}</Pill> : pagesOf(d).length === 0 ? <Pill tone="outline">{t('notShown')}</Pill> : null

  const columns: DataTableColumn<DocumentView>[] = [
    {
      key: 'title',
      header: t('columns.title'),
      width: 'min-w-64',
      render: (d) => <CellText primary={d.title} secondary={d.note?.[data.site.defaultLocale] ?? d.note?.[locale] ?? undefined} href={hrefOf(d)} clamp={2} />,
    },
    ...(data.categories.length > 0 ? [{ key: 'category', header: t('columns.category'), width: 'w-40', render: (d: DocumentView) => (categoryOf(d) ? <CellChips items={[categoryOf(d)!]} max={1} /> : <span className="text-sm text-muted-foreground">—</span>) }] : []),
    { key: 'who', header: t('columns.who'), width: 'w-48', render: (d) => <CellChips items={whoLabel(d)} max={2} /> },
    { key: 'languages', header: t('columns.languages'), width: 'w-44', render: (d) => <CellChips items={languages(d)} max={3} empty={t('none')} /> },
    { key: 'pages', header: t('columns.pages'), width: 'w-56', render: (d) => (pagesOf(d).length ? <CellChips items={pagesOf(d)} max={2} /> : <CellPill>{statusPill(d) ?? <Pill tone="outline">{t('notShown')}</Pill>}</CellPill>) },
    { key: 'added', header: t('columns.added'), width: 'w-32', className: 'whitespace-nowrap', render: (d) => <LocalDate iso={d.createdAt} className="text-sm leading-6 text-muted-foreground" /> },
  ]

  if (data.documents.length === 0) {
    return (
      <EmptyState
        title={t('emptyTitle')}
        body={t('emptyBody')}
        action={canManage ? <ButtonLink variant="primary" href={`/${projectSlug}/document-library/new`}>{t('add')}</ButtonLink> : undefined}
      />
    )
  }

  const chips: FilterChip[] = [
    ...(who !== 'all' ? [{ id: 'who', label: who === 'everyone' ? t('everyone') : t('membersOnly') }] : []),
    ...(status !== 'active' ? [{ id: 'status', label: status === 'archived' ? t('archived') : t('allStatuses') }] : []),
    ...(category !== 'all' ? [{ id: 'category', label: category === 'none' ? t('noCategory') : termName(data.categories, category) }] : []),
  ]
  const count = (opts: { who?: Who; status?: Status; category?: string }) => data.documents.filter((d) => matches(d, opts)).length

  return (
    <div className="flex flex-col gap-4">
      <ListToolbar
        label={t('filtersLabel')}
        search={{ value: q, onChange: setQ, label: t('searchLabel'), placeholder: t('search') }}
        filters={[
          ...(data.groupsAvailable ? [{
            key: 'who',
            label: t('whoFilter'),
            value: who,
            options: [
              { value: 'all', label: `${t('whoAll')} (${count({ who: 'all' })})` },
              { value: 'everyone', label: `${t('everyone')} (${count({ who: 'everyone' })})` },
              { value: 'groups', label: `${t('membersOnly')} (${count({ who: 'groups' })})` },
            ],
            onChange: (v: string) => setWho(v as Who),
          }] : []),
          ...(data.categories.length > 0 ? [{
            key: 'category',
            label: t('categoryFilter'),
            value: category,
            options: [
              { value: 'all', label: `${t('allCategories')} (${count({ category: 'all' })})` },
              ...data.categories.map((c) => ({ value: c.value, label: `${termName(data.categories, c.value)} (${count({ category: c.value })})` })),
              { value: 'none', label: `${t('noCategory')} (${count({ category: 'none' })})` },
            ],
            onChange: (v: string) => setCategory(v),
          }] : []),
          {
            key: 'status',
            label: t('statusFilter'),
            value: status,
            options: [
              { value: 'active', label: `${t('inUse')} (${count({ status: 'active' })})` },
              { value: 'archived', label: `${t('archived')} (${count({ status: 'archived' })})` },
              { value: 'all', label: `${t('allStatuses')} (${count({ status: 'all' })})` },
            ],
            onChange: (v: string) => setStatus(v as Status),
          },
        ]}
        summary={t('showing', { shown: shown.length, total: data.documents.length })}
        clear={{ label: t('clear'), onClear: () => { setQ(''); setWho('all'); setStatus('active'); setCategory('all') }, visible: !isDefault }}
        sheet={{ activeCount: chips.length, resultCount: shown.length, chips, onRemoveChip: (id) => (id === 'who' ? setWho('all') : id === 'category' ? setCategory('all') : setStatus('active')) }}
      />
      {shown.length === 0 ? (
        <Notice>{t('noMatch')}</Notice>
      ) : (
        <>
          <div className="hidden md:block">
            <DataTable rows={shown} columns={columns} rowKey={(d) => d.id} rowHref={hrefOf} label={t('title')} minWidth="min-w-[56rem]" />
          </div>
          <ul className="flex flex-col gap-3 md:hidden">
            {shown.map((d) => (
              <ListRow key={d.id} href={hrefOf(d)} label={t('open', { title: d.title })}>
                <span className="text-[0.9375rem] leading-6 font-semibold break-words text-foreground">{d.title}</span>
                <span className="flex flex-wrap items-start gap-1.5">
                  {whoLabel(d).map((w) => <Pill key={w} tone={d.visibility === 'everyone' ? 'muted' : 'outline'}>{w}</Pill>)}
                  {statusPill(d)}
                </span>
                <span className="text-xs leading-5 text-muted-foreground">{[categoryOf(d), languages(d).join(', '), pagesOf(d).join(', ')].filter(Boolean).join(' · ')}</span>
              </ListRow>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
