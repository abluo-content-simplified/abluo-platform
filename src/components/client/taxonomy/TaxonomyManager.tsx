'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { Button, IconButton } from '@/components/app/ui/Button'
import { TextInput } from '@/components/app/ui/TextInput'
import { FieldError } from '@/components/app/ui/FieldLabel'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { CellText, Pill } from '@/components/app/ui/list/cells'
import { searchText } from '@/lib/client/search-text'
import { languageName } from '@/components/client/create/StepHeading'
import {
  createTaxonomyTermAction,
  listTaxonomyTermsAction,
  reorderTaxonomyTermsAction,
} from '@/app/[locale]/(client)/[tenant]/taxonomy/actions'
import type { TermList } from '@/lib/taxonomy/service'
import { TermSheet } from './TermSheet'
import {
  applyOrder,
  buildRows,
  cleanText,
  errorKey,
  hasTranslations,
  moveKey,
  removeTerm,
  reorderLocally,
  summarize,
  upsertTerm,
  type RowView,
  type TermsFilter,
} from './taxonomy-view'

/**
 * Client dashboard — Categories & Tags (ADR-033 Amendment J, slice 4): one
 * place to keep the categories (and tags) of every module that has them. A
 * "records" list screen: the shared toolbar (search, module, kind, missing
 * translations), a table on computers and rows on phones, in the order people
 * chose, with how many items use each one and, per language of the website,
 * whether the name is translated. Adding is one line; a row opens a sheet to
 * rename, translate and delete. Moving up / down shows while the whole list is
 * in view (no search or filter). People who may only look get the same screen
 * without any change controls.
 */

export type ModuleOption = { id: string; label: string; kinds: string[] }
type Kind = 'category' | 'tag'

const svg = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)

