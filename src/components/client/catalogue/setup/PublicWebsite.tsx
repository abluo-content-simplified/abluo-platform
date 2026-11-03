'use client'

import { useId, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button, ButtonLink } from '@/components/app/ui/Button'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { Select } from '@/components/app/ui/Select'
import { Switch } from '@/components/app/ui/Switch'
import { TextInput } from '@/components/app/ui/TextInput'
import type { CatalogueSettingsView, SaveSettingsResult, SettingsSet } from '@/lib/modules/catalogue/settings/service'
import { loadCatalogueSettingsAction, saveCatalogueSettingsAction } from '@/app/[locale]/(client)/[tenant]/catalogue/setup/settings-actions'
import { labelPatch, labelsOf, type Labels } from './setup-model'
import { LabelFields, SetupHeader, useFailText, useSetupToast } from './setup-ui'

type CurrencyConfirm = NonNullable<SaveSettingsResult['confirmation']>['currency']

/** "Euro (EUR)" in the viewer's language. */
function currencyName(code: string, ui: string): string {
  try {
    const name = new Intl.DisplayNames([ui], { type: 'currency' }).of(code)
    return name && name !== code ? `${name} (${code})` : code
  } catch {
    return code
  }
}

/**
 * Catalogue → Setup → Public Website (spec §5.1, §10.8, C11, ADR-033 D7): the public name per
 * language (what the website calls the catalogue — Menu, Books, Wine List; the dashboard always
 * says "Catalogue"), the public web address segment (validated; older addresses keep
 * redirecting), the one currency (a change that reinterprets stored prices asks first — nothing
 * is converted), and whether new sections show prices. The time zone is shown; it is edited in
 * Settings.
 */
