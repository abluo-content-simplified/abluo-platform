'use client'

import { useId, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { Button } from '@/components/app/ui/Button'
import { DragGrip } from '@/components/app/ui/DragGrip'
import { Select } from '@/components/app/ui/Select'
import { Tabs, tabPanelProps } from '@/components/app/ui/Tabs'
import { dropEdgeClass, dropIndex, usePointerDrag } from '@/components/app/ui/use-pointer-drag'
import { TextInput } from '@/components/app/ui/TextInput'
import { FieldError, FieldLabel } from '@/components/app/ui/FieldLabel'
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
  moveKeyTo,
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
 * "records" list screen: a module choice under the title (only when there is
 * more than one), Categories | Tags tabs (only when the module has both), the
 * shared toolbar (search, missing translations), a table on computers and rows
 * on phones, in the order people chose, with how many items use each one and,
 * per language of the website, whether the name is translated. Adding is one
 * line, into any module the person may change; a row opens a sheet to rename,
 * translate and delete. The ⋮⋮ grip (drag, or arrow keys) shows while the whole
 * list is in view (no search or filter). People who may only look get the same screen
 * without any change controls.
 */

export type ModuleOption = { id: string; label: string; kinds: string[]; canWrite: boolean }
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
  const [addModule, setAddModule] = useState<string | null>(null)
  const idBase = useId()
  const { toast, show } = useUndo()

  const current = modules.find((m) => m.id === moduleId) ?? modules[0]
  const kinds = current.kinds as Kind[]
  const scope = { projectSlug, module: moduleId, kind }
  const canWrite = list.canWrite
  const writable = modules.filter((m) => m.canWrite)
  const canAdd = writable.length > 0
  const addTarget = writable.find((m) => m.id === (addModule ?? moduleId)) ?? writable[0] ?? current
  const addKind = (addTarget.kinds.includes(kind) ? kind : addTarget.kinds[0]) as Kind
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
    const elsewhere = addTarget.id !== moduleId || addKind !== kind
    const r = await createTaxonomyTermAction({ projectSlug, module: addTarget.id, kind: addKind, labels: { [list.defaultLocale]: text } })
    setAddBusy(false)
    if (!r.ok) return setAddError(t(`errors.${errorKey(r.error)}` as 'errors.failed'))
    setAddText('')
    setAddModule(null)
    if (!r.created) say(t(`${addKind}.exists`))
    if (elsewhere) {
      // Show the person where it went: that module and kind, with the new one in the list.
      setAdding(false)
      await load(addTarget.id, addKind)
    } else setList((l) => upsertTerm(l, r.term))
  }

  const keysNow = () => list.terms.map((x) => x.key)
  const moveBy = (key: string, direction: -1 | 1) => void reorder(moveKey(keysNow(), key, direction))
  const drag = usePointerDrag((key, over) => {
    const to = dropIndex(keysNow(), key, over)
    if (to !== null) void reorder(moveKeyTo(keysNow(), key, to))
  })

  async function reorder(keys: string[] | null) {
    if (!keys || reordering) return
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

  const addControl = !canAdd ? null : adding ? (
    <form
      className="flex flex-wrap items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void add()
      }}
    >
      {writable.length > 1 ? (
        <div className="basis-44">
          <label className="sr-only" htmlFor="taxonomy-add-module">
            {t('addTo')}
          </label>
          <Select
            flush
            controlSize="md"
            id="taxonomy-add-module"
            value={addTarget.id}
            onChange={(e) => {
              setAddModule(e.target.value)
              setAddError(null)
            }}
          >
            {writable.map((m) => (
              <option key={m.id} value={m.id}>
                {t('addTo')} {m.label}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <div className="min-w-0 flex-1 basis-56">
        <label className="sr-only" htmlFor="taxonomy-add">
          {t(`${addKind}.placeholder`)}
        </label>
        <TextInput
          flush
          controlSize="md"
          id="taxonomy-add"
          value={addText}
          maxLength={80}
          autoFocus={adding}
          placeholder={t(`${addKind}.placeholder`)}
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
          setAddModule(null)
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

  const gripFor = (row: RowView, n: number) => (
    <DragGrip label={t('drag', { name: row.name, position: n + 1, total: rows.length })} drag={drag.gripProps(row.key)} onMove={(dir) => moveBy(row.key, dir)} disabled={reordering} />
  )
  const rowAttrs = (key: string) => ({ ...drag.rowProps(key), className: `${dropEdgeClass(drag.edge(key))} ${drag.dragging === key ? 'opacity-50' : ''}` })
  const languageChips = (row: RowView) => (
    <span className="flex flex-nowrap gap-1.5 whitespace-nowrap">
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
    ...(translations ? [{ key: 'languages', header: t('columns.languages'), className: 'whitespace-nowrap', render: (r: RowView) => languageChips(r) }] : []),
    ...(canWrite
      ? [
          {
            key: 'order',
            header: <span className="sr-only">{t('columns.order')}</span>,
            width: 'w-14',
            // Always present (no layout jump); the grip shows only while the whole list is in view.
            render: (r: RowView) => (canMove ? <span className="-my-2.5 flex items-center">{gripFor(r, rows.indexOf(r))}</span> : null),
          },
        ]
      : []),
  ]
  const toolbarFilters: ListToolbarFilter[] = [
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
      {modules.length > 1 ? (
        <div className="max-w-xs">
          <FieldLabel htmlFor="taxonomy-module">{t('module')}</FieldLabel>
          <Select
            id="taxonomy-module"
            controlSize="md"
            value={moduleId}
            disabled={loading}
            onChange={(e) => {
              const next = modules.find((m) => m.id === e.target.value)
              if (next) void load(next.id, (next.kinds.includes(kind) ? kind : next.kinds[0]) as Kind)
            }}
          >
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {kinds.length > 1 ? <Tabs label={t('kindLabel')} idBase={idBase} value={kind} onChange={(k) => void load(moduleId, k as Kind)} items={kinds.map((k) => ({ id: k, label: t(`${k}.tab`) }))} /> : null}
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

      <div {...(kinds.length > 1 ? tabPanelProps(idBase, kind) : {})} className="space-y-5">
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
            <DataTable label={t('title')} rows={rows} columns={columns} rowKey={(r) => r.key} onRowClick={(r) => setOpenKey(r.key)} minWidth="min-w-[40rem]" rowProps={(r) => rowAttrs(r.key)} />
          </div>
          {/* Phones: rows. */}
          <ul className="flex flex-col gap-2 md:hidden" aria-label={t('title')}>
            {rows.map((row, n) => (
              <ListRow key={row.key} onOpen={() => setOpenKey(row.key)} trailing={canMove ? gripFor(row, n) : undefined} rowProps={rowAttrs(row.key)}>
                <span className="block max-w-full truncate text-[0.9375rem] leading-6 font-semibold text-foreground">{row.name}</span>
                <span className="text-sm text-muted-foreground">{row.usedBy > 0 ? t('usedBy', { count: row.usedBy }) : t('notUsed')}</span>
                {translations ? languageChips(row) : null}
              </ListRow>
            ))}
          </ul>
        </>
      )}
      </div>

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
