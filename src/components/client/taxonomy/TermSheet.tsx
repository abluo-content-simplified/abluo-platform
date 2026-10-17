'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { SavePill } from '@/components/app/ui/SavePill'
import { languageName } from '@/components/client/create/StepHeading'
import type { SaveState } from '@/lib/client/autosave/engine'
import { deleteTaxonomyTermAction, getTaxonomyTermUsageAction, updateTaxonomyTermAction } from '@/app/[locale]/(client)/[tenant]/taxonomy/actions'
import type { ListedTerm, TermView } from '@/lib/taxonomy/service'
import { cleanText, deleteState, errorKey, itemHref, termName, type ListState, type UsageView } from './taxonomy-view'

/**
 * One term in a side sheet: its name in every language of the website (the
 * default language first and required), saved as you type — "Saving…" turns
 * into "Saved" only once the server has confirmed — and, for people who may
 * change terms, Delete. A term that is still used cannot be deleted: the sheet
 * says why and lists where it is used (first 10, each linking to its editor).
 * Nothing technical is shown: the key never appears.
 */

const INPUT =
  'mt-1.5 h-12 w-full rounded-xl border border-border bg-background px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none read-only:bg-muted read-only:text-muted-foreground'
const DANGER_BTN =
  'inline-flex h-12 w-full items-center justify-center rounded-xl px-5 text-[0.9375rem] font-medium text-destructive hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40 disabled:hover:bg-transparent'
const DEBOUNCE_MS = 700

type Kind = 'category' | 'tag'
type Meta = Pick<ListState, 'module' | 'kind' | 'defaultLocale' | 'locales' | 'canWrite'>

export function TermSheet({
  term,
  meta,
  projectSlug,
  onClose,
  onChanged,
  onDeleted,
}: {
  term: ListedTerm | null
  meta: Meta
  projectSlug: string
  onClose: () => void
  /** A save was confirmed by the server: the term as stored. */
  onChanged: (term: TermView) => void
  onDeleted: (key: string) => void
}) {
  return (
    <BottomSheet open={term !== null} title={term ? termName(term, meta.defaultLocale) : ''} onClose={onClose}>
      {term ? <TermSheetBody key={term.key} term={term} meta={meta} projectSlug={projectSlug} onChanged={onChanged} onDeleted={onDeleted} /> : null}
    </BottomSheet>
  )
}

