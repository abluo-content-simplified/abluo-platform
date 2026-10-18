'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { PostActivitySheet } from '@/components/client/posts/PostActivitySheet'
import { useLocale, useTranslations } from 'next-intl'
import type { PortableTextBlock } from '@portabletext/editor'
import { useRouter } from '@/i18n/navigation'
import { createPostDraftAction, patchPostDraftAction } from '@/app/[locale]/(client)/[tenant]/posts/actions'
import { improvePostBodyAction, improvePostLineAction } from '@/app/[locale]/(client)/[tenant]/posts/ai-actions'
import { publishPostDraftAction } from '@/app/[locale]/(client)/[tenant]/posts/publish-actions'
import {
  archivePostAction,
  deletePostDraftAction,
  deletePublishedPostAction,
  discardPostChangesAction,
  putPostBackOnlineAction,
  restorePostAction,
  setPostDatesAction,
  takePostOfflineAction,
} from '@/app/[locale]/(client)/[tenant]/posts/lifecycle-actions'
import { useAutosave } from '@/lib/client/autosave/use-autosave'
import type { PendingSet } from '@/lib/client/autosave/journal'
import { POST_CONTENT, routePreDraft } from '@/lib/client/lazy-draft'
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
import { pickerLabel, type PickerTerm } from '@/components/client/taxonomy/term-picker-model'
import { applyToSnapshot } from './snapshot'
import { CategoryStep } from './steps/CategoryStep'
import { TitleStep, type ImproveLineResult } from './steps/TitleStep'
import { StoryStep, type ImproveResult } from './steps/StoryStep'
import { CoverStep } from './steps/CoverStep'
import { LanguagesStep, type LanguageChoice } from './steps/LanguagesStep'
import { PreviewStep } from './steps/PreviewStep'
import { PublishStep } from './steps/PublishStep'
import { choiceValue, defaultPublishChoice, type PublishChoice } from './steps/publish-choice-model'
import { datesSentence, publishChoiceDates, shortMoment } from '@/components/app/lifecycle/publish-plan'
import { PublicationDates } from '@/components/app/lifecycle/PublicationDates'
import { WizardFooter } from './WizardFooter'
import { WizardHeader } from './WizardHeader'
import { DoneStep, type DoneResult } from './steps/DoneStep'
import { ReviewStep } from './steps/ReviewStep'
import { CtaStep } from './steps/CtaStep'
import { GalleryPickStep } from './steps/GalleryPickStep'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { DeletePermanentlyDialog } from '@/components/app/lifecycle/DeletePermanentlyDialog'
import { lifecycleMenu, type LifecycleAction, type LifecycleMenuEntry } from '@/components/app/lifecycle/lifecycle-menu'
import { editingZone, formatInZone } from '@/components/app/lifecycle/zoned-time'
import { publishedStatus } from '@/lib/lifecycle/status'

const LIFECYCLE_ERRORS = ['conflict', 'forbidden', 'not_found', 'invalid_value', 'archived', 'archive_first', 'in_use', 'unauthenticated', 'failed']
type Confirm = 'discard' | 'deleteDraft' | 'deletePost'

const IMPROVE_ERRORS = ['forbidden', 'invalid_value', 'too_large', 'ai_unavailable', 'unauthenticated', 'failed']
const PUBLISH_ERRORS = [
  'missing_title',
  'missing_body',
  'invalid_schedule',
  'invalid_expiry',
  'conflict',
  'forbidden',
  'not_found',
  'archived',
  'unauthenticated',
  'offline',
  'failed',
]

/**
 * The guided creation flow for a blog post (ADR-025 · S2c). Full-screen, one
 * question per screen, on the Create surface. Owns: the step order, the
 * autosave engine (SavePill, never a Save button), Back/Next, Save & exit, and
 * the publish action. Steps are dumb (see ./types.ts).
 *
 * Lazy creation: opened with an empty `draft.id` ("+ Add content" →
 * /posts/write/new), no document exists until the first real content (a title
 * or story text); the first save creates the draft and the URL becomes
 * /posts/write/<id> without a reload. Until then the top-left is a round ×
 * that leaves nothing behind.
 */
