'use client'

import { useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { BottomSheet } from './BottomSheet'
import { Button } from './Button'
import { PickerOption } from './PickerButton'
import { TextInput } from './TextInput'
import { ToggleChips } from './ToggleChips'
import { languageDisplayName, languageGroups, type LanguageOption } from './language-model'

/**
 * Several languages out of every ISO 639-1 language: the chosen ones (and the
 * `suggested` ones, e.g. the site's languages) as chips, plus "More languages",
 * a sheet with a search box and the full list named in the UI language. At most
 * `max` can be chosen; the others turn off until one is removed.
 *
 * Values are two-letter lower-case codes ("it"), kept in the order they were
 * chosen. `suggested` languages are listed first and always shown as chips.
 */
export function LanguagePicker({
  label,
  value,
  onChange,
  suggested = [],
  max = 6,
  disabled = false,
}: {
  /** Accessible name of the group. */
  label: string
  value: readonly string[]
  onChange: (next: string[]) => void
  suggested?: readonly string[]
  max?: number
  disabled?: boolean
}) {
  const t = useTranslations('app.ui.languagePicker')
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const chips = [...new Set([...suggested, ...value])]
  const full = value.length >= max
  const toggle = (code: string) => onChange(value.includes(code) ? value.filter((c) => c !== code) : full ? [...value] : [...value, code])
  return (
    <div className="space-y-2">
      <ToggleChips
        label={label}
        options={chips.map((c) => ({ value: c, label: languageDisplayName(c, locale) }))}
        value={value}
        onChange={(next) => {
          if (disabled) return
          // ToggleChips returns the options in chip order; keep the order they were chosen in and respect the limit.
          const added = next.filter((c) => !value.includes(c))
          const kept = value.filter((c) => next.includes(c))
          onChange([...kept, ...added].slice(0, max))
        }}
      />
      <Button variant="secondary" size="md" disabled={disabled} onClick={() => setOpen(true)}>
        {t('more')}
      </Button>
      <BottomSheet open={open} title={t('title')} onClose={() => setOpen(false)}>
        {open ? <SheetBody suggested={suggested} value={value} full={full} max={max} onToggle={toggle} onDone={() => setOpen(false)} /> : null}
      </BottomSheet>
    </div>
  )
}

function SheetBody({ suggested, value, full, max, onToggle, onDone }: { suggested: readonly string[]; value: readonly string[]; full: boolean; max: number; onToggle: (code: string) => void; onDone: () => void }) {
  const t = useTranslations('app.ui.languagePicker')
  const locale = useLocale()
  const [query, setQuery] = useState('')
  const groups = useMemo(() => languageGroups(locale, suggested, query), [locale, suggested, query])
  const empty = groups.first.length === 0 && groups.other.length === 0
  const rows = (list: LanguageOption[]) =>
    list.map((l) => {
      const on = value.includes(l.code)
      return (
        <PickerOption key={l.code} current={on} secondary={l.code} disabled={!on && full} onClick={() => onToggle(l.code)}>
          {l.name}
        </PickerOption>
      )
    })
  return (
    <div className="flex flex-col gap-3">
      <TextInput type="search" autoFocus aria-label={t('search')} placeholder={t('search')} autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t('count', { count: value.length, max })}
      </p>
      <div className="-mx-1 max-h-[50vh] overflow-y-auto px-1" aria-live="polite">
        {empty ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('noMatch', { query: query.trim() })}</p>
        ) : (
          <>
            {groups.first.length ? (
              <section aria-labelledby="language-group-first" className="flex flex-col">
                <h3 id="language-group-first" className="sticky top-0 z-10 bg-popover px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {t('groupSite')}
                </h3>
                {rows(groups.first)}
              </section>
            ) : null}
            {groups.other.length ? (
              <section aria-labelledby="language-group-other" className="flex flex-col">
                <h3 id="language-group-other" className="sticky top-0 z-10 bg-popover px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {t('groupOther')}
                </h3>
                {rows(groups.other)}
              </section>
            ) : null}
          </>
        )}
      </div>
      <Button variant="primary" size="lg" fullWidth onClick={onDone}>
        {t('done')}
      </Button>
    </div>
  )
}