export function TaxonomyManager({ projectSlug, modules, initial }: { projectSlug: string; modules: ModuleOption[]; initial: TermList }) {
  const t = useTranslations('clientDashboard.taxonomy')
  const ui = useLocale()
  const [moduleId, setModuleId] = useState(initial.module)
  const [kind, setKind] = useState<Kind>(initial.kind)
  const [list, setList] = useState<TermList>(initial)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<TermsFilter>('all')
  const [query, setQuery] = useState('')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [addText, setAddText] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [reordering, setReordering] = useState(false)
  const { toast, show } = useUndo()

  const current = modules.find((m) => m.id === moduleId) ?? modules[0]
  const kinds = current.kinds as Kind[]
  const scope = { projectSlug, module: moduleId, kind }
  const canWrite = list.canWrite
  const translations = hasTranslations(list)
  const q = searchText(query)
  const rows = buildRows(list, filter).filter((r) => !q || searchText(Object.values(list.terms.find((x) => x.key === r.key)?.label ?? {}).join(' ')).includes(q))
  const fullList = filter === 'all' && !q
  const canMove = canWrite && fullList && rows.length > 1
  const summary = summarize(list.terms)
  const openTerm = list.terms.find((x) => x.key === openKey) ?? null

  const say = (message: string, tone: 'status' | 'error' = 'status') => show({ message, tone }, tone === 'error' ? 6000 : 3500)
  const sayError = (code: string | undefined) => say(t(`errors.${errorKey(code)}` as 'errors.failed'), 'error')

  async function load(nextModule: string, nextKind: Kind) {
    setLoading(true)
    setOpenKey(null)
    setFilter('all')
    setQuery('')
    setAdding(false)
    const r = await listTaxonomyTermsAction({ projectSlug, module: nextModule, kind: nextKind })
    setLoading(false)
    if (!r.ok) return sayError(r.error)
    setModuleId(nextModule)
    setKind(nextKind)
    setList(r.list)
  }

  async function add() {
    const text = cleanText(addText)
    if (!text) return setAddError(t('errors.label_required'))
    setAddBusy(true)
    setAddError(null)
    const r = await createTaxonomyTermAction({ ...scope, labels: { [list.defaultLocale]: text } })
    setAddBusy(false)
    if (!r.ok) return setAddError(t(`errors.${errorKey(r.error)}` as 'errors.failed'))
    setList((l) => upsertTerm(l, r.term))
    setAddText('')
    if (!r.created) say(t(`${kind}.exists`))
  }

  async function move(key: string, direction: -1 | 1) {
    const keys = moveKey(list.terms.map((x) => x.key), key, direction)
    if (!keys) return
    const before = list
    setReordering(true)
    setList((l) => reorderLocally(l, keys))
    const r = await reorderTaxonomyTermsAction({ ...scope, keys })
    setReordering(false)
    if (r.ok) setList((l) => applyOrder(l, r.order))
    else {
      setList(before)
      sayError(r.error)
    }
  }

  const addControl = !canWrite ? null : adding ? (
    <form
      className="flex flex-wrap items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void add()
      }}
    >
      <div className="min-w-0 flex-1 basis-56">
        <label className="sr-only" htmlFor="taxonomy-add">
          {t(`${kind}.placeholder`)}
        </label>
        <TextInput
          flush
          controlSize="md"
          id="taxonomy-add"
          value={addText}
          maxLength={80}
          autoFocus={adding}
          placeholder={t(`${kind}.placeholder`)}
          aria-invalid={addError ? true : undefined}
          onChange={(e) => {
            setAddText(e.target.value)
            setAddError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setAdding(false)
          }}
        />
        <FieldError>{addError}</FieldError>
      </div>
      <Button variant="primary" type="submit" disabled={addBusy || !addText.trim()}>
        {addBusy ? t('adding') : t('addSubmit')}
      </Button>
      <Button
        variant="quiet"
        onClick={() => {
          setAdding(false)
          setAddText('')
          setAddError(null)
        }}
      >
        {t('cancel')}
      </Button>
    </form>
  ) : (
    <Button variant="primary" onClick={() => setAdding(true)}>
      {svg('M12 5v14M5 12h14')}
      {t(`${kind}.add`)}
    </Button>
  )

  const moveButtons = (row: RowView, n: number) => (
    <>
      <IconButton aria-label={t('moveUp', { name: row.name })} disabled={reordering || n === 0} onClick={() => void move(row.key, -1)}>
        {svg('m6 15 6-6 6 6')}
      </IconButton>
      <IconButton aria-label={t('moveDown', { name: row.name })} disabled={reordering || n === rows.length - 1} onClick={() => void move(row.key, 1)}>
        {svg('m6 9 6 6 6-6')}
      </IconButton>
    </>
  )
  const languageChips = (row: RowView) => (
    <span className="flex flex-wrap gap-1.5">
      {row.chips.map((c) => (
        <Pill
          key={c.locale}
          tone={c.complete ? 'muted' : 'highlight'}
          icon={
            c.complete ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-success">
                <path d="m5 12 5 5L20 7" />
              </svg>
            ) : undefined
          }
        >
          <span className="sr-only">{t(c.complete ? 'chipDone' : 'chipMissingLabel', { language: languageName(c.locale, ui) })}</span>
          <span aria-hidden="true">{c.complete ? c.code : t('chipMissing', { code: c.code })}</span>
        </Pill>
      ))}
    </span>
  )
  const columns: DataTableColumn<RowView>[] = [
    { key: 'name', header: t('name'), width: 'min-w-56', render: (r) => <CellText primary={r.name} onOpen={() => setOpenKey(r.key)} clamp={1} /> },
    { key: 'usedBy', header: t('columns.usedBy'), width: 'w-36', render: (r) => <span className="flex min-h-6 items-center text-sm leading-6 text-muted-foreground">{r.usedBy > 0 ? t('usedBy', { count: r.usedBy }) : t('notUsed')}</span> },
    ...(translations ? [{ key: 'languages', header: t('columns.languages'), width: 'w-56', render: (r: RowView) => languageChips(r) }] : []),
    ...(canWrite
      ? [
          {
            key: 'order',
            header: <span className="sr-only">{t('columns.order')}</span>,
            width: 'w-28',
            // Always present (no layout jump); the buttons show only while the whole list is in view.
            render: (r: RowView) => (canMove ? <span className="-my-2.5 flex items-center">{moveButtons(r, rows.indexOf(r))}</span> : null),
          },
        ]
      : []),
  ]
  const toolbarFilters: ListToolbarFilter[] = [
    ...(modules.length > 1
      ? [
          {
            key: 'module',
            label: t('module'),
            value: moduleId,
            options: modules.map((m) => ({ value: m.id, label: m.label })),
            onChange: (id: string) => {
              const next = modules.find((m) => m.id === id)
              if (next) void load(id, (next.kinds.includes(kind) ? kind : next.kinds[0]) as Kind)
            },
          },
        ]
      : []),
    ...(kinds.length > 1
      ? [{ key: 'kind', label: t('kindLabel'), value: kind, options: kinds.map((k) => ({ value: k, label: t(`${k}.tab`) })), onChange: (k: string) => void load(moduleId, k as Kind) }]
      : []),
    ...(translations
      ? [
          {
            key: 'translations',
            label: t('filterMissing'),
            value: filter,
            options: [
              { value: 'all', label: t('filterAll') },
              { value: 'missing', label: t('filterMissing') },
            ],
            onChange: (v: string) => setFilter(v as TermsFilter),
          },
        ]
      : []),
  ]
  const chips: FilterChip[] = filter === 'missing' ? [{ id: 'translations', label: t('filterMissing') }] : []

  return (
    <>
      <PageHeader title={t('title')} actions={list.terms.length > 0 && !adding ? addControl : null} />

      {modules.length === 1 ? <p className="-mt-2 text-[0.9375rem] text-muted-foreground">{current.label}</p> : null}
      {!canWrite ? <p className="text-sm text-muted-foreground">{t('readOnly')}</p> : null}

      {adding && list.terms.length > 0 ? addControl : null}

      <ListToolbar
        label={t('title')}
        search={{ value: query, onChange: setQuery, placeholder: t(`${kind}.search`), label: t(`${kind}.search`) }}
        filters={toolbarFilters}
        summary={t(`${kind}.count`, { shown: rows.length, total: list.terms.length })}
        summaryExtra={
          translations && list.terms.length > 0 ? (
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {summary.needTranslation > 0 ? t('summary', { count: summary.needTranslation, total: summary.total }) : t('allTranslated')}
            </span>
          ) : null
        }
        clear={{ label: t('clear'), onClear: () => (setQuery(''), setFilter('all')), visible: !fullList }}
        sheet={{ activeCount: chips.length, resultCount: rows.length, chips, onRemoveChip: () => setFilter('all') }}
      />

      {loading ? (
        <p className="text-[0.9375rem] text-muted-foreground" role="status">
          {t('loading')}
        </p>
      ) : list.terms.length === 0 ? (
        <EmptyState title={t(`${kind}.emptyTitle`)} body={t(`${kind}.emptyBody`)} action={addControl} />
      ) : rows.length === 0 ? (
        <EmptyState
          titleAs="p"
          title={q ? t('noMatch') : t('nothingMissing')}
          action={<Button onClick={() => (setQuery(''), setFilter('all'))}>{t('clear')}</Button>}
        />
      ) : (
        <>
          {/* Computers: a table. */}
          <div className="hidden md:block">
            <DataTable label={t('title')} rows={rows} columns={columns} rowKey={(r) => r.key} onRowClick={(r) => setOpenKey(r.key)} minWidth="min-w-[40rem]" />
          </div>
          {/* Phones: rows. */}
          <ul className="flex flex-col gap-2 md:hidden" aria-label={t('title')}>
            {rows.map((row, n) => (
              <ListRow key={row.key} onOpen={() => setOpenKey(row.key)} trailing={canMove ? moveButtons(row, n) : undefined}>
                <span className="block max-w-full truncate text-[0.9375rem] leading-6 font-semibold text-foreground">{row.name}</span>
                <span className="text-sm text-muted-foreground">{row.usedBy > 0 ? t('usedBy', { count: row.usedBy }) : t('notUsed')}</span>
                {translations ? languageChips(row) : null}
              </ListRow>
            ))}
          </ul>
        </>
      )}

      <TermSheet
        term={openTerm}
        meta={list}
        projectSlug={projectSlug}
        onClose={() => setOpenKey(null)}
        onChanged={(term) => setList((l) => upsertTerm(l, term))}
        onDeleted={(key) => {
          setList((l) => removeTerm(l, key))
          setOpenKey(null)
          say(t(`${kind}.deleted`))
        }}
      />
      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </>
  )
}
