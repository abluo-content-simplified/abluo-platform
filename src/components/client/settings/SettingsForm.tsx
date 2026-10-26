'use client'

import { useCallback, useId, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'
import { buttonClass } from '@/components/app/ui/button-styles'
import { Checkbox } from '@/components/app/ui/Checkbox'
import { Chip } from '@/components/app/ui/Chip'
import { DragGrip, DropLine } from '@/components/app/ui/DragGrip'
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
import { dropIndex, usePointerDrag } from '@/components/app/ui/use-pointer-drag'
import { saveSettingsAction } from '@/app/[locale]/(client)/[tenant]/settings/actions'
import { languageName } from '@/components/client/create/StepHeading'
import { useAutosave } from '@/lib/client/autosave/use-autosave'
import type { SendResult } from '@/lib/client/autosave/engine'
import { MAX_TRACKING_ID_LENGTH, addRow, canAddRow, cleanTrackingId, duplicateMarketplaces, isIncomplete, marketplaceLabel, marketplaceOptions, pendingSuggestions, removeRow, rowsFromStored, trackingIdLooksOff, updateRow, type AmazonRow } from '@/lib/settings/amazon-rows'
import { MAX_AWIN_ID_LENGTH, cleanAwinId, idsToSave, moveShop, moveShopTo, stateFromStored, toggleApproved, unapprovedShops, type ShopsState } from '@/lib/settings/affiliate-shops-rows'
import { looksLikeAwinPublisherId } from '@/lib/affiliate/awin-links'
import { shopById } from '@/lib/affiliate/shops'
import { AMAZON_PATH, AWIN_PATH, SHOPS_PATH, DISCLOSURE_PREFIX, MAX_DISCLOSURE_LENGTH } from '@/lib/settings/paths'
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
  const affiliateId = useId()
  const awinHeadingId = useId()

  const [rows, setRows] = useState<AmazonRow[]>(() => rowsFromStored(initial.amazon))
  const [awinId, setAwinId] = useState(initial.awin.publisherId)
  const [shops, setShops] = useState<ShopsState>(() => stateFromStored(initial.awin.shops))
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
      if (typeof replayed[AWIN_PATH] === 'string') setAwinId(replayed[AWIN_PATH] as string)
      if (Array.isArray(replayed[SHOPS_PATH])) setShops(stateFromStored(replayed[SHOPS_PATH] as never))
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

  const saveAwinId = (value: string) => {
    const v = cleanAwinId(value)
    setAwinId(v)
    // A half-typed ID is shown with a hint and not sent; empty clears it.
    if (v === '' || looksLikeAwinPublisherId(v)) auto.set({ [AWIN_PATH]: v })
  }

  const saveShops = (next: ShopsState) => {
    setShops(next)
    auto.set({ [SHOPS_PATH]: idsToSave(next) })
  }

  const drag = usePointerDrag((key, over) => {
    const to = dropIndex(shops.order, key, over)
    if (to !== null) saveShops(moveShopTo(shops, key as ShopsState['order'][number], to))
  })

  const saveDisclosure = (locale: string, text: string) => {
    setDisclosure((d) => ({ ...d, [locale]: text }))
    auto.set({ [`${DISCLOSURE_PREFIX}${locale}`]: text })
  }

  const unapproved = unapprovedShops(shops)
  const renderShopControls = (id: ShopsState['order'][number]) => {
    const shop = shopById(id)
    const notReady = shop.awinAdvertiserId === null
    return (
      <div className="flex flex-col gap-1 sm:items-end">
        <div className="flex flex-wrap items-start gap-x-3">
          {shop.joinUrl ? (
            <a href={shop.joinUrl} target="_blank" rel="noopener noreferrer" aria-label={t('awin.joinNamed', { shop: shop.name })} className={buttonClass({ variant: 'link' })}>
              {t('awin.join')}
            </a>
          ) : null}
          <label className="flex items-start gap-1">
            <Checkbox aria-label={t('awin.approvedNamed', { shop: shop.name })} checked={shops.order.includes(id)} disabled={!editable || notReady} onChange={(on) => saveShops(toggleApproved(shops, id, on))} />
            <span aria-hidden="true" className="pt-2.5 pr-1 text-[0.9375rem] leading-6">{t('awin.approved')}</span>
          </label>
        </div>
        {notReady ? <p className="text-sm text-muted-foreground">{t('awin.comingSoon')}</p> : null}
      </div>
    )
  }

  const suggestions = pendingSuggestions(initial.locales, rows)
  const duplicates = new Set<string>(duplicateMarketplaces(rows))

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t('title')} actions={editable ? <SavePill state={auto.state} onReload={reload} /> : null} />

      {editable ? <p className="text-sm text-muted-foreground">{t('changesLive')}</p> : <Notice tone="info">{t('readOnly')}</Notice>}

      {auto.rejected.length > 0 ? <Notice tone="error">{t('rejected')}</Notice> : null}

      <section aria-labelledby={affiliateId} className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <SectionHeading id={affiliateId} title={t('affiliate.title')} />
          <p className="text-sm text-muted-foreground">{t('affiliate.intro')}</p>
        </div>

        <div className="flex flex-col gap-3">
          <h3 id={amazonId} className="text-base font-semibold">{t('amazon.title')}</h3>
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
        </div>

        <div className="flex flex-col gap-3">
          <h3 id={awinHeadingId} className="text-base font-semibold">{t('awin.title')}</h3>
          <p className="text-sm text-muted-foreground">{t('awin.intro')}</p>
          <Field label={t('awin.publisherId')} hint={t('awin.publisherIdHint')} error={awinId && !looksLikeAwinPublisherId(awinId) ? <>{t('awin.looksOff')} {t('awin.notSaved')}</> : undefined} className="sm:w-60">
            {(p) => (
              <TextInput
                {...p}
                value={awinId}
                readOnly={!editable}
                inputMode="numeric"
                maxLength={MAX_AWIN_ID_LENGTH}
                placeholder={t('awin.publisherIdPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => saveAwinId(e.target.value)}
              />
            )}
          </Field>

          <FieldLabel as="p">{t('awin.orderTitle')}</FieldLabel>
          <p className="text-sm text-muted-foreground">{t('awin.orderHint')}</p>
          <ul className="flex flex-col gap-3">
            {shops.order.map((id, n) => {
              const shop = shopById(id)
              return (
                <Panel as="li" key={id} {...drag.rowProps(id)} className={`relative ${drag.dragging === id ? 'opacity-50' : ''}`}>
                  <DropLine edge={drag.edge(id)} />
                  <div className="flex items-start gap-3">
                    {editable ? (
                      <DragGrip
                        label={t('awin.drag', { shop: shop.name, position: n + 1, total: shops.order.length })}
                        drag={drag.gripProps(id)}
                        onMove={(dir) => saveShops(moveShop(shops, id, dir))}
                      />
                    ) : null}
                    <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                      <div className="min-w-0">
                        <p className="pt-2.5 text-[0.9375rem] leading-6 font-medium break-words">{shop.name}</p>
                        {shop.provider === 'amazon' ? <p className="text-sm text-muted-foreground">{t('awin.amazonNote')}</p> : null}
                      </div>
                      {shop.provider === 'awin' ? renderShopControls(id) : null}
                    </div>
                  </div>
                </Panel>
              )
            })}
          </ul>

          {unapproved.length > 0 ? (
            <>
              <FieldLabel as="p">{t('awin.notApprovedTitle')}</FieldLabel>
              <p className="text-sm text-muted-foreground">{t('awin.shopsIntro')}</p>
              <ul className="flex flex-col gap-3">
                {unapproved.map((id) => (
                  <Panel as="li" key={id}>
                    <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                      <p className="min-w-0 pt-2.5 text-[0.9375rem] leading-6 font-medium break-words">{shopById(id).name}</p>
                      {renderShopControls(id)}
                    </div>
                  </Panel>
                ))}
              </ul>
            </>
          ) : null}
        </div>
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
