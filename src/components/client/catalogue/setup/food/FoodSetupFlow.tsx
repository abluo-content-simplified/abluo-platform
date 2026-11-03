'use client'

import { useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AppIcon } from '@/components/app/shell/AppIcon'
import { Button } from '@/components/app/ui/Button'
import { ChoiceCard, ChoiceCardGrid } from '@/components/app/ui/ChoiceCard'
import { DialogFrame } from '@/components/app/ui/DialogFrame'
import { Notice } from '@/components/app/ui/Notice'
import { Skeleton } from '@/components/app/ui/Skeleton'
import { StepHeading } from '@/components/client/create/StepHeading'
import { defaultSelection, type PackSelection } from '@/lib/modules/catalogue/packs/plan'
import { foodStarterPacks, getPack } from '@/lib/modules/catalogue/packs/registry'
import { applyPackAction, previewPackAction } from '@/app/[locale]/(client)/[tenant]/catalogue/setup/starters/pack-actions'
import { useFailText } from '../setup-ui'
import { PackAvailabilityStep, PackChannelsStep, PackReviewStep, PackSummaryStep, usePackPreview } from '../starters/PackSteps'
import { packText } from '../starters/starters-model'

export type FoodSetupStep = 'starter' | 'channels' | 'review' | 'availability' | 'summary'
const ALL_STEPS: readonly FoodSetupStep[] = ['starter', 'channels', 'review', 'availability', 'summary']
const PACK_ICON = 'M4 11h16M6 11V8a6 6 0 0 1 12 0v3M5 11l1 9h12l1-9'

/** The steps for a choice: Empty goes straight to the summary (nothing to choose). */
export const foodSetupSteps = (packId: string | null): readonly FoodSetupStep[] => (packId && getPack(packId)?.empty ? ['starter', 'summary'] : ALL_STEPS)

/**
 * The contextual food-and-drink setup (brief §6, D-14): opened from item creation when someone
 * chooses "Food or drink" and Catalogue setup was never completed. Built from the Setup pack
 * steps: (1) where to start (a restaurant starter or Empty), (2) service channels — suggestions
 * stay off until ticked, (3) review categories / tags / menus / sections / formats / option lists
 * with rename, untick and add, (4) category × channel availability, (5) the summary and create.
 *
 * Set up now applies the chosen pack in one transaction; Start empty applies Empty (setup complete,
 * nothing added); Save and exit records nothing. Either way the person returns to the SAME item
 * draft (this is an overlay above it; the draft is never unmounted) with Food or drink still chosen.
 */
