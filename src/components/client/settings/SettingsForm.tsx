'use client'

import { useCallback, useId, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'
import { Chip } from '@/components/app/ui/Chip'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { Field } from '@/components/app/ui/Field'
import { FieldLabel } from '@/components/app/ui/FieldLabel'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Panel } from '@/components/app/ui/Panel'
import { SavePill } from '@/components/app/ui/SavePill'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { Select } from '@/components/app/ui/Select'
import { TextArea, TextInput } from '@/components/app/ui/TextInput'
import { saveSettingsAction } from '@/app/[locale]/(client)/[tenant]/settings/actions'
import { languageName } from '@/components/client/create/StepHeading'
import { useAutosave } from '@/lib/client/autosave/use-autosave'
import type { SendResult } from '@/lib/client/autosave/engine'
import { MAX_TRACKING_ID_LENGTH, addRow, canAddRow, cleanTrackingId, duplicateMarketplaces, isIncomplete, marketplaceLabel, marketplaceOptions, pendingSuggestions, removeRow, rowsFromStored, trackingIdLooksOff, updateRow, type AmazonRow } from '@/lib/settings/amazon-rows'
import { AMAZON_PATH, DISCLOSURE_PREFIX, MAX_DISCLOSURE_LENGTH } from '@/lib/settings/paths'
import type { SettingsView } from '@/lib/settings/service'

/**
 * Client dashboard — Settings (Tom, 2026-10-18), first version: the client's
 * own business facts. Amazon tracking IDs (one per Amazon store) and the
 * affiliate disclosure per site language. Contact and legal details come later
 * as further sections. Every field saves by itself (SavePill: "Saved" only
 * after the server confirmed). People who may only look get the same page with
 * the controls locked and a line saying why.
 */
