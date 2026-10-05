'use client'

import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslations } from 'next-intl'
import type { PortableTextBlock } from '@portabletext/editor'
import { useRouter } from '@/i18n/navigation'
import { patchPostDraftAction } from '@/app/[locale]/(client)/[tenant]/posts/actions'
import { improvePostBodyAction } from '@/app/[locale]/(client)/[tenant]/posts/ai-actions'
import { publishPostDraftAction } from '@/app/[locale]/(client)/[tenant]/posts/publish-actions'
import { useAutosave } from '@/lib/client/autosave/use-autosave'
import type { PendingSet } from '@/lib/client/autosave/journal'
import {
  canAdvance,
  canPublish,
  coverNeedsAlt,
  laterStep,
  progressSteps,
  resumeTarget,
  wizardSteps,
  type OverviewSection,
  type WizardFlowStep,
} from '@/lib/client/wizard-steps'
import type { DraftSnapshot, SiteInfo, StepProps } from './types'
import { SavePill } from './SavePill'
import { applyToSnapshot } from './snapshot'
import { CategoryStep } from './steps/CategoryStep'
import { TitleStep } from './steps/TitleStep'
import { StoryStep, type ImproveResult } from './steps/StoryStep'
import { CoverStep } from './steps/CoverStep'
import { LanguagesStep, type LanguageChoice } from './steps/LanguagesStep'
import { PreviewStep } from './steps/PreviewStep'
import { PublishStep, isoToLocalInput, localToIso, type PublishChoice } from './steps/PublishStep'
import { DoneStep, type DoneResult } from './steps/DoneStep'
import { ReviewStep } from './steps/ReviewStep'

const IMPROVE_ERRORS = ['forbidden', 'invalid_value', 'too_large', 'ai_unavailable', 'unauthenticated', 'failed']
const PUBLISH_ERRORS = [
  'missing_title',
  'missing_body',
  'invalid_schedule',
  'invalid_expiry',
  'conflict',
  'forbidden',
  'not_found',
  'unauthenticated',
  'offline',
  'failed',
]

/**
 * The guided creation flow for a blog post (ADR-025 · S2c). Full-screen, one
 * question per screen, on the Create surface. Owns: the step order, the
 * autosave engine (SavePill, never a Save button), Back/Next, Save & exit, and
 * the publish action. Steps are dumb (see ./types.ts).
 */
