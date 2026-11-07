'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Field } from '@/components/app/ui/Field'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { TextArea } from '@/components/app/ui/TextInput'
import { languageName } from '@/components/client/create/StepHeading'

/**
 * One longer text in every language of the site: language chips (the shared
 * SegmentedControl, as in the Documents editor) above one text area. The main
 * language comes first; a language left empty falls back to it, which the hint
 * says. Same pattern as the Documents editor's single-line LocalizedText.
 */
export function LocalizedTextArea({
  label,
  hint,
  values,
  onChange,
  languages,
  mainLocale,
  maxLength,
  rows = 4,
  disabled,
  error,
}: {
  label: string
  hint: string
  values: Record<string, string>
  onChange: (next: Record<string, string>) => void
  languages: readonly string[]
  mainLocale: string
  maxLength: number
  rows?: number
  disabled?: boolean
  error?: string | null
}) {
  const t = useTranslations('clientDashboard.bookings.rules.localized')
  const ui = useLocale()
  const [locale, setLocale] = useState(mainLocale)
  const name = (l: string) => languageName(l, ui)
  const main = values[mainLocale]?.trim() ?? ''
  const isMain = locale === mainLocale
  return (
    <div className="flex flex-col gap-2">
      {languages.length > 1 ? (
        <SegmentedControl
          appearance="chips"
          label={t('languageOf', { field: label })}
          value={locale}
          onChange={setLocale}
          options={languages.map((l) => ({
            value: l,
            label: (
              <>
                {name(l)}
                {l !== mainLocale && !values[l]?.trim() ? <span className="sr-only"> · {t('notTranslated')}</span> : null}
              </>
            ),
          }))}
        />
      ) : null}
      <Field
        label={languages.length > 1 ? `${label} · ${name(locale)}` : label}
        hint={isMain ? hint : main ? t('fallbackHint', { language: name(mainLocale) }) : t('fallbackHintEmpty', { language: name(mainLocale) })}
        error={isMain ? error : undefined}
      >
        {(p) => (
          <TextArea
            {...p}
            lang={locale}
            rows={rows}
            value={values[locale] ?? ''}
            maxLength={maxLength}
            disabled={disabled}
            onChange={(e) => onChange({ ...values, [locale]: e.target.value })}
          />
        )}
      </Field>
    </div>
  )
}
