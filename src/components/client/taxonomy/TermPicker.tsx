'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button, ButtonLink } from '@/components/app/ui/Button'
import { TextInput } from '@/components/app/ui/TextInput'
import { FieldError } from '@/components/app/ui/FieldLabel'
import { ToggleChips } from '@/components/app/ui/ToggleChips'
import { createTaxonomyTermAction } from '@/app/[locale]/(client)/[tenant]/taxonomy/actions'
import { errorKey } from './taxonomy-view'
import {
  canOfferCreate,
  filterTerms,
  findByLabel,
  mergeTerms,
  newTermLabels,
  pickerLabel,
  selectKey,
  toPickerTerm,
  type PickerTerm,
} from './term-picker-model'

/**
 * Categories (and later tags) of one module, chosen on the spot (ADR-033
 * Amendment J, slice 5). Existing terms are chips to switch on and off; typing
 * narrows them; "+ Add category" creates the typed name in the website's main
 * language through the same action as the Categories & Tags screen and selects
 * it at once, without a reload. People who may not manage terms can choose but
 * see no "+ Add". The saved value is the list of stable keys, as before.
 */

/** Show the search box on its own once the list is long enough to need it. */
const SEARCH_FROM = 8

export function TermPicker({
  projectSlug,
  module,
  kind = 'category',
  label,
  terms,
  value,
  onChange,
  defaultLocale,
  canAdd,
  disabled = false,
}: {
  projectSlug: string
  module: string
  kind?: 'category' | 'tag'
  /** Accessible name of the group. */
  label: string
  terms: readonly PickerTerm[]
  value: string[]
  onChange: (next: string[]) => void
  defaultLocale: string
  /** Holds `<module>.taxonomy.write` (a hint; the server re-checks). */
  canAdd: boolean
  disabled?: boolean
}) {
  const t = useTranslations('clientDashboard.taxonomy')
  const ui = useLocale()
  const [added, setAdded] = useState<PickerTerm[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const addable = canAdd && !disabled

  // The latest selection, for an add that finishes after other clicks.
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])

  const all = useMemo(() => mergeTerms(terms, added), [terms, added])
  const shown = useMemo(() => filterTerms(all, query, value), [all, query, value])
  const options = useMemo(() => shown.map((x) => ({ value: x.value, label: pickerLabel(x, ui, defaultLocale) })), [shown, ui, defaultLocale])
  const text = query.trim()
  const existing = text ? findByLabel(all, text, ui, defaultLocale) : null
  const offer = canOfferCreate({ canAdd: addable, query, terms: all, ui, defaultLocale })
  const showSearch = addable || all.length >= SEARCH_FROM

  async function create() {
    const labels = newTermLabels(query, defaultLocale)
    if (!labels || busy) return
    setBusy(true)
    setError(null)
    const r = await createTaxonomyTermAction({ projectSlug, module, kind, labels })
    setBusy(false)
    if (!r.ok) return setError(t(`errors.${errorKey(r.error)}` as 'errors.failed'))
    const term = toPickerTerm(r.term)
    const nextAll = mergeTerms(all, [term])
    setAdded((a) => mergeTerms(a, [term]))
    onChange(selectKey(valueRef.current, term.value, nextAll.map((x) => x.value)))
    setQuery('')
  }

  function submit() {
    if (existing) {
      // Same name as a term that is already there: choose that one.
      if (!valueRef.current.includes(existing.value)) onChange(selectKey(valueRef.current, existing.value, all.map((x) => x.value)))
      setQuery('')
      return
    }
    if (offer) void create()
  }

  return (
    <div className="space-y-3">
      {options.length ? (
        <ToggleChips label={label} options={options} value={value} onChange={onChange} />
      ) : (
        <p className="text-[0.9375rem] text-muted-foreground">{text ? t('picker.noMatch') : addable ? t(`picker.${kind}.empty`) : t(`${kind}.emptyTitle`)}</p>
      )}

      {showSearch ? (
        <div className="flex flex-wrap items-start gap-2">
          <TextInput
            flush
            controlSize="md"
            ref={inputRef}
            type="text"
            value={query}
            disabled={disabled || busy}
            maxLength={80}
            onChange={(e) => {
              setQuery(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
            placeholder={t(addable ? `picker.${kind}.placeholderAdd` : 'picker.placeholderSearch')}
            aria-label={t(addable ? `picker.${kind}.placeholderAdd` : 'picker.placeholderSearch')}
            className="flex-1 basis-56"
          />
          {addable ? (
            <Button className="max-w-full" disabled={busy || (!!text && !offer)} onClick={() => (offer ? void create() : inputRef.current?.focus())}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span className="truncate">{busy ? t('adding') : offer ? t(`picker.${kind}.addNamed`, { name: text }) : t(`${kind}.add`)}</span>
            </Button>
          ) : null}
        </div>
      ) : null}

      <FieldError>{error}</FieldError>

      {addable ? (
        <ButtonLink variant="link" className="px-0" href={`/${projectSlug}/taxonomy?module=${encodeURIComponent(module)}&kind=${encodeURIComponent(kind)}`}>
          {t('picker.manage')}
        </ButtonLink>
      ) : null}
    </div>
  )
}
