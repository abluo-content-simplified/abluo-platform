'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AppIcon } from '@/components/app/shell/AppIcon'
import { Button } from '@/components/app/ui/Button'
import { ChoiceCard, ChoiceCardGrid } from '@/components/app/ui/ChoiceCard'
import { ImpactPreview } from '@/components/app/ui/ImpactPreview'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { Skeleton } from '@/components/app/ui/Skeleton'
import type { PackSelection } from '@/lib/modules/catalogue/packs/plan'
import { getPack, listPacks } from '@/lib/modules/catalogue/packs/registry'
import type { StarterStructuresView } from '@/lib/modules/catalogue/packs/service'
import { applyPackAction, loadStarterStructuresAction } from '@/app/[locale]/(client)/[tenant]/catalogue/setup/starters/pack-actions'
import { SetupHeader, useFailText, useSetupToast } from '../setup-ui'
import { PackAvailabilityStep, PackChannelsStep, PackReviewStep, PackSettingsStep, PackSummaryStep, usePackPreview, useSummaryText } from './PackSteps'
import { defaultSelection, packText, planCounts } from './starters-model'

const PACK_ICON = 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12 4 7.5'

type Chosen = { packId: string; update: boolean }

/**
 * Catalogue → Setup → Starter Structures (spec §10.2, C7): the seven packs, an exact preview of
 * what one adds (and what is already there, what conflicts, what it changes for existing items),
 * the person's choices (channels, hours, what to leave out, renames, their own additions), a
 * confirmation before anything is written, the applied history and optional updates to newer
 * versions. Only people with the Setup permission open it (the route checks).
 */