export function PublicWebsite({
  projectSlug,
  initial,
  backHref,
  currencies,
  timeZone,
  settingsHref,
  siteAddress,
}: {
  projectSlug: string
  initial: CatalogueSettingsView
  backHref: string
  currencies: readonly string[]
  timeZone: string | null
  settingsHref: string
  siteAddress: string | null
}) {
  const t = useTranslations('catalogue.setup.website')
  const tseg = useTranslations('catalogue.segment')
  const tcur = useTranslations('catalogue.currency')
  const ui = useLocale()
  const pricesId = useId()
  const [view, setView] = useState(initial)
  const [names, setNames] = useState<Labels>(() => labelsOf(initial.publicName, initial.locales))
  const [segment, setSegment] = useState(initial.publicSegment ?? '')
  const [segmentError, setSegmentError] = useState<string | null>(null)
  const [segmentNotice, setSegmentNotice] = useState<string | null>(null)
  const [currency, setCurrency] = useState(initial.currency ?? '')
  const [confirm, setConfirm] = useState<CurrencyConfirm | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useSetupToast()
  const failText = useFailText()

  async function refresh() {
    const r = await loadCatalogueSettingsAction({ projectSlug })
    if (r.ok) setView(r.settings)
    return r.ok ? r.settings : null
  }

  async function save(part: string, set: SettingsSet, ok: string, opts: { confirmCurrency?: boolean } = {}): Promise<SaveSettingsResult | null> {
    setBusy(part)
    const r = await saveCatalogueSettingsAction({ projectSlug, rev: view.rev, set, confirmCurrency: opts.confirmCurrency })
    setBusy(null)
    if (!r.ok) {
      if (r.error === 'conflict') await refresh()
      if (part === 'segment' && r.error === 'segment_invalid') setSegmentError(failText(r))
      else toast.show(failText(r), 'error')
      return null
    }
    if (r.saved) {
      await refresh()
      toast.show(ok)
    }
    return r
  }

  const namesPatch = labelPatch(labelsOf(view.publicName, view.locales), names)
  const namesChanged = Object.keys(namesPatch).length > 0
  // Data step D4 not run: the name shown is the legacy one; saving it (even unchanged) moves it to `publicName`.
  const namePending = !!view.pending?.publicName
  const segmentChanged = segment.trim() !== (view.publicSegment ?? '')
  const currencyChanged = currency !== (view.currency ?? '') && currency !== ''
  const earlier = view.publicSegmentHistory.filter((s) => s !== view.publicSegment)

  return (
    <div className="space-y-6">
      <SetupHeader title={t('title')} backHref={backHref} intro={t('intro')} />

      <Panel as="section" className="space-y-4">
        <div>
          <h2 className="text-[1.0625rem] font-semibold">{t('nameTitle')}</h2>
          <p className="mt-1 text-[0.9375rem] leading-6 text-muted-foreground">{t('nameIntro')}</p>
        </div>
        {namePending ? (
          <Notice tone="info" title={t('namePendingTitle')}>
            {t('namePendingBody')}
          </Notice>
        ) : null}
        <LabelFields locales={view.locales} defaultLocale={view.defaultLocale} value={names} onChange={setNames} label={t('name')} />
        <div className="flex flex-wrap items-start gap-2">
          <Button variant="primary" disabled={(!namesChanged && !namePending) || busy !== null} onClick={() => void save('name', { publicName: namesPatch }, t('nameSaved'))}>
            {t('saveName')}
          </Button>
          {!namesChanged && !namePending ? <p className="py-2.5 text-sm text-muted-foreground">{t('nothingChanged')}</p> : null}
        </div>
      </Panel>

      <Panel as="section" className="space-y-4">
        <div>
          <h2 className="text-[1.0625rem] font-semibold">{t('segmentTitle')}</h2>
          <p className="mt-1 text-[0.9375rem] leading-6 text-muted-foreground">{t('segmentIntro')}</p>
        </div>
        <Field
          label={tseg('label')}
          hint={segment.trim() ? t('segmentPreview', { address: `${siteAddress ?? t('yourWebsite')}/${segment.trim()}` }) : undefined}
          error={segmentError}
        >
          {(p) => (
            <TextInput
              {...p}
              value={segment}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => {
                setSegment(e.target.value)
                setSegmentError(null)
                setSegmentNotice(null)
              }}
            />
          )}
        </Field>
        {earlier.length ? <p className="text-sm text-muted-foreground">{t('segmentHistory', { segments: earlier.map((s) => `/${s}`).join(', ') })}</p> : null}
        {segmentNotice ? <Notice tone="info">{segmentNotice}</Notice> : null}
        <div className="flex flex-wrap items-start gap-2">
          <Button
            variant="primary"
            disabled={!segmentChanged || busy !== null}
            onClick={() =>
              void save('segment', { publicSegment: segment.trim() }, t('segmentSaved')).then((r) => {
                if (r?.saved) setSegmentNotice(r.notices?.segmentRevert ? tseg('revertNotice', { value: r.notices.segmentRevert }) : view.publicSegment ? tseg('redirectNotice') : null)
              })
            }
          >
            {t('saveSegment')}
          </Button>
          {!segmentChanged ? <p className="py-2.5 text-sm text-muted-foreground">{t('nothingChanged')}</p> : null}
        </div>
      </Panel>

      <Panel as="section" className="space-y-4">
        <div>
          <h2 className="text-[1.0625rem] font-semibold">{t('currencyTitle')}</h2>
          <p className="mt-1 text-[0.9375rem] leading-6 text-muted-foreground">{t('currencyIntro')}</p>
        </div>
        <Field label={tcur('label')}>
          {(p) => (
            <Select {...p} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {!view.currency ? <option value="">{t('chooseCurrency')}</option> : null}
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {currencyName(c, ui)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex flex-wrap items-start gap-2">
          <Button
            variant="primary"
            disabled={!currencyChanged || busy !== null}
            onClick={() =>
              void save('currency', { currency }, t('currencySaved', { currency })).then((r) => {
                if (r && !r.saved && r.confirmation) setConfirm(r.confirmation.currency)
              })
            }
          >
            {t('saveCurrency')}
          </Button>
          {!currencyChanged ? <p className="py-2.5 text-sm text-muted-foreground">{t('nothingChanged')}</p> : null}
        </div>
      </Panel>

      <Panel as="section" className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={pricesId} className="text-[1.0625rem] font-semibold">
              {t('pricesTitle')}
            </h2>
            <p className="mt-1 text-[0.9375rem] leading-6 text-muted-foreground">{t('pricesIntro')}</p>
          </div>
          <Switch
            checked={view.showPricesByDefault}
            labelledBy={pricesId}
            disabled={busy !== null}
            onChange={(next) => void save('prices', { showPricesByDefault: next }, next ? t('pricesOn') : t('pricesOff'))}
          />
        </div>
      </Panel>

      <Panel as="section" tone="muted" className="space-y-2">
        <h2 className="text-[1.0625rem] font-semibold">{t('timeZoneTitle')}</h2>
        <p className="text-[0.9375rem] leading-6">{timeZone ? t('timeZoneIs', { zone: timeZone }) : t('timeZoneMissing')}</p>
        <ButtonLink variant="link" href={settingsHref}>
          {t('timeZoneEdit')}
        </ButtonLink>
      </Panel>

      <ConfirmDialog
        open={!!confirm}
        title={t('currencyConfirmTitle', { from: confirm?.from ?? '', to: confirm?.to ?? '' })}
        body={confirm ? tcur('changeWarning', { prices: confirm.prices, items: confirm.items, currency: confirm.to }) + (confirm.optionDeltas ? ` ${tcur('changeWarningOptions', { count: confirm.optionDeltas })}` : '') : ''}
        confirmLabel={tcur('changeConfirm')}
        busy={busy === 'currency'}
        onConfirm={() => {
          const to = confirm?.to ?? currency
          void save('currency', { currency: to }, t('currencySaved', { currency: to }), { confirmCurrency: true }).then(() => setConfirm(null))
        }}
        onCancel={() => setConfirm(null)}
      />
      {toast.node}
    </div>
  )
}
