'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { Button } from '@/components/app/ui/Button'
import { DragGrip } from '@/components/app/ui/DragGrip'
import { dropEdgeClass, dropIndex, usePointerDrag } from '@/components/app/ui/use-pointer-drag'
import { TextInput } from '@/components/app/ui/TextInput'
import { FieldError } from '@/components/app/ui/FieldLabel'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { CellText, Pill } from '@/components/app/ui/list/cells'
import { searchText } from '@/lib/client/search-text'
import { languageName } from '@/components/client/create/StepHeading'
import { createTaxonomyTermAction, reorderTaxonomyTermsAction } from '@/app/[locale]/(client)/[tenant]/taxonomy/actions'
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
  upsertTerm,
  type RowView,
  type TermsFilter,
} from './taxonomy-view'

/**
 * One section of a module tab in Categories & Tags: its heading with a count,
 * its own "+ Add …" (one line), its list (table on computers, rows on phones)
 * in the order people chose, and its own empty state. The search and the
 * missing-translations filter belong to the tab and arrive as props. The ⋮⋮
 * grip (drag, or arrow keys) shows only while the whole list is in view.
 */

export type SectionKind = 'category' | 'tag'

export function TermSection({
  projectSlug,
  moduleId,
  kind,
  list,
  setList,
  failed,
  query,
  filter,
  say,
  sayError,
}: {
  projectSlug: string
  moduleId: string
  kind: SectionKind
  /** Undefined while it loads. */
  list: TermList | undefined
  setList: Dispatch<SetStateAction<TermList | undefined>>
  failed: boolean
  query: string
  filter: TermsFilter
  say: (message: string) => void
  sayError: (code: string | undefined) => void
}) {
  const t = useTranslations('clientDashboard.taxonomy')
  const ui = useLocale()
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [addText, setAddText] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [reordering, setReordering] = useState(false)
  const scope = { projectSlug, module: moduleId, kind }
  const headingId = `taxonomy-${moduleId}-${kind}`

  const keysNow = () => (list ? list.terms.map((x) => x.key) : [])
  const drag = usePointerDrag((key, over) => {
    const to = dropIndex(keysNow(), key, over)
    if (to !== null) void reorder(moveKeyTo(keysNow(), key, to))
  })

  const modify = (fn: (l: TermList) => TermList) => setList((l) => (l ? fn(l) : l))

  async function add() {
    if (!list) return
    const text = cleanText(addText)
    if (!text) return setAddError(t('errors.label_required'))
    setAddBusy(true)
    setAddError(null)
    const r = await createTaxonomyTermAction({ ...scope, labels: { [list.defaultLocale]: text } })
    setAddBusy(false)
    if (!r.ok) return setAddError(t(`errors.${errorKey(r.error)}` as 'errors.failed'))
    setAddText('')
    if (!r.created) say(t(`${kind}.exists`))
    modify((l) => upsertTerm(l, r.term))
  }

  async function reorder(keys: string[] | null) {
    if (!keys || reordering || !list) return
    const before = list
    setReordering(true)
    modify((l) => reorderLocally(l, keys))
    const r = await reorderTaxonomyTermsAction({ ...scope, keys })
    setReordering(false)
    if (r.ok) modify((l) => applyOrder(l, r.order))
    else {
      setList(before)
      sayError(r.error)
    }
  }

  if (!list) {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        <h2 id={headingId} className="text-[1.0625rem] leading-6 font-semibold">
          {t(`${kind}.tab`)}
        </h2>
        <p className="text-[0.9375rem] text-muted-foreground" role="status">
          {failed ? t('errors.failed') : t('loading')}
        </p>
      </section>
    )
  }

  const canWrite = list.canWrite
  const translations = hasTranslations(list)
  const q = searchText(query)
  const rows = buildRows(list, filter).filter((r) => !q || searchText(Object.values(list.terms.find((x) => x.key === r.key)?.label ?? {}).join(' ')).includes(q))
  const fullList = filter === 'all' && !q
  const canMove = canWrite && fullList && rows.length > 1
  const openTerm = list.terms.find((x) => x.key === openKey) ?? null

  const addControl = !canWrite ? null : adding ? (
    <form
      className="flex flex-wrap items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void add()
      }}
    >
      <div className="min-w-0 flex-1 basis-56">
        <label className="sr-only" htmlFor={`${headingId}-add`}>
          {t(`${kind}.placeholder`)}
        </label>
        <TextInput
          flush
          controlSize="md"
          id={`${headingId}-add`}
          value={addText}
          maxLength={80}
          autoFocus
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
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
      {t(`${kind}.add`)}
    </Button>
  )

  const gripFor = (row: RowView, n: number) => (
    <DragGrip
      label={t('drag', { name: row.name, position: n + 1, total: rows.length })}
      drag={drag.gripProps(row.key)}
      onMove={(dir) => {
        void reorder(moveKey(keysNow(), row.key, dir))
      }}
      disabled={reordering}
    />
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

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="flex items-baseline gap-2 text-[1.0625rem] leading-6 font-semibold">
          {t(`${kind}.tab`)}
          <span className="text-sm font-normal text-muted-foreground">{fullList ? list.terms.length : t('shownOf', { shown: rows.length, total: list.terms.length })}</span>
        </h2>
        {list.terms.length > 0 && !adding ? addControl : null}
      </div>
      {adding && list.terms.length > 0 ? addControl : null}

      {list.terms.length === 0 ? (
        <EmptyState titleAs="h3" title={t(`${kind}.emptyTitle`)} body={t(`${kind}.emptyBody`)} action={addControl} />
      ) : rows.length === 0 ? (
        <p className="text-[0.9375rem] text-muted-foreground">{q ? t('noMatch') : t('nothingMissing')}</p>
      ) : (
        <>
          {/* Computers: a table. */}
          <div className="hidden md:block">
            <DataTable label={t(`${kind}.tab`)} rows={rows} columns={columns} rowKey={(r) => r.key} onRowClick={(r) => setOpenKey(r.key)} minWidth="min-w-[40rem]" rowProps={(r) => rowAttrs(r.key)} />
          </div>
          {/* Phones: rows. */}
          <ul className="flex flex-col gap-2 md:hidden" aria-label={t(`${kind}.tab`)}>
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

      <TermSheet
        term={openTerm}
        meta={list}
        projectSlug={projectSlug}
        onClose={() => setOpenKey(null)}
        onChanged={(term) => modify((l) => upsertTerm(l, term))}
        onDeleted={(key) => {
          modify((l) => removeTerm(l, key))
          setOpenKey(null)
          say(t(`${kind}.deleted`))
        }}
      />
    </section>
  )
}