export function WizardShell({
  draft: initialDraft,
  site: initialSite,
  homeHref,
  postsHref,
  canDelete = false,
  aiImprove = false,
}: {
  draft: DraftSnapshot
  site: SiteInfo
  homeHref: string
  /** The posts list, where Discard / Delete land. */
  postsHref: string
  /** Owner holding blog.post.delete (the server re-checks). */
  canDelete?: boolean
  /** AI_FEATURES includes 'improve' (server-side flag, ADR-026 D6). Off → "Coming soon". */
  aiImprove?: boolean
}) {
  const t = useTranslations('clientDashboard.create')
  const tl = useTranslations('app.lifecycle')
  const tp = useTranslations('app.lifecycle.publish')
  const ui = useLocale()
  const router = useRouter()
  // Categories created inline (Category step) join the site's list, so the Review step shows their names.
  const [addedCategories, setAddedCategories] = useState<PickerTerm[]>([])
  const site = useMemo<SiteInfo>(() => {
    const fresh = addedCategories.filter((c) => !initialSite.categories.some((x) => x.value === c.value))
    if (fresh.length === 0) return initialSite
    return {
      ...initialSite,
      categories: [...initialSite.categories, ...fresh.map((c) => ({ value: c.value, label: pickerLabel(c, ui, initialSite.defaultLocale) }))],
      categoryTerms: initialSite.categoryTerms ? [...initialSite.categoryTerms, ...fresh.filter((c) => !initialSite.categoryTerms!.some((x) => x.value === c.value))] : initialSite.categoryTerms,
    }
  }, [initialSite, addedCategories, ui])
  const addCategory = useCallback((term: PickerTerm) => setAddedCategories((a) => (a.some((x) => x.value === term.value) ? a : [...a, term])), [])
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
  /** A new cover photo still on its way (CoverStep, ADR-035). */
  const [coverPending, setCoverPending] = useState(false)
  const furthestRef = useRef(initialDraft.furthest ?? initialDraft.step)
  const [choices, setChoices] = useState<Record<string, LanguageChoice>>(() =>
    Object.fromEntries(
      site.languages
        .filter((l) => l !== locale)
        .map((l) => [l, initialDraft.title[l]?.trim() || (initialDraft.body[l]?.length ?? 0) > 0 ? 'write' : 'later'])
    )
  )
  const [publish, setPublish] = useState<PublishChoice>(() => defaultPublishChoice())
  const [publishError, setPublishError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<DoneResult | null>(null)
  const finished = useRef(false)
  const isEdit = initialDraft.mode === 'edit'
  const [live, setLive] = useState(initialDraft.live ?? null)
  const [notice, setNotice] = useState<{ kind: 'status' | 'error'; text: string } | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [activityOpen, setActivityOpen] = useState(false)
  /** Edit mode: the copy differs from the live version — the Update bar shows only then. */
  const [hasChanges, setHasChanges] = useState(Boolean(initialDraft.hasChanges))
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  /** The draft's id; '' until the first content creates it (lazy creation). */
  const draftIdRef = useRef(initialDraft.id)
  const [created, setCreated] = useState(Boolean(initialDraft.id))
  /** Changes made before any content exists (a topic, the step) — sent with the first content. */
  const heldRef = useRef<PendingSet>({})
  /** True once the first content went to the engine: from then on nothing is held (the engine creates the draft). */
  const contentSentRef = useRef(Boolean(initialDraft.id))
  /**
   * The journal key the engine STARTS with. A new post journals under a
   * temporary key until it is created; then the journal moves to the real id
   * (`rekey`), so reopening /posts/write/<id> replays what was not saved yet.
   */
  const [journalKey] = useState(() => initialDraft.id || `new-post:${Math.random().toString(36).slice(2)}`)
  const rekeyRef = useRef<(key: string) => Promise<void>>(async () => undefined)

  const send = useCallback(
    async (input: { rev: string; set: PendingSet }) => {
      let rev = input.rev
      if (!draftIdRef.current) {
        const c = await createPostDraftAction({ projectSlug })
        if (!c.ok) return { ok: false, error: c.error === 'forbidden' || c.error === 'unauthenticated' ? c.error : 'failed' } as const
        draftIdRef.current = c.id
        rev = c.rev
        // Move everything journaled under the temporary key to the real id, before the first patch.
        await rekeyRef.current(c.id)
        setCreated(true)
        setSnap((s) => ({ ...s, id: c.id }))
        // The address becomes the draft's own, without remounting the wizard.
        try {
          window.history.replaceState(window.history.state, '', window.location.pathname.replace(/\/new\/?$/, `/${c.id}`) + window.location.search)
        } catch {
          /* ignore */
        }
      }
      const r = await patchPostDraftAction({ projectSlug, id: draftIdRef.current, rev, set: input.set })
      // A content change (not just the wizard's position) is something to Update with.
      if (r.ok && Object.keys(input.set).some((k) => !k.startsWith('wizard.'))) setHasChanges(true)
      return r.ok ? ({ ok: true, rev: r.rev } as const) : ({ ok: false, error: r.error } as const)
    },
    [projectSlug]
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
  const autosave = useAutosave({ draftId: journalKey, rev: initialDraft.rev, send, onReady })
  const { rekey } = autosave
  useEffect(() => {
    rekeyRef.current = rekey
  }, [rekey])

  const update = useCallback(
    (set: Record<string, unknown>) => {
      if (finished.current) return
      setSnap((s) => applyToSnapshot(s, set))
      if (draftIdRef.current || contentSentRef.current) {
        // Anything still held goes along — a held change is never dropped.
        const held = heldRef.current
        heldRef.current = {}
        return autosave.set({ ...held, ...set })
      }
      // No draft yet: hold everything until the first real content creates it.
      const routed = routePreDraft(heldRef.current, set, POST_CONTENT)
      heldRef.current = routed.held
      if (routed.send) {
        contentSentRef.current = true
        autosave.set(routed.send)
      }
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
  /** Nothing saved yet: just leave (no draft is created). */
  const closeEmpty = useCallback(() => router.push(homeHref), [router, homeHref])

  const reload = useCallback(async () => {
    await autosave.discard()
    window.location.reload()
  }, [autosave])

  const flushForStep = useCallback(async () => ((await autosave.flush()) ? autosave.currentRev() : null), [autosave])
  const onServerWrite = useCallback(
    (change: { rev: string } & Partial<Omit<DraftSnapshot, 'id' | 'rev'>>) => {
      autosave.adoptRev(change.rev)
      setSnap((s) => ({ ...s, ...change }))
      if (Object.keys(change).some((k) => k !== 'rev')) setHasChanges(true)
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

  /** "Improve title" / "Improve subtitle" (same gating and review as Improve on the story). */
  const onImproveLine = useCallback(
    async (field: 'title' | 'subtitle', text: string): Promise<ImproveLineResult> => {
      try {
        const r = await improvePostLineAction({ projectSlug, locale, field, text, title: snap.title[locale] ?? '' })
        if (r.ok) return { ok: true, text: r.text }
        const code = IMPROVE_ERRORS.includes(r.error) ? r.error : 'failed'
        return { ok: false, error: t(`improve.errors.${code}`) }
      } catch {
        return { ok: false, error: t('improve.errors.failed') }
      }
    },
    [projectSlug, locale, t, snap.title]
  )

  const publishError_ = (code: string) => t(`publish.errors.${PUBLISH_ERRORS.includes(code) ? code : 'failed'}`)

  async function runPublish(override?: 'keep') {
    if (busy) return
    setPublishError(null)
    setNotice(null)
    if (override === 'keep') return runUpdate()
    if (publish.mode === 'draft') {
      setBusy(true)
      await autosave.flush()
      setBusy(false)
      setDone({ kind: 'draft' })
      setStep('done')
      return
    }
    // Schedule with From = now is a plain publish (with its Until).
    const { mode, publishAt, expiresAt } = publishChoiceDates(choiceValue(publish))
    if (mode === 'draft') return
    if (publish.mode === 'schedule' && publish.expire && !expiresAt) return setPublishError(publishError_('invalid_expiry'))

    setBusy(true)
    try {
      const saved = await autosave.flush()
      if (!saved) {
        setPublishError(publishError_(autosave.currentState() === 'conflict' ? 'conflict' : 'offline'))
        return
      }
      const r = await publishPostDraftAction({
        projectSlug,
        id: draftIdRef.current,
        rev: autosave.currentRev(),
        mode,
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
      setDone(mode === 'schedule' ? { kind: 'scheduled', at: r.publishedAt } : { kind: 'live', url })
      setStep('done')
    } catch {
      setPublishError(publishError_(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'failed'))
    } finally {
      setBusy(false)
    }
  }

  /** "Update post": publishes the draft over the live post, keeping its dates and URLs. */
  async function runUpdate() {
    setBusy(true)
    const fail = (text: string) => setNotice({ kind: 'error', text })
    try {
      const saved = await autosave.flush()
      if (!saved) return fail(publishError_(autosave.currentState() === 'conflict' ? 'conflict' : 'offline'))
      const r = await publishPostDraftAction({ projectSlug, id: draftIdRef.current, rev: autosave.currentRev(), mode: 'keep' })
      if (!r.ok) return fail(publishError_(r.error))
      finished.current = true
      await autosave.discard()
      const isLive = live ? publishedStatus(live, 'required', new Date()) === 'published' : true
      const slug = r.slugs[locale]
      const url = isLive && site.origin && slug ? `${site.origin}/${locale}/blog/${slug}` : null
      setDone({ kind: 'updated', live: isLive, url })
      setStep('done')
    } catch {
      fail(publishError_(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'failed'))
    } finally {
      setBusy(false)
    }
  }

  const lifecycleError = (code: string) => t(`lifecycle.errors.${LIFECYCLE_ERRORS.includes(code) ? code : 'failed'}`)

  async function setOnline(online: boolean) {
    if (!live || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const action = online ? putPostBackOnlineAction : takePostOfflineAction
      const r = await action({ projectSlug, id: draftIdRef.current, rev: live.rev })
      if (!r.ok) return setNotice({ kind: 'error', text: lifecycleError(r.error) })
      setLive(r.live)
      setNotice({ kind: 'status', text: online ? t('lifecycle.publishedAgainDone') : t('lifecycle.unpublishedDone') })
    } catch {
      setNotice({ kind: 'error', text: lifecycleError('failed') })
    } finally {
      setBusy(false)
    }
  }

  /** ADR-032 D6: Archive (off the website, kept) and Restore (back as unpublished). */
  async function setArchived(archive: boolean) {
    if (!live || busy) return
    setBusy(true)
    setNotice(null)
    try {
      // Archive / Restore change the draft too: send queued edits first, then
      // adopt the draft's new revision so the next save, update or discard is
      // not refused as "changed elsewhere".
      await autosave.flush()
      const action = archive ? archivePostAction : restorePostAction
      const r = await action({ projectSlug, id: draftIdRef.current, rev: live.rev })
      if (!r.ok) return setNotice({ kind: 'error', text: lifecycleError(r.error) })
      if (r.draftRev) autosave.adoptRev(r.draftRev)
      setLive(r.live)
      setNotice({ kind: 'status', text: archive ? t('lifecycle.archivedDone') : t('lifecycle.restoredDone') })
    } catch {
      setNotice({ kind: 'error', text: lifecycleError('failed') })
    } finally {
      setBusy(false)
    }
  }

  /**
   * The overview's Publication block: when the post is on the website. Applies
   * at once on both versions (setPostDatesAction) — the draft's text stays a
   * draft until Update post.
   */
  async function saveDates(next: { from: string | null; until: string | null }) {
    if (!live || busy) return
    const keepStart = next.from !== null && next.from === live.publishedAt
    setBusy(true)
    setNotice(null)
    try {
      await autosave.flush()
      const r = await setPostDatesAction({
        projectSlug,
        id: draftIdRef.current,
        rev: live.rev,
        ...(keepStart ? {} : { publishedAt: next.from ?? 'now' }),
        expiresAt: next.until,
      })
      if (!r.ok) return setNotice({ kind: 'error', text: lifecycleError(r.error) })
      if (r.draftRev) autosave.adoptRev(r.draftRev)
      setLive(r.live)
      setNotice({ kind: 'status', text: t('review.dates.saved') })
    } catch {
      setNotice({ kind: 'error', text: lifecycleError('failed') })
    } finally {
      setBusy(false)
    }
  }

  async function runConfirm() {
    if (!confirm || confirmBusy) return
    setConfirmBusy(true)
    setConfirmError(null)
    try {
      let r: { ok: boolean; error?: string }
      if (confirm === 'deletePost') {
        if (!live) return
        r = await deletePublishedPostAction({ projectSlug, id: draftIdRef.current, rev: live.rev })
      } else {
        // Both remove the draft itself: send whatever is queued first, then use its latest rev.
        await autosave.flush()
        const action = confirm === 'discard' ? discardPostChangesAction : deletePostDraftAction
        r = await action({ projectSlug, id: draftIdRef.current, rev: autosave.currentRev() })
      }
      if (!r.ok) return setConfirmError(lifecycleError(r.error ?? 'failed'))
      finished.current = true
      await autosave.discard()
      router.push(postsHref)
    } catch {
      setConfirmError(lifecycleError('failed'))
    } finally {
      setConfirmBusy(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (e.defaultPrevented || target.closest('dialog')) return
    if (e.key === 'Escape' && step !== 'done') {
      e.preventDefault()
      if (created) void saveAndExit()
      else closeEmpty()
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
    addCategory,
    flush: flushForStep,
    onServerWrite,
  }

  // ADR-032 D4 / D8: the one status function; dates in the site's time zone.
  const state = live ? publishedStatus(live, 'required', new Date()) : null
  const zone = editingZone(site.timeZone)
  const fmt = (iso: string | null | undefined) => formatInZone(iso, zone, locale)
  // Not archived: the Publication block says where the post stands (and changes it).
  const showDates = isEdit && !!live && !!state && state !== 'archived'
  const statusLine = !isEdit || !live || !state || showDates
    ? null
    : state === 'archived'
      ? t('review.status.archived', { date: fmt(live.archivedAt) })
      : state === 'unpublished'
        ? t('review.status.unpublished', { date: fmt(live.expiresAt) })
        : t(`review.status.${state}`, { date: fmt(live.publishedAt) })
  // ADR-032 slice 6: the shared Archive · Restore · Delete pattern (lifecycleMenu);
  // an archived post offers only Restore and, for Owners and Site admins, Delete permanently.
  const sentenceOf = (dates: { publishedAt: string | null; expiresAt: string | null }) => {
    const sv = datesSentence(dates)
    const m = (iso?: string) => (iso ? tp('moment', shortMoment(iso, zone, ui)) : '')
    return tp(sv.key, { start: m(sv.start), end: m(sv.end) })
  }
  const publication = showDates && live ? (
    <PublicationDates
      id="post-dates"
      from={live.publishedAt}
      until={live.expiresAt}
      zone={zone}
      busy={busy}
      fromNote={state === 'published' ? t('review.dates.fromNote') : undefined}
      onChange={(next) => void saveDates(next)}
      sentence={sentenceOf(live)}
    />
  ) : null
  const lifecycleItems = lifecycleMenu(isEdit && state ? state : 'draft', { write: true, delete: true, deletePublished: canDelete })
  const lifecycleItem = (e: LifecycleMenuEntry) => {
    const on: Record<LifecycleAction, () => void> = {
      unpublish: () => void setOnline(false),
      publishAgain: () => void setOnline(true),
      setUnpublishDate: () => go('publish', { editing: true }),
      archive: () => void setArchived(true),
      restore: () => void setArchived(false),
      delete: () => setConfirm('deleteDraft'),
      deletePermanently: () => setConfirm('deletePost'),
    }
    const label = e.action === 'setUnpublishDate' ? t('menu.changeDate') : tl(`actions.${e.action}`)
    return { key: e.action, label, onSelect: on[e.action], destructive: e.destructive, separated: e.separated }
  }
  const extras = isEdit
    ? [
        { key: 'discard', label: t('menu.discard'), onSelect: () => setConfirm('discard') },
        { key: 'activity', label: t('menu.activity'), onSelect: () => setActivityOpen(true) },
      ]
    : []
  const menu = [
    // Dates are changed in the overview's Publication block, not from the menu.
    ...lifecycleItems.filter((e) => !e.destructive && e.action !== 'archive' && e.action !== 'setUnpublishDate').map(lifecycleItem),
    ...extras,
    ...lifecycleItems.filter((e) => e.action === 'archive').map(lifecycleItem),
    ...lifecycleItems.filter((e) => e.destructive).map(lifecycleItem),
  ]
  const postTitle = snap.title[locale]?.trim() || t('review.title')

  const ready = step !== null
  const onReview = step === 'review'
  // ADR-035: a new cover still uploading / optimising holds the step (its description is being written meanwhile).
  const holdForCover = step === 'cover' && coverPending
  const canNext =
    ready &&
    step !== 'done' &&
    !busy &&
    !holdForCover &&
    // The cover step stays pressable so a missing description can be explained (D).
    (onReview ? canPublish(snap, locale) : step === 'cover' || canAdvance(step, snap, locale))
  const segmentIndex = step ? segments.indexOf(step as WizardFlowStep) : 0
  const showProgress = !editing && !onReview
  const nextLabel =
    step === 'publish'
      ? busy
        ? t('publish.working')
        : t(`publish.action.${publishChoiceDates(choiceValue(publish)).mode}`)
      : onReview
        ? isEdit
          ? busy
            ? t('review.updating')
            : t('review.update')
          : t('review.publish')
        : holdForCover
          ? t('shell.finishingPhoto')
          : editing
          ? t('shell.done')
          : step === 'cover' && !snap.cover
            ? t('shell.skip')
            : t('shell.next')
  const onPrimary =
    step === 'publish'
      ? runPublish
      : onReview
        ? isEdit
          ? () => void runPublish('keep')
          : () => go('publish', { editing: true })
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
      data-portal-root
      className="fixed inset-0 z-[60] flex flex-col bg-background text-foreground"
    >
      <WizardHeader
        exit={step === 'done' ? null : created ? { kind: 'save', onPress: saveAndExit } : { kind: 'close', onPress: closeEmpty }}
        saveState={autosave.state}
        rejected={autosave.rejected}
        onRetry={autosave.retry}
        onReload={reload}
      />

      <div ref={mainRef} className="flex-1 overflow-y-auto">
        <main className={`mx-auto flex min-h-full w-full flex-col px-4 pt-6 pb-10 ${wide ? 'max-w-5xl' : 'max-w-[672px]'}`}>
          {!ready ? null : step === 'review' ? (
            <ReviewStep
              {...props}
              onEdit={openSection}
              onPreview={() => go('preview', { editing: true })}
              menu={menu}
              status={statusLine}
              notice={notice}
              publication={publication}
            />
          ) : step === 'category' ? (
            <CategoryStep {...props} />
          ) : step === 'title' ? (
            <TitleStep {...props} onImproveLine={aiImprove ? onImproveLine : undefined} />
          ) : step === 'story' ? (
            <StoryStep {...props} onImprove={aiImprove ? onImprove : undefined} />
          ) : step === 'cover' ? (
            <CoverStep {...props} altNeeded={altNeeded} onPendingChange={setCoverPending} onCoverChange={(cover) => setSnap((s) => ({ ...s, cover }))} />
          ) : step === 'cta' ? (
            <CtaStep {...props} />
          ) : step === 'gallery' ? (
            <GalleryPickStep {...props} />
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

      {ready && step !== 'done' && !(onReview && isEdit && !hasChanges) ? (
        <WizardFooter
          wide={wide}
          hint={blockedHint}
          progress={showProgress ? { current: segmentIndex + 1, total: segments.length } : null}
          back={hasBack ? { onPress: goBack, disabled: busy || holdForCover } : null}
          primary={{ label: nextLabel, onPress: () => void onPrimary(), disabled: !canNext, busy }}
        />
      ) : null}

      <PostActivitySheet open={activityOpen} onClose={() => setActivityOpen(false)} projectSlug={projectSlug} postId={snap.id} />

      <DeletePermanentlyDialog
        open={confirm === 'deletePost'}
        titles={[postTitle]}
        busy={confirmBusy}
        error={confirmError}
        onConfirm={() => void runConfirm()}
        onCancel={() => {
          setConfirm(null)
          setConfirmError(null)
        }}
      />
      <ConfirmDialog
        open={confirm !== null && confirm !== 'deletePost'}
        title={confirm ? t(`confirm.${confirm}Title`) : ''}
        body={confirm ? t(`confirm.${confirm}Body`, { title: postTitle }) : ''}
        confirmLabel={confirm ? t(`confirm.${confirm}`) : ''}
        busy={confirmBusy}
        error={confirmError}
        onConfirm={() => void runConfirm()}
        onCancel={() => {
          setConfirm(null)
          setConfirmError(null)
        }}
      />
    </div>
  )
}