export function StarterStructures({ projectSlug, initial, backHref }: { projectSlug: string; initial: StarterStructuresView; backHref: string }) {
  const t = useTranslations('catalogue.packs')
  const ts = useTranslations('catalogue.setup.starters')
  const te = useTranslations('catalogue.packs.errors')
  const ui = useLocale()
  const summaryText = useSummaryText()
  const failText = useFailText()
  const toast = useSetupToast()
  const [view, setView] = useState(initial)
  const [chosen, setChosen] = useState<Chosen | null>(null)
  const [selection, setSelection] = useState<PackSelection | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { preview, loading, error: previewError, replacePlan } = usePackPreview(projectSlug, chosen?.packId ?? null, selection, chosen?.update ?? false)
  const pack = chosen ? getPack(chosen.packId) : null
  const anyApplied = view.history.length > 0

  const open = (packId: string, update = false) => {
    const p = getPack(packId)
    if (!p) return
    setChosen({ packId, update })
    setSelection(defaultSelection(p))
    setError(null)
  }
  const close = () => {
    setChosen(null)
    setSelection(null)
    setConfirming(false)
    setError(null)
  }

  async function apply() {
    if (!pack || !preview || !selection) return
    setBusy(true)
    setError(null)
    const r = await applyPackAction({ projectSlug, packId: pack.id, version: pack.version, selection, planFingerprint: preview.plan.fingerprint, update: chosen?.update })
    setBusy(false)
    if (!r.ok) {
      if (r.detail?.plan) replacePlan(r.detail.plan)
      setConfirming(false)
      setError(r.error === 'pack_plan_changed' || r.error === 'pack_conflict' ? t('changed') : te.has(r.error) ? te(r.error) : failText(r))
      return
    }
    toast.show(pack.empty ? t('appliedEmpty') : t('applied', { name: packText(pack.name, ui) }))
    const fresh = await loadStarterStructuresAction({ projectSlug })
    if (fresh.ok) setView(fresh.view)
    close()
  }

  // ── preview mode ──
  if (chosen && pack && selection) {
    const plan = preview?.plan ?? null
    const blocked = !!plan?.conflicts.some((c) => c.blocking)
    const disabledReason = !preview ? t('loading') : blocked ? t('blockedReason') : null
    const step = { pack, selection, onChange: setSelection, defaultLocale: view.defaultLocale, locales: view.locales }
    const name = packText(pack.name, ui)
    return (
      <div className="space-y-6">
        <SetupHeader
          title={chosen.update ? t('updateTitle', { name, version: pack.version }) : t('previewTitle', { name })}
          intro={packText(pack.description, ui)}
          backHref={backHref}
          actions={
            <div className="flex flex-col items-end gap-1">
              <div className="flex gap-2">
                <Button variant="quiet" onClick={close}>
                  {t('back')}
                </Button>
                <Button variant="primary" disabled={!!disabledReason || busy} aria-describedby={disabledReason ? 'pack-apply-why' : undefined} onClick={() => setConfirming(true)}>
                  {chosen.update ? t('applyUpdate') : t('apply')}
                </Button>
              </div>
              {disabledReason ? (
                <p id="pack-apply-why" className="text-sm text-muted-foreground">
                  {disabledReason}
                </p>
              ) : null}
            </div>
          }
        />
        {error ? <Notice tone="error">{error}</Notice> : null}
        {previewError ? <Notice tone="error">{te.has(previewError.error) ? te(previewError.error) : failText(previewError)}</Notice> : null}
        {!preview ? (
          <div aria-busy="true" aria-label={t('loading')} className="space-y-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-40" />
          </div>
        ) : (
          <div className="space-y-8" aria-busy={loading || undefined}>
            <PackSummaryStep pack={pack} preview={preview} defaultLocale={view.defaultLocale} />
            <PackSettingsStep {...step} preview={preview} />
            <PackChannelsStep {...step} preview={preview} />
            <PackReviewStep {...step} preview={preview} />
            <PackAvailabilityStep {...step} preview={preview} />
          </div>
        )}
        {preview ? (
          <ImpactPreview
            open={confirming}
            title={t('confirmTitle', { name })}
            impact={preview.impact}
            confirmLabel={chosen.update ? t('applyUpdate') : t('apply')}
            busy={busy}
            error={error}
            onConfirm={() => void apply()}
            onCancel={() => setConfirming(false)}
            cancelLabel={t('cancel')}
          >
            <p className="text-[0.9375rem] leading-6">{t('confirmBody', { summary: summaryText(planCounts(preview.plan, pack)) })}</p>
            <p className="text-sm text-muted-foreground">{preview.currency ? t('currency', { currency: preview.currency }) : t('currencyNone')}</p>
          </ImpactPreview>
        ) : null}
        {toast.node}
      </div>
    )
  }

  // ── list mode ──
  const packs = listPacks().filter((p) => !(p.empty && anyApplied))
  const date = (iso: string) => (iso ? new Intl.DateTimeFormat(ui, { dateStyle: 'long' }).format(new Date(iso)) : '')
  return (
    <div className="space-y-8">
      <SetupHeader title={ts('title')} intro={t('intro')} backHref={backHref} />
      {view.interrupted.map((r) => {
        const p = getPack(r.packId)
        return p ? (
          <Notice
            key={`${r.packId}-${r.version}`}
            tone="info"
            title={t('interrupted', { name: packText(p.name, ui) })}
            action={
              <Button variant="secondary" onClick={() => open(p.id)}>
                {t('resume')}
              </Button>
            }
          />
        ) : null
      })}

      {view.offers.length ? (
        <section aria-labelledby="pack-updates" className="space-y-3">
          <SectionHeading id="pack-updates" title={t('updates')} />
          {view.offers.map((o) => {
            const p = getPack(o.id)!
            return (
              <Notice
                key={o.id}
                tone="neutral"
                action={
                  <Button variant="secondary" onClick={() => open(o.id, true)}>
                    {t('reviewUpdate')}
                  </Button>
                }
              >
                {t('updateOffer', { name: packText(p.name, ui), from: o.fromVersion, to: o.toVersion })}
              </Notice>
            )
          })}
        </section>
      ) : null}

      <section aria-labelledby="pack-choose" className="space-y-3">
        <SectionHeading id="pack-choose" title={t('choose')} />
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('chooseHelp')}</p>
        <ChoiceCardGrid label={t('choose')}>
          {packs.map((p) => (
            <ChoiceCard key={p.id} icon={<AppIcon d={PACK_ICON} size={28} />} label={packText(p.name, ui)} description={packText(p.description, ui)} onSelect={() => open(p.id)} />
          ))}
        </ChoiceCardGrid>
      </section>

      <section aria-labelledby="pack-history" className="space-y-3">
        <SectionHeading id="pack-history" title={t('history')} />
        {view.history.length ? (
          <Panel padding="none">
            <ul className="divide-y divide-border px-4">
              {view.history.map((h) => {
                const p = getPack(h.id)
                const kind = (k: string) => p?.collections.find((c) => c.key === k)?.collectionType ?? 'list'
                const counts = { channels: h.added.channels.length, categories: h.added.categories.length, tags: h.added.tags.length, menus: h.added.collections.filter((k) => kind(k) === 'menu').length, lists: h.added.collections.filter((k) => kind(k) === 'list').length, sections: h.added.sections.length, optionGroups: h.added.optionGroups.length, formats: h.added.formats.length, equivalent: 0 }
                return (
                  <li key={h.key} className="py-3">
                    <p className="text-[0.9375rem] leading-6 font-medium">{t('historyRow', { name: p ? packText(p.name, ui) : h.id, version: h.version })}</p>
                    <p className="text-sm text-muted-foreground">{h.legacy || !h.appliedAt ? t('historyLegacy') : t('historyDate', { date: date(h.appliedAt) })}</p>
                    {Object.values(counts).some((n) => n > 0) ? <p className="text-sm text-muted-foreground">{t('historyAdded', { summary: summaryText(counts) })}</p> : null}
                  </li>
                )
              })}
            </ul>
          </Panel>
        ) : (
          <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('historyEmpty')}</p>
        )}
      </section>
      {toast.node}
    </div>
  )
}