function TermSheetBody({
  term,
  meta,
  projectSlug,
  onChanged,
  onDeleted,
}: {
  term: ListedTerm
  meta: Meta
  projectSlug: string
  onChanged: (term: TermView) => void
  onDeleted: (key: string) => void
}) {
  const t = useTranslations('clientDashboard.taxonomy')
  const ui = useLocale()
  const kind = meta.kind as Kind
  const scope = { projectSlug, module: meta.module, kind: meta.kind }
  const { canWrite, defaultLocale, locales } = meta

  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(locales.map((l) => [l, term.label[l] ?? ''])))
  const valuesRef = useRef(values)
  const saved = useRef<Record<string, string>>(Object.fromEntries(locales.map((l) => [l, cleanText(term.label[l] ?? '')])))
  const timers = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({})
  const queue = useRef<Promise<void>>(Promise.resolve())
  const inflight = useRef(0)
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)
  const onChangedRef = useRef(onChanged)
  useEffect(() => {
    onChangedRef.current = onChanged
  })

  const dirty = () => locales.some((l) => cleanText(valuesRef.current[l] ?? '') !== (saved.current[l] ?? ''))

  function save(locale: string) {
    clearTimeout(timers.current[locale])
    timers.current[locale] = undefined
    const text = cleanText(valuesRef.current[locale] ?? '')
    if (text === (saved.current[locale] ?? '')) {
      if (!dirty() && inflight.current === 0) setState((s) => (s === 'saving' ? 'saved' : s))
      return
    }
    if (locale === defaultLocale && !text) {
      setError(t('errors.label_required')) // the default name is required: keep what is stored
      setState('idle')
      return
    }
    inflight.current += 1
    setState('saving')
    queue.current = queue.current.then(async () => {
      const r = await updateTaxonomyTermAction({ ...scope, key: term.key, labels: { [locale]: text } })
      inflight.current -= 1
      if (r.ok) {
        saved.current[locale] = text
        onChangedRef.current(r.term)
        setError(null)
        if (inflight.current === 0) setState(dirty() ? 'saving' : 'saved')
      } else {
        setError(t(`errors.${errorKey(r.error)}` as 'errors.failed'))
        if (inflight.current === 0) setState('error')
      }
    })
  }

  function edit(locale: string, value: string) {
    const next = { ...valuesRef.current, [locale]: value }
    valuesRef.current = next
    setValues(next)
    setError(null)
    if (cleanText(value) === (saved.current[locale] ?? '')) {
      clearTimeout(timers.current[locale])
      setState(dirty() ? 'saving' : 'idle')
      return
    }
    setState('saving')
    clearTimeout(timers.current[locale])
    timers.current[locale] = setTimeout(() => save(locale), DEBOUNCE_MS)
  }

  // Closing the sheet (or Escape) never loses a name that is still waiting for its pause.
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })
  useEffect(
    () => () => {
      for (const l of locales) if (timers.current[l]) saveRef.current(l)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // ── Where it is used ──
  const [usage, setUsage] = useState<UsageView | null>(null)
  const [usageLoading, setUsageLoading] = useState(term.usedBy > 0)
  useEffect(() => {
    if (term.usedBy <= 0) return
    let live = true
    void getTaxonomyTermUsageAction({ ...scope, key: term.key }).then((r) => {
      if (!live) return
      if (r.ok) setUsage(r.usage)
      setUsageLoading(false)
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term.key])
  const ds = deleteState(term.usedBy, usage)

  // ── Delete ──
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  async function remove() {
    setDeleting(true)
    setDeleteError(null)
    const r = await deleteTaxonomyTermAction({ ...scope, key: term.key })
    setDeleting(false)
    if (r.ok) {
      setConfirming(false)
      onDeleted(term.key)
      return
    }
    if (r.error === 'in_use' && r.detail) {
      // Used after all (someone just filed an item under it): show it instead of an error.
      setUsage({ count: r.detail.count ?? 1, items: r.detail.items ?? [] })
      setConfirming(false)
      return
    }
    setDeleteError(t(`errors.${errorKey(r.error)}` as 'errors.failed'))
  }

  const name = termName(term, defaultLocale)
  return (
    <div className="flex flex-col gap-5 pt-2">
      {!canWrite ? <p className="text-sm text-muted-foreground">{t('readOnly')}</p> : null}
      <div className="space-y-4">
        {locales.map((l) => (
          <div key={l}>
            <label htmlFor={`term-${term.key}-${l}`} className="text-[0.9375rem] font-medium text-foreground">
              {locales.length > 1 ? t('nameIn', { language: languageName(l, ui) }) : t('name')}
            </label>
            <input
              id={`term-${term.key}-${l}`}
              lang={l}
              maxLength={80}
              value={values[l] ?? ''}
              readOnly={!canWrite}
              required={l === defaultLocale}
              aria-invalid={l === defaultLocale && error === t('errors.label_required') ? true : undefined}
              onChange={(e) => edit(l, e.target.value)}
              onBlur={() => canWrite && save(l)}
              className={INPUT}
            />
          </div>
        ))}
      </div>

      {canWrite ? (
        <div className="flex min-h-9 flex-wrap items-center gap-3">
          <SavePill state={state} />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {ds.kind === 'blocked' ? (
        <section aria-label={t(`${kind}.usedHeading`, { count: ds.count })} className="space-y-2">
          <p className="text-[0.9375rem] leading-6 text-muted-foreground" id={`term-${term.key}-blocked`}>
            {canWrite ? t(`${kind}.blocked`, { count: ds.count }) : t(`${kind}.usedHeading`, { count: ds.count })}
          </p>
          {usageLoading && ds.shown.length === 0 ? <p className="text-sm text-muted-foreground">{t('usageLoading')}</p> : null}
          {ds.shown.length > 0 ? (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {ds.shown.map((item) => {
                const href = itemHref(projectSlug, item)
                const label = item.name.trim() || t('untitledItem')
                return (
                  <li key={item.id} className="min-h-11">
                    {href ? (
                      <Link href={href} className="flex min-h-11 items-center px-3 text-[0.9375rem] text-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                        {label}
                      </Link>
                    ) : (
                      <span className="flex min-h-11 items-center px-3 text-[0.9375rem] text-foreground">{label}</span>
                    )}
                  </li>
                )
              })}
              {ds.more > 0 && ds.shown.length > 0 ? <li className="flex min-h-11 items-center px-3 text-sm text-muted-foreground">{t('moreItems', { count: ds.more })}</li> : null}
            </ul>
          ) : null}
        </section>
      ) : null}

      {canWrite ? (
        <section className="border-t border-border pt-3">
          <button type="button" disabled={ds.kind === 'blocked'} aria-describedby={ds.kind === 'blocked' ? `term-${term.key}-blocked` : undefined} onClick={() => setConfirming(true)} className={DANGER_BTN}>
            {t(`${kind}.delete`)}
          </button>
        </section>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title={t(`${kind}.confirmTitle`, { name })}
        body={t(`${kind}.confirmBody`)}
        confirmLabel={deleting ? t('deleting') : t('deleteConfirm')}
        cancelLabel={t('cancel')}
        busy={deleting}
        error={deleteError}
        onConfirm={() => void remove()}
        onCancel={() => {
          setConfirming(false)
          setDeleteError(null)
        }}
      />
    </div>
  )
}
