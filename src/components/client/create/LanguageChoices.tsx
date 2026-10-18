'use client'

import type { ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { OptionCards } from '@/components/app/ui/OptionCards'
import { Panel } from '@/components/app/ui/Panel'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { languageName } from '@/components/client/create/StepHeading'

export type LanguageChoice = 'translate' | 'write' | 'later'

/**
 * The languages step's shared pieces (post wizard and gallery wizard): the
 * list — the original language, then for each other language "Translate for
 * me" (not yet), "I'll write it" or "Not now" with its ready/missing state —
 * and the "Editing <language>" section with its language chips. The fields
 * shown inside the section differ per wizard, so they are passed as children.
 */
export function LanguageChoiceList({
  defaultLocale,
  others,
  choices,
  isReady,
  onChoice,
  onActive,
}: {
  defaultLocale: string
  others: string[]
  choices: Record<string, LanguageChoice>
  isReady: (locale: string) => boolean
  onChoice: (locale: string, choice: LanguageChoice) => void
  /** Called with the language when "I'll write it" is chosen. */
  onActive: (locale: string) => void
}) {
  const t = useTranslations('clientDashboard.create.languages')
  const ui = useLocale()
  return (
    <ul className="mt-8 flex flex-col gap-3">
      <Panel as="li" tone="muted" className="flex min-h-14 items-center justify-between">
        <span className="text-[1.0625rem] font-medium text-foreground">{languageName(defaultLocale, ui)}</span>
        <span className="text-sm text-muted-foreground">{t('original')}</span>
      </Panel>
      {others.map((locale) => {
        const choice = choices[locale] ?? 'later'
        const name = languageName(locale, ui)
        const ready = isReady(locale)
        return (
          <Panel as="li" key={locale}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[1.0625rem] font-medium text-foreground">{name}</span>
              <span className={`text-sm ${ready ? 'text-success' : 'text-muted-foreground'}`}>{ready ? t('ready') : t('missing')}</span>
            </div>
            <OptionCards<LanguageChoice>
              label={name}
              layout="row"
              className="mt-3"
              value={choice}
              onChange={(v) => {
                if (v === 'write') {
                  onChoice(locale, 'write')
                  onActive(locale)
                } else if (v === 'later') onChoice(locale, 'later')
              }}
              options={[
                {
                  value: 'translate',
                  title: t('translate'),
                  badge: t('soon'),
                  disabled: true,
                },
                { value: 'write', title: t('write') },
                { value: 'later', title: t('later') },
              ]}
            />
          </Panel>
        )
      })}
    </ul>
  )
}

/** "Editing <language>" with the language chips (when several are being written); `children` are that language's fields. */
export function LanguageWriteSection({
  writing,
  current,
  onActive,
  children,
}: {
  writing: string[]
  current: string
  onActive: (locale: string) => void
  children: ReactNode
}) {
  const t = useTranslations('clientDashboard.create.languages')
  const ui = useLocale()
  return (
    <div className="mt-10 border-t border-border-subtle pt-8">
      {writing.length > 1 ? (
        <SegmentedControl
          appearance="chips"
          label={t('write')}
          className="mb-6"
          value={current}
          onChange={onActive}
          options={writing.map((l) => ({
            value: l,
            label: languageName(l, ui),
          }))}
        />
      ) : null}
      <h2 className="text-xl font-semibold tracking-tight text-foreground">{t('editing', { language: languageName(current, ui) })}</h2>
      <div key={current}>{children}</div>
    </div>
  )
}