export function FoodSetupFlow({ open, projectSlug, defaultLocale, locales, onDone, onExit }: { open: boolean; projectSlug: string; defaultLocale: string; locales: readonly string[]; onDone: (how: 'pack' | 'empty') => void; onExit: () => void }) {
  const t = useTranslations('catalogue.foodSetup')
  const tp = useTranslations('catalogue.packs')
  const te = useTranslations('catalogue.packs.errors')
  const ui = useLocale()
  const failText = useFailText()
  const [packId, setPackId] = useState<string | null>(null)
  const [selection, setSelection] = useState<PackSelection | null>(null)
  const [step, setStep] = useState<FoodSetupStep>('starter')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const packs = useMemo(() => foodStarterPacks(), [])
  const pack = packId ? getPack(packId) : null
  const { preview, replacePlan } = usePackPreview(projectSlug, packId, selection)
  const steps = foodSetupSteps(packId)
  const index = Math.max(0, steps.indexOf(step))
  const last = index === steps.length - 1

  const go = (s: FoodSetupStep) => {
    setStep(s)
    setError(null)
    mainRef.current?.scrollTo?.({ top: 0 })
  }
  const choose = (id: string) => {
    const p = getPack(id)
    if (!p) return
    setPackId(id)
    setSelection(defaultSelection(p))
  }

  const fail = (r: { ok: false; error: string; detail?: { plan?: unknown } }) => {
    if (r.detail?.plan) replacePlan(r.detail.plan as never)
    setError(r.error === 'pack_plan_changed' || r.error === 'pack_conflict' ? tp('changed') : te.has(r.error) ? te(r.error) : failText(r as never))
  }

  async function setUp() {
    if (!pack || !preview || !selection) return
    setBusy(true)
    setError(null)
    const r = await applyPackAction({ projectSlug, packId: pack.id, version: pack.version, selection, planFingerprint: preview.plan.fingerprint })
    setBusy(false)
    if (!r.ok) return fail(r)
    onDone(pack.empty ? 'empty' : 'pack')
  }

  /** "Start empty" from any step: applies Empty with its own exact preview. */
  async function startEmpty() {
    const empty = packs.find((p) => p.empty)
    if (!empty) return
    setBusy(true)
    setError(null)
    const sel = defaultSelection(empty)
    const p = await previewPackAction({ projectSlug, packId: empty.id, selection: sel })
    const r = p.ok ? await applyPackAction({ projectSlug, packId: empty.id, version: empty.version, selection: sel, planFingerprint: p.preview.plan.fingerprint }) : p
    setBusy(false)
    if (!r.ok) return fail(r)
    onDone('empty')
  }

  const blocked = !!preview?.plan.conflicts.some((c) => c.blocking)
  const reason = !packId ? t('chooseFirst') : !preview ? tp('loading') : last && blocked ? tp('blockedReason') : null
  const stepProps = pack && preview && selection ? { pack, preview, selection, onChange: setSelection, defaultLocale, locales } : null
  const heading = (key: 'starter' | 'channels' | 'review' | 'availability' | 'summary') => <StepHeading id="food-setup-step" title={t(`${key}Title`)} helper={t(`${key}Help`)} />

  return (
    <DialogFrame open={open} onClose={onExit} labelledBy="food-setup-title" className="m-0 h-dvh max-h-dvh w-full max-w-none bg-background p-0 text-foreground backdrop:bg-overlay">
      <div className="flex h-full flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 md:px-8">
          <div className="min-w-0">
            <h2 id="food-setup-title" className="text-lg leading-7 font-semibold">
              {t('title')}
            </h2>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {t('progress', { current: index + 1, total: steps.length })} · {t(`steps.${step}`)}
            </p>
          </div>
          <Button variant="secondary" onClick={onExit} disabled={busy}>
            {t('saveExit')}
          </Button>
        </header>

        <div ref={mainRef} className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
          <section aria-labelledby="food-setup-step" className="mx-auto w-full max-w-3xl space-y-6">
            {step === 'starter' ? (
              <>
                {heading('starter')}
                <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('intro')}</p>
                <ChoiceCardGrid kind="radio" label={t('starterTitle')}>
                  {packs.map((p) => (
                    <ChoiceCard key={p.id} icon={<AppIcon d={PACK_ICON} size={28} />} label={packText(p.name, ui)} description={packText(p.description, ui)} selected={packId === p.id} onSelect={() => choose(p.id)} />
                  ))}
                </ChoiceCardGrid>
              </>
            ) : !stepProps ? (
              <div aria-busy="true" aria-label={tp('loading')} className="space-y-3">
                <Skeleton className="h-16" />
                <Skeleton className="h-40" />
              </div>
            ) : step === 'channels' ? (
              <>
                {heading('channels')}
                <PackChannelsStep {...stepProps} />
              </>
            ) : step === 'review' ? (
              <>
                {heading('review')}
                <PackReviewStep {...stepProps} />
              </>
            ) : step === 'availability' ? (
              <>
                {heading('availability')}
                <PackAvailabilityStep {...stepProps} />
              </>
            ) : (
              <>
                {heading('summary')}
                {pack?.empty ? <p className="text-[0.9375rem] leading-6">{t('emptyChosen')}</p> : <PackSummaryStep pack={stepProps.pack} preview={stepProps.preview} defaultLocale={defaultLocale} />}
              </>
            )}
            {error ? <Notice tone="error">{error}</Notice> : null}
          </section>
        </div>

        <footer className="border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-8">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-2">
              {index > 0 ? (
                <Button variant="quiet" onClick={() => go(steps[index - 1])} disabled={busy}>
                  {t('back')}
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => void startEmpty()} disabled={busy}>
                {t('startEmpty')}
              </Button>
            </div>
            <div className="flex flex-col items-stretch gap-1 sm:items-end">
              <Button variant="primary" disabled={!!reason || busy} aria-busy={busy || undefined} aria-describedby={reason ? 'food-setup-why' : undefined} onClick={() => (last ? void setUp() : go(steps[index + 1]))}>
                {busy ? t('working') : last ? t('setUpNow') : t('next')}
              </Button>
              {reason ? (
                <p id="food-setup-why" className="text-sm text-muted-foreground">
                  {reason}
                </p>
              ) : null}
            </div>
          </div>
        </footer>
      </div>
    </DialogFrame>
  )
}
