'use client'

import { useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { Tabs, tabPanelProps } from '@/components/app/ui/Tabs'
import { listTaxonomyTermsAction } from '@/app/[locale]/(client)/[tenant]/taxonomy/actions'
import type { TermList } from '@/lib/taxonomy/service'
import { InternalTagsPanel } from './InternalTagsPanel'
import { TermSection, type SectionKind } from './TermSection'
import { errorKey, hasTranslations, listKey, type TermsFilter } from './taxonomy-view'
import { searchText } from '@/lib/client/search-text'

/**
 * Client dashboard — Categories & Tags (ADR-033 Amendment J): one place to
 * keep the categories and tags of the site. Tabs along the top (shared `Tabs`),
 * one per module that has terms (Posts, Events, Catalogue …), then Media and
 * Galleries for the internal tags (not translated, drawn by `InternalTagsPanel`).
 * A module tab shows a "Categories" section and, when the module has tags, a
 * "Tags" section, each with its own list and its own add. The search and the
 * missing-translations filter belong to the tab. The tab lives in the address
 * (`?tab=`), so reload and Back keep it; a tab's lists load when it opens.
 * People who may only look get the same screen without any change controls.
 */

export type TaxonomyTab =
  | { type: 'terms'; id: string; label: string; kinds: SectionKind[]; canWrite: boolean }
  | { type: 'internal'; id: 'media' | 'galleries'; label: string; canWrite: boolean }

export function TaxonomyManager({ projectSlug, tabs, activeId, initialLists }: { projectSlug: string; tabs: TaxonomyTab[]; activeId: string; initialLists: Record<string, TermList> }) {
  const t = useTranslations('clientDashboard.taxonomy')
  const idBase = useId()
  const pathname = usePathname()
  const params = useSearchParams()
  const [lists, setLists] = useState<Record<string, TermList>>(initialLists)
  const [failed, setFailed] = useState<Record<string, true>>({})
  const [filter, setFilter] = useState<TermsFilter>('all')
  const [query, setQuery] = useState('')
  const asked = useRef(new Set(Object.keys(initialLists)))
  const { toast, show } = useUndo()

  const wanted = params.get('tab') ?? params.get('module')
  const active = tabs.find((x) => x.id === wanted) ?? tabs.find((x) => x.id === activeId) ?? tabs[0]

  const say = (message: string, tone: 'status' | 'error' = 'status') => show({ message, tone }, tone === 'error' ? 6000 : 3500)
  const sayError = (code: string | undefined) => say(t(`errors.${errorKey(code)}` as 'errors.failed'), 'error')

  // A tab's lists load when it opens (each module and kind once).
  const activeKey = active.id
  useEffect(() => {
    if (active.type !== 'terms') return
    for (const kind of active.kinds) {
      const key = listKey(active.id, kind)
      if (asked.current.has(key)) continue
      asked.current.add(key)
      void listTaxonomyTermsAction({ projectSlug, module: active.id, kind }).then((r) => {
        if (r.ok) setLists((all) => ({ ...all, [key]: r.list }))
        else {
          asked.current.delete(key)
          setFailed((f) => ({ ...f, [key]: true }))
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey])

  function open(id: string) {
    if (id === active.id) return
    setQuery('')
    setFilter('all')
    const next = new URLSearchParams(params.toString())
    next.delete('module')
    next.delete('kind')
    next.set('tab', id)
    window.history.pushState(null, '', `${pathname}?${next.toString()}`)
  }

  const setterFor = (key: string): Dispatch<SetStateAction<TermList | undefined>> => (action) =>
    setLists((all) => {
      const value = typeof action === 'function' ? action(all[key]) : action
      return value ? { ...all, [key]: value } : all
    })

  const tabLists = active.type === 'terms' ? active.kinds.map((k) => lists[listKey(active.id, k)]).filter((l): l is TermList => !!l) : []
  // The filter only makes sense while something in this tab still waits for a translation.
  const anyMissing = tabLists.some((l) => hasTranslations(l) && l.terms.some((x) => !x.coverage.isComplete))
  const effectiveFilter: TermsFilter = anyMissing ? filter : 'all'
  const q = searchText(query)
  const fullList = effectiveFilter === 'all' && !q
  const toolbarFilters: ListToolbarFilter[] = anyMissing
    ? [
        {
          key: 'translations',
          label: t('filterLabel'),
          value: effectiveFilter,
          options: [
            { value: 'all', label: t('filterAll') },
            { value: 'missing', label: t('filterMissing') },
          ],
          onChange: (v: string) => setFilter(v as TermsFilter),
        },
      ]
    : []
  const chips: FilterChip[] = effectiveFilter === 'missing' ? [{ id: 'translations', label: t('filterMissing') }] : []
  const searchLabel = active.type === 'terms' ? (active.kinds.length > 1 ? t('searchAll') : t(`${active.kinds[0]}.search`)) : ''
  const reset = () => (setQuery(''), setFilter('all'))
  const matches = active.type === 'terms' ? active.kinds.reduce((n, k) => n + (lists[listKey(active.id, k)]?.terms.length ?? 0), 0) : 0

  return (
    <>
      <PageHeader title={t('title')} />

      {tabs.length > 1 ? <Tabs label={t('tabsLabel')} idBase={idBase} value={active.id} onChange={open} items={tabs.map((x) => ({ id: x.id, label: x.label }))} /> : null}

      <div {...(tabs.length > 1 ? tabPanelProps(idBase, active.id) : {})} className="flex flex-col gap-6">
        {active.type === 'internal' ? (
          <InternalTagsPanel projectSlug={projectSlug} scope={active.id} canWrite={active.canWrite} />
        ) : (
          <>
            {!active.canWrite ? <p className="text-sm text-muted-foreground">{t('readOnly')}</p> : null}
            {matches > 0 ? (
              <ListToolbar
                label={active.label}
                search={{ value: query, onChange: setQuery, placeholder: searchLabel, label: searchLabel }}
                filters={toolbarFilters}
                summary={null}
                clear={{ label: t('clear'), onClear: reset, visible: !fullList }}
                sheet={{ activeCount: chips.length, resultCount: matches, chips, onRemoveChip: () => setFilter('all') }}
              />
            ) : null}
            {active.kinds.map((kind) => {
              const key = listKey(active.id, kind)
              return (
                <TermSection
                  key={`${active.id}:${kind}`}
                  projectSlug={projectSlug}
                  moduleId={active.id}
                  kind={kind}
                  list={lists[key]}
                  setList={setterFor(key)}
                  failed={!!failed[key]}
                  query={query}
                  filter={effectiveFilter}
                  say={say}
                  sayError={sayError}
                />
              )
            })}
          </>
        )}
      </div>
      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </>
  )
}
