'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocale, useMessages, useTranslations } from 'next-intl'
import { BackLink } from '@/components/app/ui/BackLink'
import { Field } from '@/components/app/ui/Field'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { TextInput } from '@/components/app/ui/TextInput'
import { Toast } from '@/components/app/ui/Toast'
import { languageName } from '@/components/client/create/StepHeading'
import type { Labels } from './setup-model'

/** A refusal from a Setup action (taxonomy-actions / settings-actions `Fail`). */
export type SetupFail = {
  ok: false
  error: string
  capability?: string
  detail?: { changedKeys?: readonly string[]; clash?: { kind: string; value?: string; max?: number }; [k: string]: unknown }
}

/**
 * The plain-language sentence for a refusal, with what to do: a missing permission names it
 * (C8 §8.6, nothing else leaks); a conflict names what changed elsewhere; a web-address clash
 * says why the address can't be used; anything unknown is the calm "nothing was changed".
 */
export function useFailText(nameOf?: (key: string) => string | null) {
  const te = useTranslations('catalogue.setupErrors')
  // Capability ids contain dots, so their names are read from the bundle directly (not as nested keys).
  const messages = useMessages() as { catalogue?: { capabilities?: Record<string, string> } }
  const ts = useTranslations('catalogue.segment.clash')
  const t = useTranslations('catalogue.setup.common')
  return useCallback(
    (fail: SetupFail): string => {
      const capability = fail.capability ? messages.catalogue?.capabilities?.[fail.capability] : undefined
      if (fail.error === 'forbidden' && capability) return t('needsCapability', { capability })
      if (fail.error === 'segment_invalid' && fail.detail?.clash && ts.has(fail.detail.clash.kind)) return ts(fail.detail.clash.kind, { value: fail.detail.clash.value ?? '', max: fail.detail.clash.max ?? 0 })
      const base = te.has(fail.error) ? te(fail.error) : te('failed')
      const changed = (fail.detail?.changedKeys ?? []).map((k) => nameOf?.(k) ?? null).filter((x): x is string => !!x)
      return changed.length ? t('changedElsewhere', { message: base, names: changed.join(', ') }) : base
    },
    [te, messages, ts, t, nameOf],
  )
}

/** One calm toast for a Setup screen ("Saved", or what went wrong). Clears itself. */
export function useSetupToast() {
  const [toast, setToast] = useState<{ message: string; tone: 'status' | 'error' } | null>(null)
  const timer = useRef<number | null>(null)
  const show = useCallback((message: string, tone: 'status' | 'error' = 'status') => {
    setToast({ message, tone })
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(null), tone === 'error' ? 8000 : 4000)
  }, [])
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current)
  }, [])
  const node = <Toast message={toast?.message ?? null} tone={toast?.tone} />
  return { show, node }
}

/** The page header of a Setup section: the way back to the Overview (when the person may open it), the title, top-right actions and one line of explanation. */
export function SetupHeader({ title, intro, backHref, actions }: { title: string; intro?: ReactNode; backHref?: string | null; actions?: ReactNode }) {
  const t = useTranslations('catalogue.setup.common')
  return (
    <div className="space-y-2">
      {backHref ? <BackLink href={backHref} label={t('back')} /> : null}
      <PageHeader title={title} actions={actions} />
      {intro ? <p className="max-w-2xl text-[0.9375rem] leading-6 text-muted-foreground">{intro}</p> : null}
    </div>
  )
}

/**
 * The name of something in every website language (content localization): the main language
 * first and required, the others optional ("translate later"). Two columns from md.
 */
export function LabelFields({
  locales,
  defaultLocale,
  value,
  onChange,
  label,
  error,
  disabled,
  maxLength = 80,
}: {
  locales: readonly string[]
  defaultLocale: string
  value: Labels
  onChange: (next: Labels) => void
  label: string
  error?: string | null
  disabled?: boolean
  maxLength?: number
}) {
  const t = useTranslations('catalogue.setup.common')
  const ui = useLocale()
  const ordered = [defaultLocale, ...locales.filter((l) => l !== defaultLocale)]
  return (
    <div className={`grid gap-3 ${ordered.length > 1 ? 'md:grid-cols-2' : ''}`}>
      {ordered.map((l) => (
        <Field
          key={l}
          label={ordered.length > 1 ? t('labelIn', { label, language: languageName(l, ui) }) : label}
          hint={ordered.length > 1 ? (l === defaultLocale ? t('mainLanguage') : t('optionalLanguage')) : undefined}
          error={l === defaultLocale ? error : undefined}
        >
          {(p) => (
            <TextInput
              {...p}
              lang={l}
              value={value[l] ?? ''}
              maxLength={maxLength}
              disabled={disabled}
              required={l === defaultLocale}
              onChange={(e) => onChange({ ...value, [l]: e.target.value })}
            />
          )}
        </Field>
      ))}
    </div>
  )
}

/** "Italian, German" — the languages still to translate. */
export function useLanguageList() {
  const ui = useLocale()
  return useCallback((codes: readonly string[]) => new Intl.ListFormat(ui, { type: 'conjunction' }).format(codes.map((c) => languageName(c, ui))), [ui])
}
