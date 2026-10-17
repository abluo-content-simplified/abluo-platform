'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { FilterBar, FilterSegmented, FilterSelect } from '@/components/app/ui/FilterBar'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { Button, IconButton } from '@/components/app/ui/Button'
import { Chip } from '@/components/app/ui/Chip'
import { TextInput } from '@/components/app/ui/TextInput'
import { FieldError } from '@/components/app/ui/FieldLabel'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { Pill } from '@/components/app/ui/list/cells'
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
  const { toast, show } = useUndo()

  const current = modules.find((m) => m.id === moduleId) ?? modules[0]
  const kinds = current.kinds as Kind[]
  const scope = { projectSlug, module: moduleId, kind }
  const canWrite = list.canWrite
  const translations = hasTranslations(list)
  const rows = buildRows(list, filter)
  const summary = summarize(list.terms)
  const openTerm = list.terms.find((x) => x.key === openKey) ?? null

  const say = (message: string, tone: 'status' | 'error' = 'status') => show({ message, tone }, tone === 'error' ? 6000 : 3500)
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
            <Chip selected={filter === 'missing'} onClick={() => setFilter((f) => (f === 'missing' ? 'all' : 'missing'))}>
              {t('filterMissing')}
            </Chip>
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
        <ul className="flex flex-col gap-2">
          {rows.map((row, n) => (
            <ListRow
              key={row.key}
              onOpen={() => setOpenKey(row.key)}
              trailing={
                canWrite && filter === 'all' && rows.length > 1 ? (
                  <>
                    <IconButton aria-label={t('moveUp', { name: row.name })} disabled={reordering || n === 0} onClick={() => void move(row.key, -1)}>
                      {svg('m6 15 6-6 6 6')}
                    </IconButton>
                    <IconButton aria-label={t('moveDown', { name: row.name })} disabled={reordering || n === rows.length - 1} onClick={() => void move(row.key, 1)}>
                      {svg('m6 9 6 6 6-6')}
                    </IconButton>
                  </>
                ) : undefined
              }
            >
              <span className="block max-w-full truncate text-[0.9375rem] leading-6 font-semibold text-foreground">{row.name}</span>
              <span className="text-sm text-muted-foreground">{row.usedBy > 0 ? t('usedBy', { count: row.usedBy }) : t('notUsed')}</span>
              {translations ? (
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
              ) : null}
            </ListRow>
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
