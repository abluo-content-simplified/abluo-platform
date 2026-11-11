'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { saveNavLabelsAction } from '@/app/[locale]/(client)/[tenant]/settings/labels/actions'
import { Button } from '@/components/app/ui/Button'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { TextInput } from '@/components/app/ui/TextInput'
import { SettingsHeader } from '@/components/client/settings/SettingsTabs'
import { NAV_LABEL_MAX, type CustomLabelId, type NavLabelMap } from '@/lib/nav-labels/model'
import type { InterfaceLocale } from '@/lib/i18n/locales'

type Values = Record<string, Record<string, string>>

/**
 * Settings → Labels (Tom, 2026-11-11): one row per section this project has,
 * one field per dashboard language. Empty = the default name, shown as the
 * field's placeholder. Save applies to the sidebar and the section's page
 * title at once, for this project only.
 */
export function NavLabelsForm({
  projectSlug,
  ids,
  locales,
  defaults,
  initial,
  canWrite,
}: {
  projectSlug: string
  ids: CustomLabelId[]
  locales: InterfaceLocale[]
  /** locale → section → default name in that language. */
  defaults: Record<string, Record<string, string>>
  initial: NavLabelMap
  canWrite: boolean
}) {
  const t = useTranslations('clientDashboard.navLabels')
  const current = useLocale()
  const router = useRouter()
  // The dashboard's current language first.
  const ordered = [...locales].sort((a, b) => (a === current ? -1 : b === current ? 1 : 0))
  const seed = (): Values => Object.fromEntries(locales.map((l) => [l, Object.fromEntries(ids.map((id) => [id, initial[l]?.[id] ?? '']))]))
  const [values, setValues] = useState<Values>(seed)
  const [saved, setSaved] = useState<Values>(seed)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const changed = JSON.stringify(values) !== JSON.stringify(saved)
  const langName = (l: string) => {
    try {
      const n = new Intl.DisplayNames([current], { type: 'language' }).of(l)
      return n ? n.charAt(0).toLocaleUpperCase(current) + n.slice(1) : l.toUpperCase()
    } catch {
      return l.toUpperCase()
    }
  }

  async function save() {
    setBusy(true)
    setError(null)
    setDone(false)
    const r = await saveNavLabelsAction({ projectSlug, labels: values }).catch(() => ({ ok: false as const, error: 'error' as const }))
    setBusy(false)
    if (r.ok) {
      setSaved(values)
      setDone(true)
      router.refresh()
    } else setError(t(`errors.${r.error === 'invalid' ? 'invalid' : r.error === 'unavailable' ? 'unavailable' : 'error'}`, { max: NAV_LABEL_MAX }))
  }

  return (
    <div className="space-y-5">
      <SettingsHeader
        ownTitle={t('title')}
        actions={
          canWrite ? (
            <Button variant="primary" disabled={busy || !changed} aria-busy={busy || undefined} aria-describedby="labels-save-why" onClick={() => void save()}>
              {busy ? t('saving') : t('save')}
            </Button>
          ) : null
        }
      />
      <p className="max-w-2xl text-[0.9375rem] leading-6 text-muted-foreground">{t('intro')}</p>
      {canWrite && !changed && !done ? (
        <p id="labels-save-why" className="sr-only">
          {t('nothingChanged')}
        </p>
      ) : null}
      {!canWrite ? <Notice tone="info">{t('readOnly')}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {done && !changed ? <Notice tone="info">{t('saved')}</Notice> : null}

      {ids.length === 0 ? (
        <Notice tone="info">{t('nothing')}</Notice>
      ) : (
        <div className="flex flex-col gap-4">
          {ids.map((id) => (
            <Panel key={id} as="section" aria-labelledby={`label-${id}`}>
              <h2 id={`label-${id}`} className="text-[0.9375rem] leading-6 font-semibold">
                {defaults[current]?.[id] ?? id}
              </h2>
              <div className="mt-3 grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
                {ordered.map((l) => (
                  <Field key={l} label={langName(l)}>
                    {(p) => (
                      <TextInput
                        {...p}
                        value={values[l]?.[id] ?? ''}
                        placeholder={defaults[l]?.[id] ?? ''}
                        maxLength={NAV_LABEL_MAX}
                        disabled={!canWrite || busy}
                        onChange={(e) => {
                          const v = e.target.value
                          setDone(false)
                          setValues((prev) => ({ ...prev, [l]: { ...(prev[l] ?? {}), [id]: v } }))
                        }}
                      />
                    )}
                  </Field>
                ))}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  )
}