export function WizardShell({
  draft: initialDraft,
  site,
  homeHref,
}: {
  draft: DraftSnapshot
  site: SiteInfo
  homeHref: string
}) {
  const t = useTranslations('clientDashboard.create')
  const router = useRouter()
  const projectSlug = site.projectSlug
  const locale = site.defaultLocale

  const [snap, setSnap] = useState<DraftSnapshot>(initialDraft)
  const steps = useMemo(() => wizardSteps(site), [site])
  const segments = useMemo(() => progressSteps(steps), [steps])
  const [step, setStep] = useState<WizardFlowStep | null>(null)
  /** True when a single step was opened from the overview: its main button is "Done". */
  const [editing, setEditing] = useState(false)
  /** Next was pressed on the cover step while the photo has no description: CoverStep shows why. */
  const [altNeeded, setAltNeeded] = useState(false)
  const furthestRef = useRef(initialDraft.furthest ?? initialDraft.step)
  const [choices, setChoices] = useState<Record<string, LanguageChoice>>(() =>
    Object.fromEntries(
      site.languages
        .filter((l) => l !== locale)
        .map((l) => [l, initialDraft.title[l]?.trim() || (initialDraft.body[l]?.length ?? 0) > 0 ? 'write' : 'later'])
    )
  )
  const [publish, setPublish] = useState<PublishChoice>(() => {
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000)
    tomorrow.setHours(9, 0, 0, 0)
    const later = new Date(tomorrow.getTime() + 30 * 24 * 3600 * 1000)
    return { mode: 'now', at: isoToLocalInput(tomorrow), expire: false, expireAt: isoToLocalInput(later) }
  })
  const [publishError, setPublishError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<DoneResult | null>(null)
  const finished = useRef(false)
  const mainRef = useRef<HTMLDivElement>(null)

  const send = useCallback(
    async (input: { rev: string; set: PendingSet }) => {
      const r = await patchPostDraftAction({ projectSlug, id: initialDraft.id, rev: input.rev, set: input.set })
      return r.ok ? ({ ok: true, rev: r.rev } as const) : ({ ok: false, error: r.error } as const)
    },
    [projectSlug, initialDraft.id]
  )
  // Replay anything the journal kept (a closed tab, lost signal) BEFORE showing a step.
  const onReady = useCallback(
    (replayed: PendingSet | null) => {
      const merged = replayed ? applyToSnapshot(initialDraft, replayed) : initialDraft
      setSnap(merged)
      furthestRef.current = laterStep(merged.step, merged.furthest ?? merged.step)
      setStep((current) => current ?? resumeTarget({ step: merged.step, furthest: furthestRef.current }, steps))
    },
    [initialDraft, steps]
  )
  const autosave = useAutosave({ draftId: initialDraft.id, rev: initialDraft.rev, send, onReady })

  const update = useCallback(
    (set: Record<string, unknown>) => {
      if (finished.current) return
      setSnap((s) => applyToSnapshot(s, set))
      autosave.set(set)
    },
    [autosave]
  )

  /** Moves to a step and saves the position (and how far the first pass got). */
  const go = useCallback(
    (next: WizardFlowStep, opts: { editing?: boolean } = {}) => {
      setStep(next)
      setEditing(Boolean(opts.editing))
      setAltNeeded(false)
      setPublishError(null)
      if (next !== 'done') {
        const set: Record<string, unknown> = { 'wizard.step': next }
        const furthest = laterStep(furthestRef.current, next)
        if (furthest !== furthestRef.current) {
          furthestRef.current = furthest
          set['wizard.furthest'] = furthest
        }
        update(set)
      }
      mainRef.current?.scrollTo?.({ top: 0 })
    },
    [update]
  )

  const index = step && step !== 'review' ? steps.indexOf(step) : 0
  const goNext = useCallback(() => {
    if (editing) return go('review')
    const next = steps[index + 1]
    if (next && next !== 'done') go(next)
  }, [steps, index, go, editing])
  const goBack = useCallback(() => {
    if (editing) return go('review')
    const prev = steps[index - 1]
    if (prev) go(prev)
  }, [steps, index, go, editing])
  const openSection = useCallback((section: OverviewSection['id']) => go(section, { editing: true }), [go])

  const saveAndExit = useCallback(async () => {
    await autosave.flush()
    router.push(homeHref)
  }, [autosave, router, homeHref])

  const reload = useCallback(async () => {
    await autosave.discard()
    window.location.reload()
  }, [autosave])

  const flushForStep = useCallback(async () => ((await autosave.flush()) ? autosave.currentRev() : null), [autosave])
  const onServerWrite = useCallback(
    (change: { rev: string } & Partial<Omit<DraftSnapshot, 'id' | 'rev'>>) => {
      autosave.adoptRev(change.rev)
      setSnap((s) => ({ ...s, ...change }))
    },
    [autosave]
  )

  const onImprove = useCallback(
    async (blocks: PortableTextBlock[]): Promise<ImproveResult> => {
      try {
        const r = await improvePostBodyAction({ projectSlug, locale, blocks })
        if (r.ok) return { ok: true, blocks: r.blocks as PortableTextBlock[] }
        const code = IMPROVE_ERRORS.includes(r.error) ? r.error : 'failed'
        return { ok: false, error: t(`improve.errors.${code}`) }
      } catch {
        return { ok: false, error: t('improve.errors.failed') }
      }
    },
    [projectSlug, locale, t]
  )

  const publishError_ = (code: string) => t(`publish.errors.${PUBLISH_ERRORS.includes(code) ? code : 'failed'}`)

  async function runPublish() {
    if (busy) return
    setPublishError(null)
    if (publish.mode === 'draft') {
      setBusy(true)
      await autosave.flush()
      setBusy(false)
      setDone({ kind: 'draft' })
      setStep('done')
      return
    }
    const publishAt = publish.mode === 'schedule' ? localToIso(publish.at) : undefined
    if (publish.mode === 'schedule' && !publishAt) return setPublishError(publishError_('invalid_schedule'))
    const expiresAt = publish.expire ? localToIso(publish.expireAt) : null
    if (publish.expire && !expiresAt) return setPublishError(publishError_('invalid_expiry'))

    setBusy(true)
    try {
      const saved = await autosave.flush()
      if (!saved) {
        setPublishError(publishError_(autosave.currentState() === 'conflict' ? 'conflict' : 'offline'))
        return
      }
      const r = await publishPostDraftAction({
        projectSlug,
        id: initialDraft.id,
        rev: autosave.currentRev(),
        mode: publish.mode,
        publishAt: publishAt ?? undefined,
        expiresAt,
      })
      if (!r.ok) {
        setPublishError(publishError_(r.error))
        return
      }
      finished.current = true
      await autosave.discard()
      const slug = r.slugs[locale]
      const url = site.origin && slug ? `${site.origin}/${locale}/blog/${slug}` : null
      setDone(publish.mode === 'schedule' ? { kind: 'scheduled', at: r.publishedAt } : { kind: 'live', url })
      setStep('done')
    } catch {
      setPublishError(publishError_(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'failed'))
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (e.defaultPrevented || target.closest('dialog')) return
    if (e.key === 'Escape' && step !== 'done') {
      e.preventDefault()
      void saveAndExit()
    } else if (e.key === 'Enter' && !e.shiftKey && (target.matches('[data-enter-next]') || target === e.currentTarget)) {
      if (step && step !== 'publish' && step !== 'review' && step !== 'done' && canAdvance(step, snap, locale)) {
        e.preventDefault()
        goNext()
      }
    }
  }

  const props: StepProps = {
    draft: snap,
    site,
    locale,
    update,
    goNext,
    goBack,
    flush: flushForStep,
    onServerWrite,
  }

  const ready = step !== null
  const onReview = step === 'review'
  const canNext =
    ready &&
    step !== 'done' &&
    !busy &&
    // The cover step stays pressable so a missing description can be explained (D).
    (onReview ? canPublish(snap, locale) : step === 'cover' || canAdvance(step, snap, locale))
  const segmentIndex = step ? segments.indexOf(step as WizardFlowStep) : 0
  const showProgress = !editing && !onReview
  const nextLabel =
    step === 'publish'
      ? busy
        ? t('publish.working')
        : t(`publish.action.${publish.mode}`)
      : onReview
        ? t('review.publish')
        : editing
          ? t('shell.done')
          : step === 'cover' && !snap.cover
            ? t('shell.skip')
            : t('shell.next')
  const onPrimary =
    step === 'publish'
      ? runPublish
      : onReview
        ? () => go('publish', { editing: true })
        : step === 'cover' && coverNeedsAlt(snap, locale)
          ? () => setAltNeeded(true)
          : goNext
  const blockedHint = onReview && !canPublish(snap, locale) ? t('review.publishNeeds') : null
  // The languages step shows the original next to the translation from md up.
  const wide = step === 'languages'
  const hasBack = editing ? step === 'publish' : !onReview && index > 0

  return (
    <div
      data-surface="create"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[60] flex flex-col bg-background text-foreground"
    >
      <header className="mx-auto flex w-full max-w-[672px] items-center justify-between gap-3 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-2">
        {step !== 'done' ? (
          <button
            type="button"
            onClick={saveAndExit}
            className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-[15px] font-semibold text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t('shell.saveExit')}
          </button>
        ) : (
          <span />
        )}
        <SavePill state={autosave.state} onReload={reload} />
      </header>

      <div ref={mainRef} className="flex-1 overflow-y-auto">
        <main className={`mx-auto flex min-h-full w-full flex-col px-4 pt-6 pb-10 ${wide ? 'max-w-5xl' : 'max-w-[672px]'}`}>
          {!ready ? null : step === 'review' ? (
            <ReviewStep {...props} onEdit={openSection} onPreview={() => go('preview', { editing: true })} />
          ) : step === 'category' ? (
            <CategoryStep {...props} />
          ) : step === 'title' ? (
            <TitleStep {...props} />
          ) : step === 'story' ? (
            <StoryStep {...props} onImprove={onImprove} />
          ) : step === 'cover' ? (
            <CoverStep {...props} altNeeded={altNeeded} onCoverChange={(cover) => setSnap((s) => ({ ...s, cover }))} />
          ) : step === 'languages' ? (
            <LanguagesStep {...props} choices={choices} onChoice={(l, c) => setChoices((s) => ({ ...s, [l]: c }))} />
          ) : step === 'preview' ? (
            <PreviewStep {...props} />
          ) : step === 'publish' ? (
            <PublishStep {...props} choice={publish} onChange={setPublish} error={publishError} />
          ) : done ? (
            <DoneStep result={done} homeHref={homeHref} />
          ) : null}
        </main>
      </div>

      {ready && step !== 'done' ? (
        <footer className="border-t border-border-subtle bg-background pb-[max(12px,env(safe-area-inset-bottom))]">
          <div className={`mx-auto w-full px-4 pt-3 ${wide ? 'max-w-5xl' : 'max-w-[672px]'}`}>
            {blockedHint ? (
              <p role="status" className="mb-3 text-[15px] leading-6 text-muted-foreground">
                {blockedHint}
              </p>
            ) : null}
            {showProgress ? (
            <div
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={segments.length}
              aria-valuenow={segmentIndex + 1}
              aria-label={t('shell.progress', { current: segmentIndex + 1, total: segments.length })}
              className="flex gap-1.5"
            >
              {segments.map((s, i) => (
                <span key={s} className={`h-1 flex-1 rounded-full ${i <= segmentIndex ? 'bg-foreground' : 'bg-muted'}`} />
              ))}
            </div>
            ) : null}
            <div className={`flex items-center justify-between gap-4 ${showProgress ? 'mt-3' : ''}`}>
              {hasBack ? (
                <button
                  type="button"
                  onClick={goBack}
                  disabled={busy}
                  className="inline-flex min-h-11 items-center px-1 text-[17px] font-semibold text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
                >
                  {t('shell.back')}
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={onPrimary}
                disabled={!canNext}
                aria-busy={busy || undefined}
                className="inline-flex h-14 min-w-32 items-center justify-center rounded-xl bg-action px-8 text-[17px] font-semibold text-action-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
              >
                {nextLabel}
              </button>
            </div>
          </div>
        </footer>
      ) : null}
    </div>
  )
}
