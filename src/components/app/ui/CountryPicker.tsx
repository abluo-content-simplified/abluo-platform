'use client'

import { useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { BottomSheet } from './BottomSheet'
import { Button } from './Button'
import { inputClass } from './field-styles'
import { PickerOption } from './PickerButton'
import { TextInput } from './TextInput'
import { countryGroups, countryName, type Country } from './country-model'

/**
 * A country: a field that opens a sheet with a search box and every country —
 * EU member states first, then the rest — named in the UI language and sorted
 * by that name. Search matches the name (accents ignored) or the ISO code.
 * Use it instead of a free-text country code or a native <select>.
 *
 * Values are ISO 3166-1 alpha-2 codes, upper-case ("IT"); '' / null = none.
 * `clearable` adds "Clear" to the sheet (onChange('')).
 *
 *   <Field label="Country">{(p) => <CountryPicker {...p} value={country} onChange={setCountry} />}</Field>
 */
const GlobeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-muted-foreground">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z" />
  </svg>
)

export function CountryPickerSheet({
  open,
  title,
  value,
  clearable = false,
  onDone,
  onClose,
}: {
  open: boolean
  title: string
  value: string | null
  clearable?: boolean
  /** The picked ISO code, or '' when cleared. */
  onDone: (code: string) => void
  onClose: () => void
}) {
  return (
    <BottomSheet open={open} title={title} onClose={onClose}>
      {open ? <SheetBody value={value} clearable={clearable} onDone={onDone} /> : null}
    </BottomSheet>
  )
}

function SheetBody({ value, clearable, onDone }: { value: string | null; clearable: boolean; onDone: (code: string) => void }) {
  const t = useTranslations('app.ui.countryPicker')
  const locale = useLocale()
  const [query, setQuery] = useState('')
  const groups = useMemo(() => countryGroups(locale, query), [locale, query])
  const empty = groups.eu.length === 0 && groups.other.length === 0

  const group = (key: 'eu' | 'other', list: Country[]) =>
    list.length ? (
      <section aria-labelledby={`country-group-${key}`} className="flex flex-col">
        <h3 id={`country-group-${key}`} className="sticky top-0 z-10 bg-popover px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t(key === 'eu' ? 'groupEu' : 'groupOther')}
        </h3>
        {list.map((c) => (
          <PickerOption key={c.code} current={c.code === value} secondary={c.code} onClick={() => onDone(c.code)}>
            {c.name}
          </PickerOption>
        ))}
      </section>
    ) : null

  return (
    <div className="flex flex-col gap-3">
      <TextInput
        type="search"
        // A search box that is the sheet's first job: focus it on open.
        autoFocus
        aria-label={t('search')}
        placeholder={t('search')}
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="-mx-1 max-h-[55vh] overflow-y-auto px-1" aria-live="polite">
        {empty ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('noMatch', { query: query.trim() })}</p>
        ) : (
          <>
            {group('eu', groups.eu)}
            {group('other', groups.other)}
          </>
        )}
      </div>
      {clearable && value ? (
        <Button variant="secondary" size="lg" fullWidth onClick={() => onDone('')}>
          {t('clear')}
        </Button>
      ) : null}
    </div>
  )
}

export function CountryPicker({
  id,
  value,
  onChange,
  clearable,
  title,
  placeholder,
  disabled,
  invalid,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  className = '',
}: {
  id: string
  /** ISO 3166-1 alpha-2 (upper-case); '' or null = none. */
  value: string | null
  /** The picked code, or '' when cleared. */
  onChange: (code: string) => void
  /** Optional country: the sheet offers "Clear". */
  clearable?: boolean
  /** The sheet's title (default "Choose a country"). */
  title?: string
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  className?: string
}) {
  const t = useTranslations('app.ui.countryPicker')
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const text = value ? countryName(value, locale) : ''
  const isInvalid = invalid || ariaInvalid === true || ariaInvalid === 'true'
  return (
    <div className={className}>
      <button
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={inputClass({ className: `flex items-center justify-between gap-3 text-left ${isInvalid ? 'border-destructive' : ''}` })}
      >
        <span className={`truncate ${text ? '' : 'text-muted-foreground'}`}>{text || placeholder || t('placeholder')}</span>
        <GlobeIcon />
      </button>
      <CountryPickerSheet
        open={open}
        title={title ?? t('placeholder')}
        value={value}
        clearable={clearable}
        onClose={() => setOpen(false)}
        onDone={(code) => {
          onChange(code)
          setOpen(false)
        }}
      />
    </div>
  )
}