export function SettingsForm({
  projectSlug,
  initial,
  standardWording,
  readOnly,
}: {
  projectSlug: string
  initial: SettingsView
  /** The website's standard disclosure sentence per site language (same function the website uses). */
  standardWording: Record<string, string>
  /** True when the person may not change anything (editor, support visit). */
  readOnly: boolean
}) {
  const t = useTranslations('clientDashboard.settings')
  const uiLocale = useLocale()
  const editable = initial.canWrite && !readOnly
  const amazonId = useId()
  const disclosureId = useId()

  const [rows, setRows] = useState<AmazonRow[]>(() => rowsFromStored(initial.amazon))
  const [disclosure, setDisclosure] = useState<Record<string, string>>(initial.disclosure)

  const send = useCallback(
    async ({ rev, set }: { rev: string; set: Record<string, unknown> }): Promise<SendResult> => {
      const r = await saveSettingsAction({ projectSlug, rev, set })
      if (r.ok) return { ok: true, rev: r.rev }
      if (r.error === 'conflict' || r.error === 'failed') return { ok: false, error: r.error }
      if (r.error === 'invalid_field' || r.error === 'invalid_value' || r.error === 'invalid_marketplace' || r.error === 'duplicate_marketplace' || r.error === 'too_many') return { ok: false, error: 'invalid_value' }
      return { ok: false, error: r.error }
    },
    [projectSlug],
  )

  const auto = useAutosave({
    draftId: `settings:${projectSlug}`,
    rev: initial.rev,
    send,
    // Unsent edits from a closed tab come back first.
    onReady: (replayed) => {
      if (!replayed || !editable) return
      if (Array.isArray(replayed[AMAZON_PATH])) setRows(rowsFromStored(replayed[AMAZON_PATH] as never))
      const texts: Record<string, string> = {}
      for (const [path, value] of Object.entries(replayed)) if (path.startsWith(DISCLOSURE_PREFIX) && typeof value === 'string') texts[path.slice(DISCLOSURE_PREFIX.length)] = value
      if (Object.keys(texts).length) setDisclosure((d) => ({ ...d, ...texts }))
    },
  })

  const reload = useCallback(async () => {
    await auto.discard()
    window.location.reload()
  }, [auto])

  const saveRows = (next: AmazonRow[]) => {
    setRows(next)
    // A store picked twice is shown as an error and not sent; a row without a store has nothing to save yet.
    if (duplicateMarketplaces(next).length > 0) return
    auto.set({ [AMAZON_PATH]: next.filter((r) => r.marketplace).map((r) => ({ marketplace: r.marketplace, trackingId: cleanTrackingId(r.trackingId) })) })
  }

  const saveDisclosure = (locale: string, text: string) => {
    setDisclosure((d) => ({ ...d, [locale]: text }))
    auto.set({ [`${DISCLOSURE_PREFIX}${locale}`]: text })
  }

  const suggestions = pendingSuggestions(initial.locales, rows)
  const duplicates = new Set<string>(duplicateMarketplaces(rows))

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t('title')} actions={editable ? <SavePill state={auto.state} onReload={reload} /> : null} />

      {editable ? <p className="text-sm text-muted-foreground">{t('changesLive')}</p> : <Notice tone="info">{t('readOnly')}</Notice>}

      {auto.rejected.length > 0 ? <Notice tone="error">{t('rejected')}</Notice> : null}

      <section aria-labelledby={amazonId} className="flex flex-col gap-3">
        <SectionHeading id={amazonId} title={t('amazon.title')} />
        <p className="text-sm text-muted-foreground">{t('amazon.intro')}</p>

        {rows.length === 0 ? (
          <EmptyState compact titleAs="p" title={t('amazon.emptyTitle')} body={editable ? t('amazon.emptyBody') : undefined} />
        ) : (
          <Panel>
            <ul className="flex flex-col gap-5">
              {rows.map((row) => {
                const options = marketplaceOptions(rows, row.marketplace)
                const hint = row.trackingId && trackingIdLooksOff(row.trackingId) ? t('amazon.looksOff') : undefined
                const error = duplicates.has(row.marketplace) ? t('amazon.duplicate') : undefined
                return (
                  <li key={row.key} className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <Field label={t('amazon.store')} error={error} className="sm:w-60">
                      {(p) => (
                        <Select
                          {...p}
                          value={row.marketplace}
                          disabled={!editable}
                          onChange={(e) => saveRows(updateRow(rows, row.key, { marketplace: e.target.value as AmazonRow['marketplace'] }))}
                        >
                          {row.marketplace === '' ? <option value="">{t('amazon.chooseStore')}</option> : null}
                          {options.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label={t('amazon.trackingId')} hint={hint ?? (isIncomplete(row) && editable ? t('amazon.incomplete') : undefined)} className="sm:flex-1">
                      {(p) => (
                        <TextInput
                          {...p}
                          value={row.trackingId}
                          readOnly={!editable}
                          maxLength={MAX_TRACKING_ID_LENGTH}
                          placeholder={t('amazon.trackingIdPlaceholder')}
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          onChange={(e) => saveRows(updateRow(rows, row.key, { trackingId: e.target.value }))}
                        />
                      )}
                    </Field>
                    {editable ? (
                      <Button variant="quiet" className="sm:mt-7" aria-label={t('amazon.removeNamed', { store: row.marketplace ? marketplaceLabel(row.marketplace) : t('amazon.store') })} onClick={() => saveRows(removeRow(rows, row.key))}>
                        {t('amazon.remove')}
                      </Button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </Panel>
        )}

        {editable && suggestions.length > 0 ? (
          <div className="flex flex-col gap-1">
            <FieldLabel as="p">{t('amazon.suggested')}</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((m) => (
                <Chip key={m} onClick={() => saveRows(addRow(rows, m))}>
                  {t('amazon.quickAdd', { store: marketplaceLabel(m) })}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}

        {editable && canAddRow(rows) ? (
          <div>
            <Button variant="secondary" onClick={() => setRows(addRow(rows))}>
              {t('amazon.add')}
            </Button>
          </div>
        ) : null}
      </section>

      {initial.catalogueInstalled ? (
        <section aria-labelledby={disclosureId} className="flex flex-col gap-3">
          <SectionHeading id={disclosureId} title={t('disclosure.title')} />
          <p className="text-sm text-muted-foreground">{t('disclosure.intro')}</p>
          <Panel>
            <ul className="flex flex-col gap-5">
              {initial.locales.map((locale) => {
                const text = disclosure[locale] ?? ''
                return (
                  <li key={locale}>
                    <Field label={languageName(locale, uiLocale)} hint={text.trim() === '' ? t('disclosure.usingStandard') : undefined}>
                      {(p) => (
                        <TextArea
                          {...p}
                          rows={3}
                          value={text}
                          readOnly={!editable}
                          maxLength={MAX_DISCLOSURE_LENGTH}
                          placeholder={standardWording[locale] ?? ''}
                          onChange={(e) => saveDisclosure(locale, e.target.value)}
                        />
                      )}
                    </Field>
                    {editable && text.trim() !== '' ? (
                      <Button variant="quiet" onClick={() => saveDisclosure(locale, '')}>
                        {t('disclosure.useStandard')}
                      </Button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </Panel>
        </section>
      ) : null}
    </div>
  )
}
