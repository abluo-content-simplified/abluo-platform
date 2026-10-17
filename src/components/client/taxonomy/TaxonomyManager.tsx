'use client'

import { useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { FilterBar, FilterSegmented, FilterSelect } from '@/components/app/ui/FilterBar'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Toast } from '@/components/app/ui/Toast'
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
  type TermsFilter,
} from './taxonomy-view'

/**
 * Client dashboard — Categories & Tags (ADR-033 Amendment J, slice 4): one
 * place to keep the categories (and tags) of every module that has them. A
 * list in the order people chose, with how many items use each one and, per
 * language of the website, whether the name is translated. Adding is one line;
 * a row opens a sheet to rename, translate and delete. People who may only
 * look get the same screen without any change controls.
 */

export type ModuleOption = { id: string; label: string; kinds: string[] }
type Kind = 'category' | 'tag'

const ICON_BTN =
  'grid size-11 shrink-0 place-items-center rounded-xl text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-30 disabled:hover:bg-transparent'
const PRIMARY_BTN =
  'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-action px-4 text-[0.9375rem] font-semibold text-action-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-40'
const QUIET_BTN =
  'inline-flex h-11 shrink-0 items-center justify-center rounded-xl px-4 text-[0.9375rem] font-medium text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
const INPUT =
  'h-11 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

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
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [addText, setAddText] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [reordering, setReordering] = useState(false)
  const [toast, setToast] = useState<{ message: string; tone: 'status' | 'error' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const current = modules.find((m) => m.id === moduleId) ?? modules[0]
  const kinds = current.kinds as Kind[]
  const scope = { projectSlug, module: moduleId, kind }
  const canWrite = list.canWrite
  const translations = hasTranslations(list)
  const rows = buildRows(list, filter)
  const summary = summarize(list.terms)
  const openTerm = list.terms.find((x) => x.key === openKey) ?? null

  const say = (message: string, tone: 'status' | 'error' = 'status') => {
    clearTimeout(toastTimer.current)
    setToast({ message, tone })
    toastTimer.current = setTimeout(() => setToast(null), tone === 'error' ? 6000 : 3500)
  }
  const sayError = (code: string | undefined) => say(t(`errors.${errorKey(code)}` as 'errors.failed'), 'error')

  async function load(nextModule: string, nextKind: Kind) {
    setLoading(true)
    setOpenKey(null)
    setFilter('all')
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
        <input
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
          className={INPUT}
        />
        {addError ? (
          <p role="alert" className="mt-1.5 text-sm text-destructive">
            {addError}
          </p>
        ) : null}
      </div>
      <button type="submit" disabled={addBusy || !addText.trim()} className={PRIMARY_BTN}>
        {addBusy ? t('adding') : t('addSubmit')}
      </button>
      <button
        type="button"
        onClick={() => {
          setAdding(false)
          setAddText('')
          setAddError(null)
        }}
        className={QUIET_BTN}
      >
        {t('cancel')}
      </button>
    </form>
  ) : (
    <button type="button" onClick={() => setAdding(true)} className={PRIMARY_BTN}>
      {svg('M12 5v14M5 12h14')}
      {t(`${kind}.add`)}
    </button>
  )

  return (
    <>
      <PageHeader title={t('title')} actions={list.terms.length > 0 && !adding ? addControl : null} />

      {modules.length > 1 || kinds.length > 1 ? (
        <FilterBar label={t('title')}>
          {modules.length > 1 ? (
            <FilterSelect
              label={t('module')}
              value={moduleId}
              onChange={(id) => {
                const next = modules.find((m) => m.id === id)
                if (next) void load(id, (next.kinds.includes(kind) ? kind : next.kinds[0]) as Kind)
              }}
              options={modules.map((m) => ({ value: m.id, label: m.label }))}
            />
          ) : null}
          {kinds.length > 1 ? (
            <FilterSegmented label={t('title')} value={kind} onChange={(k) => void load(moduleId, k as Kind)} options={kinds.map((k) => ({ value: k, label: t(`${k}.tab`) }))} />
          ) : null}
        </FilterBar>
      ) : (
        <p className="text-[0.9375rem] text-muted-foreground">{current.label}</p>
      )}

      {!canWrite ? <p className="text-sm text-muted-foreground">{t('readOnly')}</p> : null}

      {adding && list.terms.length > 0 ? addControl : null}

      {translations && list.terms.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.9375rem] text-muted-foreground" aria-live="polite">
            {summary.needTranslation > 0 ? t('summary', { count: summary.needTranslation, total: summary.total }) : t('allTranslated')}
          </p>
          {summary.needTranslation > 0 || filter === 'missing' ? (
            <button
              type="button"
              aria-pressed={filter === 'missing'}
              onClick={() => setFilter((f) => (f === 'missing' ? 'all' : 'missing'))}
              className={`inline-flex h-11 items-center rounded-full border px-4 text-[0.9375rem] font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                filter === 'missing' ? 'border-action bg-action text-action-foreground' : 'border-border bg-card text-foreground hover:bg-hover'
              }`}
            >
              {t('filterMissing')}
            </button>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <p className="text-[0.9375rem] text-muted-foreground" role="status">
          {t('loading')}
        </p>
      ) : list.terms.length === 0 ? (
        <EmptyState title={t(`${kind}.emptyTitle`)} body={t(`${kind}.emptyBody`)} action={addControl} />
      ) : rows.length === 0 ? (
        <p className="text-[0.9375rem] text-muted-foreground">{t('nothingMissing')}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, n) => (
            <li key={row.key} className="flex items-start gap-1 rounded-2xl border border-border bg-card pr-1">
              <button
                type="button"
                onClick={() => setOpenKey(row.key)}
                className="min-h-14 min-w-0 flex-1 rounded-2xl p-4 text-left hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="block truncate text-[0.9375rem] leading-6 font-semibold text-foreground">{row.name}</span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{row.usedBy > 0 ? t('usedBy', { count: row.usedBy }) : t('notUsed')}</span>
                {translations ? (
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {row.chips.map((c) => (
                      <span
                        key={c.locale}
                        className={`inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium ${c.complete ? 'bg-muted text-muted-foreground' : 'bg-accent text-accent-foreground'}`}
                      >
                        {c.complete ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-success">
                            <path d="m5 12 5 5L20 7" />
                          </svg>
                        ) : null}
                        <span className="sr-only">{t(c.complete ? 'chipDone' : 'chipMissingLabel', { language: languageName(c.locale, ui) })}</span>
                        <span aria-hidden="true">{c.complete ? c.code : t('chipMissing', { code: c.code })}</span>
                      </span>
                    ))}
                  </span>
                ) : null}
              </button>
              {canWrite && filter === 'all' && rows.length > 1 ? (
                <div className="flex shrink-0 items-center pt-1.5">
                  <button type="button" aria-label={t('moveUp', { name: row.name })} disabled={reordering || n === 0} onClick={() => void move(row.key, -1)} className={ICON_BTN}>
                    {svg('m6 15 6-6 6 6')}
                  </button>
                  <button type="button" aria-label={t('moveDown', { name: row.name })} disabled={reordering || n === rows.length - 1} onClick={() => void move(row.key, 1)} className={ICON_BTN}>
                    {svg('m6 9 6 6 6-6')}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
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
