'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import type { TestimonialPrivateRead, TestimonialSnapshot, TestimonialState } from '@/lib/api/testimonials'
import { TESTIMONIAL_SOURCES, type TestimonialLocalizedField, type TestimonialSource } from '@/lib/modules/testimonials/model'
import {
  discardTestimonialDraftAction,
  getTestimonialAction,
  openTestimonialForEditAction,
  publishTestimonialDraftAction,
  saveTestimonialDraftAction,
  testimonialLifecycleAction,
} from '@/app/[locale]/(client)/[tenant]/testimonials/actions'
import { saveTestimonialPrivateAction, translateTestimonialFieldsAction } from '@/app/[locale]/(client)/[tenant]/testimonials/editor-actions'
import { useAutosave } from '@/lib/client/autosave/use-autosave'
import type { PendingSet } from '@/lib/client/autosave/journal'
import { openThenSave } from '@/lib/client/autosave/open-then-save'
import { formatTranslateMessage, getTranslateMessages } from '@/lib/i18n/translate-messages'
import { effectiveStatus, isWritableTarget, type TranslationMeta } from '@/lib/translate/status'
import { PhotoSource } from '@/components/client/media/PhotoSource'
import { TermPicker } from '@/components/client/taxonomy/TermPicker'
import type { PickerTerm } from '@/components/client/taxonomy/term-picker-model'
import { DeletePermanentlyDialog } from '@/components/app/lifecycle/DeletePermanentlyDialog'
import { AssistButton } from '@/components/app/ui/AssistButton'
import { BackLink } from '@/components/app/ui/BackLink'
import { Button } from '@/components/app/ui/Button'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { CheckboxCard } from '@/components/app/ui/CheckboxCard'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { DateInput } from '@/components/app/ui/DateInput'
import { Field } from '@/components/app/ui/Field'
import { MediaFrame } from '@/components/app/ui/list/cells'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Panel } from '@/components/app/ui/Panel'
import { SaveNotice } from '@/components/app/ui/SaveNotice'
import { SavePill } from '@/components/app/ui/SavePill'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { Select } from '@/components/app/ui/Select'
import { Switch } from '@/components/app/ui/Switch'
import { TextArea, TextInput } from '@/components/app/ui/TextInput'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { ICONS, TESTIMONIAL_UI_LIMITS, TestimonialStateBadge, useLanguageName } from './testimonial-bits'
import { TestimonialActivitySheet } from './TestimonialActivitySheet'

type Values = {
  displayName: string
  anonymous: boolean
  context: Record<string, string>
  abstract: Record<string, string>
  body: Record<string, string>
  translations: Record<TestimonialLocalizedField, Record<string, TranslationMeta>>
  originalLocale: string
  rating: number | null
  givenOn: string
  source: TestimonialSource
  sourceUrl: string
  age: string
  tags: string[]
  permissionToPublish: boolean
  featured: boolean
  photo: { assetId: string; url: string | null } | null
}

type Priv = { available: boolean; fullName: string; email: string; phone: string; note: string; state: 'idle' | 'saving' | 'saved' | 'error' }
type PrivPatch = { fullName?: string | null; email?: string | null; phone?: string | null; note?: string | null }

type Confirm = 'discard' | 'delete' | 'deletePermanently' | null

const FIELDS: readonly TestimonialLocalizedField[] = ['context', 'abstract', 'body']
const PERMISSION_ANCHOR = 'testimonial-permission'

function valuesOf(s: TestimonialSnapshot): Values {
  return {
    displayName: s.displayName,
    anonymous: s.anonymous,
    context: s.context,
    abstract: s.abstract,
    body: s.body,
    translations: s.translations,
    originalLocale: s.originalLocale ?? '',
    rating: s.rating,
    givenOn: s.givenOn ?? '',
    source: s.source,
    sourceUrl: s.sourceUrl,
    age: s.age === null ? '' : String(s.age),
    tags: s.tags,
    permissionToPublish: s.permissionToPublish,
    featured: s.featured,
    photo: s.photo,
  }
}

/**
 * The testimonial editor (ADR-048 D9) — one page, autosaved to the draft
 * (platform rule: incomplete drafts always save; there is no Save button).
 *
 *   The testimonial   context · short version · full text, with a language
 *                     switch over the site's languages and the Translate button
 *   Who said it       display name + Anonymous · age · rating (optional) · date
 *                     given · written in · source + link · tags
 *   Publishing        Featured · Permission to publish (the one tick; Publish
 *                     stays off until it is set — and says so, with a link)
 *   Private details   full name · email · phone · note — only with
 *                     testimonials.private.read, saved straight to the private
 *                     store (never through the draft), calm notice while the
 *                     store is not set up yet
 *
 * Publish · Discard changes · Unpublish / Back online · Archive / Restore ·
 * Delete · Activity are in the header and the ⋯ menu. Unpublish and Archive
 * answer with "… · Undo"; deleting always asks first. The first edit of a
 * published testimonial opens its draft (from the browser — never on GET).
 */
export function TestimonialEditor({
  projectSlug,
  initial,
  initialPrivate,
  tagTerms,
  canWrite = true,
  canDelete = false,
  canAddTag = false,
  canTranslate = false,
  createdFrom = null,
}: {
  projectSlug: string
  initial: TestimonialSnapshot
  /** null = the person may not see the private details (no panel). */
  initialPrivate: TestimonialPrivateRead | null
  tagTerms: PickerTerm[]
  /** testimonials.write (the server re-checks). Without it the editor is read-only. */
  canWrite?: boolean
  canDelete?: boolean
  canAddTag?: boolean
  /** The Translate module is installed on this project (the server re-checks, with testimonials.write). */
  canTranslate?: boolean
  /** Arrived from "Create testimonial" on a submission. */
  createdFrom?: 'submission' | 'submission-no-consent' | null
}) {
  const t = useTranslations('clientDashboard.testimonials.editor')
  const te = useTranslations('clientDashboard.testimonials.errors')
  const tl = useTranslations('app.lifecycle')
  const router = useRouter()
  const uiLocale = useLocale()
  const languageName = useLanguageName()
  const id = initial.id
  const listHref = `/${projectSlug}/testimonials`

  const languages = initial.site.languages.length ? initial.site.languages : [initial.site.defaultLocale]
  const d = initial.site.defaultLocale || languages[0]

  // ── State ──────────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<{ state: TestimonialState; hasDraft: boolean; isPublished: boolean; hasChanges: boolean }>({
    state: initial.status,
    hasDraft: initial.hasDraft,
    isPublished: initial.isPublished,
    hasChanges: initial.hasChanges,
  })
  const [values, setValues] = useState<Values>(() => valuesOf(initial))
  const valuesRef = useRef(values)
  const [lang, setLang] = useState(d)
  const [pickingPhoto, setPickingPhoto] = useState(false)
  /** A server draft exists (decides whether the next save must open one first). */
  const hasDraftRef = useRef(initial.hasDraft)

  const archived = status.state === 'archived'
  const editable = canWrite && !archived

  const privateShown = initialPrivate !== null
  const privAvailable = initialPrivate?.available === true
  const privRow = initialPrivate?.available ? initialPrivate.row : null
  const [priv, setPriv] = useState<Priv>({
    available: privAvailable,
    fullName: privRow?.fullName ?? '',
    email: privRow?.email ?? '',
    phone: privRow?.phone ?? '',
    note: privRow?.note ?? '',
    state: 'idle',
  })
  const privVersion = useRef<number | null>(privRow?.version ?? null)
  const privPending = useRef<PrivPatch>({})
  const privTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const privChain = useRef<Promise<boolean>>(Promise.resolve(true))

  /** Shows a server snapshot. `keepValues`: edits typed meanwhile are still being saved — keep what is on screen. */
  const apply = useCallback((s: TestimonialSnapshot, keepValues = false) => {
    hasDraftRef.current = s.hasDraft
    setStatus({ state: s.status, hasDraft: s.hasDraft, isPublished: s.isPublished, hasChanges: s.hasChanges })
    if (keepValues) return
    const next = valuesOf(s)
    valuesRef.current = next
    setValues(next)
  }, [])

  // ── Autosave (public text → draft) ─────────────────────────────────────────
  const send = useCallback(
    // A published testimonial: the first change opens the draft (an exact
    // copy); a save failing right after hands the opened revision to the engine.
    (input: { rev: string; set: PendingSet }) =>
      openThenSave(input, {
        hasDraft: () => hasDraftRef.current,
        markDraft: () => {
          hasDraftRef.current = true
        },
        open: () => openTestimonialForEditAction({ projectSlug, id }),
        save: (rev, set) => saveTestimonialDraftAction({ projectSlug, id, rev, set }),
      }),
    [projectSlug, id]
  )
  /** Set once useAutosave exists (below). */
  const engineRef = useRef<{ exclusive: ReturnType<typeof useAutosave>['exclusive']; hasPending: () => boolean } | null>(null)
  /**
   * Reads the testimonial back with no autosave sent meanwhile (after a
   * flush) and continues from the revision read — '' when there is no draft
   * (the next change opens one). Archive / restore / discard change the
   * draft's revision; before, a reload adopted the read's revision even when a
   * save had landed during the read (→ "edited elsewhere"), and wiped edits
   * typed meanwhile.
   */
  const reload = useCallback(async () => {
    const engine = engineRef.current
    if (!engine) return false
    let snap: TestimonialSnapshot | null = null
    const out = await engine.exclusive(async () => {
      const r = await getTestimonialAction({ projectSlug, id })
      if (!r.ok) return { value: null }
      snap = r.testimonial
      return { value: null, rev: r.testimonial.rev }
    })
    if (!out.ok || !snap) return false
    apply(snap, engine.hasPending())
    return true
  }, [projectSlug, id, apply])
  /** A tab closed mid-save is replayed by the engine; once it lands, show what the server now holds. */
  const [replayed, setReplayed] = useState(false)
  const onReady = useCallback((r: PendingSet | null) => {
    if (r && Object.keys(r).length) setReplayed(true)
  }, [])
  const autosave = useAutosave({ draftId: `testimonial:${id}`, rev: initial.rev, send, onReady })
  const { exclusive, hasPending } = autosave
  useEffect(() => {
    engineRef.current = { exclusive, hasPending }
  }, [exclusive, hasPending])
  const flushEngine = autosave.flush
  useEffect(() => {
    if (!replayed) return
    let live = true
    void (async () => {
      if ((await flushEngine()) && live) await reload()
    })()
    return () => {
      live = false
    }
  }, [replayed, flushEngine, reload])

  /** Every public change goes through here: shown at once, autosaved after a pause. */
  const save = (set: PendingSet) => {
    if (!editable) return
    setStatus((s) => (s.hasDraft ? s : { ...s, hasDraft: true, hasChanges: s.isPublished, state: s.isPublished ? s.state : 'draft' }))
    autosave.set(set)
  }
  const change = (patch: Partial<Values>, set?: PendingSet) => {
    if (!editable) return
    const next = { ...valuesRef.current, ...patch }
    valuesRef.current = next
    setValues(next)
    if (set) save(set)
  }
  const setText = (field: TestimonialLocalizedField, value: string) => {
    const cur = valuesRef.current
    change({ [field]: { ...cur[field], [lang]: value } } as Partial<Values>, { [`${field}.${lang}`]: value })
  }

  // ── Private details: saved directly, a moment after typing ─────────────────
  const [notice, setNotice] = useState<string | null>(null)
  const errorText = (code: string) => (te.has(code) ? te(code) : te('failed'))
  const flushPrivate = useCallback((): Promise<boolean> => {
    if (privTimer.current) clearTimeout(privTimer.current)
    privTimer.current = null
    privChain.current = privChain.current.then(async () => {
      const set = privPending.current
      if (!Object.keys(set).length) return true
      privPending.current = {}
      try {
        const r = await saveTestimonialPrivateAction({ projectSlug, id, version: privVersion.current, set })
        if (!r.ok) {
          privPending.current = { ...set, ...privPending.current }
          setPriv((p) => ({ ...p, state: 'error' }))
          setNotice(te.has(r.error) ? te(r.error) : te('failed'))
          return false
        }
        privVersion.current = r.row.version
        setPriv((p) => ({ ...p, state: Object.keys(privPending.current).length ? 'saving' : 'saved' }))
        return true
      } catch {
        privPending.current = { ...set, ...privPending.current }
        setPriv((p) => ({ ...p, state: 'error' }))
        setNotice(te('failed'))
        return false
      }
    })
    return privChain.current
    // te only reads translations
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug, id])
  const changePrivate = (key: keyof PrivPatch, value: string) => {
    if (!editable || !priv.available) return
    setPriv((p) => ({ ...p, [key]: value, state: 'saving' }))
    privPending.current = { ...privPending.current, [key]: value }
    if (privTimer.current) clearTimeout(privTimer.current)
    privTimer.current = setTimeout(() => void flushPrivate(), 800)
  }
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void flushPrivate()
    }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', onHidden)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', onHidden)
      void flushPrivate()
    }
  }, [flushPrivate])

  // ── Translate (ADR-023) ────────────────────────────────────────────────────
  const { toast, show } = useUndo()
  const [translating, setTranslating] = useState(false)
  /** The language the text was written in, when it has text there; else the site's main language. */
  const sourceLocale = values.originalLocale && languages.includes(values.originalLocale) && FIELDS.some((f) => (values[f][values.originalLocale] ?? '').trim()) ? values.originalLocale : d
  const canTranslateHere = canTranslate && editable && languages.length > 1
  async function translateFields() {
    if (translating || !canTranslateHere) return
    const tm = getTranslateMessages(uiLocale)
    const fields = FIELDS.filter((f) => (valuesRef.current[f][sourceLocale] ?? '').trim())
    if (!fields.length) return setNotice(formatTranslateMessage(tm.nothingToTranslate, { source: languageName(sourceLocale) }))
    setTranslating(true)
    setNotice(null)
    try {
      // The server translates the SAVED text: get everything typed onto the server first.
      if (!(await flushed())) return
      const r = await translateTestimonialFieldsAction({ projectSlug, id, fields, sourceLocale })
      if (!r.ok) {
        const code = r.error as string
        return setNotice(code in tm.errors ? tm.errors[code as keyof typeof tm.errors] : errorText(code))
      }
      const filled = new Set<string>()
      for (const field of fields) {
        for (const [loc, { text, meta }] of Object.entries(r.results[field] ?? {})) {
          // Typed into while the request was in flight: leave it alone.
          const cur = valuesRef.current
          if (!isWritableTarget(cur[field][loc] ?? '', cur.translations[field][loc])) continue
          change(
            { [field]: { ...cur[field], [loc]: text }, translations: { ...cur.translations, [field]: { ...cur.translations[field], [loc]: meta } } } as Partial<Values>,
            { [`${field}.${loc}`]: text, [`translation.${field}.${loc}`]: meta }
          )
          filled.add(loc)
        }
      }
      show({
        message: filled.size ? formatTranslateMessage(tm.translated, { targets: [...filled].map((l) => l.toUpperCase()).join(', ') }) : tm.allTargetsProtected,
        tone: 'status',
      })
    } catch {
      setNotice(te('failed'))
    } finally {
      setTranslating(false)
    }
  }
  const machineHere = lang !== sourceLocale && FIELDS.some((f) => effectiveStatus(values[f][lang], values.translations[f][lang]) === 'machine')

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  const [activity, setActivity] = useState(false)
  const [busy, setBusy] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [fromNotice, setFromNotice] = useState(createdFrom !== null)
  const [permissionMissing, setPermissionMissing] = useState(false)

  /** Everything typed is on the server (or say why not). */
  const flushed = async (): Promise<boolean> => {
    if (await autosave.flush()) return true
    setNotice(te(autosave.currentState() === 'conflict' ? 'conflict' : 'offline'))
    return false
  }
  /** Scroll to the "Permission to publish" tick and focus it. */
  const goToPermission = () => {
    const el = document.getElementById(PERMISSION_ANCHOR)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    el.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
  }

  const hasText = Object.values(values.body).some((v) => v.trim())
  const displayName = values.anonymous ? t('anonymous') : values.displayName.trim() || t('untitled')
  const needsPermission = !values.permissionToPublish
  const reasons: string[] = []
  if (editable && status.state !== 'archived') {
    if (!status.hasDraft) reasons.push(t('publishReason.upToDate'))
    else {
      if (!hasText) reasons.push(t('publishReason.noText'))
    }
  }
  // The missing tick is named on its own line, with a link to it.
  const showPermissionReason = editable && status.hasDraft && needsPermission
  const publishDisabled = busy || !editable || reasons.length > 0 || needsPermission

  async function publish() {
    if (busy || publishDisabled) return
    setBusy(true)
    setPublishing(true)
    setNotice(null)
    try {
      if (!(await flushPrivate())) return
      // Flush, then publish with the confirmed revision while no autosave is
      // sent; the draft is gone afterwards (rev ''), so anything typed
      // meanwhile opens a fresh draft instead of hitting the deleted one.
      const out = await autosave.exclusive<Awaited<ReturnType<typeof publishTestimonialDraftAction>>>(async (rev) => {
        const res = await publishTestimonialDraftAction({ projectSlug, id, rev })
        if (res.ok) hasDraftRef.current = false
        return res.ok ? { value: res, rev: '' } : { value: res }
      })
      if (!out.ok) return setNotice(te(autosave.currentState() === 'conflict' ? 'conflict' : 'offline'))
      const r = out.value
      if (!r.ok) {
        if (r.error === 'permission_required') {
          setPermissionMissing(true)
          goToPermission()
          return
        }
        return setNotice(errorText(r.error))
      }
      const typedMeanwhile = autosave.hasPending()
      setStatus((s) => ({ ...s, hasDraft: typedMeanwhile, hasChanges: typedMeanwhile, isPublished: true, state: 'published' }))
      show({ message: t('published'), tone: 'status' })
      router.refresh()
    } catch {
      setNotice(te('failed'))
    } finally {
      setBusy(false)
      setPublishing(false)
    }
  }

  async function runConfirm() {
    if (!confirm || busy) return
    setBusy(true)
    setConfirmError(null)
    try {
      if (confirm === 'discard') {
        await autosave.flush()
        const r = await discardTestimonialDraftAction({ projectSlug, id, rev: autosave.currentRev() })
        if (!r.ok) return setConfirmError(errorText(r.error))
        await autosave.discard()
        await reload()
        setConfirm(null)
        show({ message: t('discarded'), tone: 'status' })
        return
      }
      const op = confirm === 'delete' ? 'deleteDraft' : 'deletePermanently'
      const r = await testimonialLifecycleAction({ projectSlug, id, op })
      if (!r.ok) return setConfirmError(errorText(r.error))
      await autosave.discard()
      setConfirm(null)
      router.push(listHref)
    } catch {
      setConfirmError(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  type Op = 'unpublish' | 'backOnline' | 'archive' | 'restore'
  async function lifecycle(op: Op, undoOp?: Op) {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      if ((op === 'archive' || op === 'unpublish') && !(await flushed())) return
      const wasLive = status.isPublished && status.state !== 'unpublished'
      const r = await testimonialLifecycleAction({ projectSlug, id, op })
      if (!r.ok) {
        if (r.error === 'permission_required') {
          setPermissionMissing(true)
          goToPermission()
          return
        }
        return setNotice(errorText(r.error))
      }
      await reload()
      show(
        {
          message: t(`done.${op}`),
          tone: 'status',
          ...(undoOp && {
            undo: () => {
              show(null)
              void (async () => {
                await testimonialLifecycleAction({ projectSlug, id, op: undoOp })
                // Archived a live testimonial and changed their mind: it comes back online too.
                if (op === 'archive' && wasLive) await testimonialLifecycleAction({ projectSlug, id, op: 'backOnline' })
                await reload()
                router.refresh()
              })()
            },
          }),
        },
        8000
      )
      router.refresh()
    } catch {
      setNotice(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  const live = status.isPublished && !archived
  const lifecycleItems: CardMenuItem[] = !canWrite
    ? []
    : archived
      ? [
          { key: 'restore', label: tl('actions.restore'), onSelect: () => void lifecycle('restore') },
          ...(canDelete ? [{ key: 'deletePermanently', label: tl('actions.deletePermanently'), onSelect: () => setConfirm('deletePermanently'), destructive: true, separated: true }] : []),
        ]
      : [
          ...(live && status.state === 'unpublished' ? [{ key: 'backOnline', label: t('menu.backOnline'), onSelect: () => void lifecycle('backOnline', 'unpublish') }] : []),
          ...(live && status.state !== 'unpublished' ? [{ key: 'unpublish', label: tl('actions.unpublish'), onSelect: () => void lifecycle('unpublish', 'backOnline') }] : []),
          { key: 'archive', label: tl('actions.archive'), onSelect: () => void lifecycle('archive', 'restore') },
          ...(!status.isPublished ? [{ key: 'delete', label: tl('actions.delete'), onSelect: () => setConfirm('delete'), destructive: true, separated: true }] : []),
        ]
  const menu: CardMenuItem[] = [
    ...(editable && status.isPublished && status.hasDraft ? [{ key: 'discard', label: t('menu.discard'), onSelect: () => setConfirm('discard') }] : []),
    { key: 'activity', label: t('menu.activity'), onSelect: () => setActivity(true) },
    ...lifecycleItems,
  ]

  // ── Render ─────────────────────────────────────────────────────────────────
  const U = TESTIMONIAL_UI_LIMITS
  const ratingOptions = [1, 2, 3, 4, 5]
  const publishButton = editable ? (
    <Button variant="primary" disabled={publishDisabled} aria-describedby={showPermissionReason || reasons.length ? 'testimonial-publish-reason' : undefined} onClick={() => void publish()}>
      {publishing ? t('publishing') : t('publish')}
    </Button>
  ) : null

  return (
    <div className="space-y-5">
      <BackLink href={listHref} label={t('back')} />
      <div className="-mt-3">
        <PageHeader
          title={displayName}
          actions={
            <>
              {editable ? <SavePill state={autosave.state} onReload={() => window.location.reload()} /> : null}
              {publishButton}
              <CardMenu label={t('menu.label')} items={menu} />
            </>
          }
        />
      </div>

      <div className="flex flex-col items-start gap-2">
        <TestimonialStateBadge state={status.state === 'published' && status.hasChanges ? 'changes' : status.state} />
        {showPermissionReason || reasons.length ? (
          <div id="testimonial-publish-reason" className="space-y-1 text-sm leading-5 text-muted-foreground">
            {reasons.map((r) => (
              <p key={r}>{r}</p>
            ))}
            {showPermissionReason ? (
              <p>
                {t('publishReason.permission')}{' '}
                <Button variant="link" className="text-sm" onClick={goToPermission}>
                  {t('publishReason.goToPermission')}
                </Button>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {editable ? <SaveNotice state={autosave.state} rejected={autosave.rejected.map((p) => (p.startsWith('translation.') ? 'other' : p))} onRetry={autosave.retry} onReload={() => window.location.reload()} /> : null}
      {archived ? (
        <Notice tone="info" title={t('archivedTitle')} action={canWrite ? <Button onClick={() => void lifecycle('restore')}>{tl('actions.restore')}</Button> : undefined}>
          {t('archivedBody')}
        </Notice>
      ) : !canWrite ? (
        <Notice tone="info">{t('readOnly')}</Notice>
      ) : null}
      {fromNotice && createdFrom ? (
        <Notice tone="info" title={t('fromSubmission.title')} onDismiss={() => setFromNotice(false)} dismissLabel={t('dismiss')}>
          {createdFrom === 'submission-no-consent' ? t('fromSubmission.noConsent') : t('fromSubmission.body')}
        </Notice>
      ) : null}
      {permissionMissing && needsPermission ? (
        <Notice tone="error" onDismiss={() => setPermissionMissing(false)} dismissLabel={t('dismiss')} action={<Button onClick={goToPermission}>{t('publishReason.goToPermission')}</Button>}>
          {te('permission_required')}
        </Notice>
      ) : null}
      {notice ? (
        <Notice tone="error" onDismiss={() => setNotice(null)} dismissLabel={t('dismiss')}>
          {notice}
        </Notice>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          <Panel as="section" aria-labelledby="testimonial-text" className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="testimonial-text" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
                  {t('textTitle')}
                </h2>
                <p className="text-sm leading-5 text-muted-foreground">{t('textHint')}</p>
              </div>
              {languages.length > 1 ? (
                <SegmentedControl
                  label={t('language')}
                  appearance="soft"
                  value={lang}
                  onChange={setLang}
                  options={languages.map((l) => {
                    const missing = !(values.body[l] ?? '').trim()
                    return { value: l, label: missing ? t('languageMissing', { language: l.toUpperCase() }) : l.toUpperCase() }
                  })}
                />
              ) : null}
            </div>
            <Field label={t('body', { language: languageName(lang) })} hint={t('bodyHint')}>
              {(p) => (
                <TextArea
                  {...p}
                  rows={9}
                  value={values.body[lang] ?? ''}
                  readOnly={!editable}
                  maxLength={U.body}
                  placeholder={lang !== d ? values.body[d] || undefined : undefined}
                  onChange={(e) => setText('body', e.target.value)}
                />
              )}
            </Field>
            <Field label={t('abstract', { language: languageName(lang) })} hint={t('abstractHint')}>
              {(p) => <TextArea {...p} rows={3} value={values.abstract[lang] ?? ''} readOnly={!editable} maxLength={U.abstract} onChange={(e) => setText('abstract', e.target.value)} />}
            </Field>
            <Field label={t('context', { language: languageName(lang) })} hint={t('contextHint')}>
              {(p) => <TextInput {...p} value={values.context[lang] ?? ''} readOnly={!editable} maxLength={U.context} onChange={(e) => setText('context', e.target.value)} />}
            </Field>
            {canTranslateHere ? (
              <div className="flex flex-col items-start gap-1.5">
                <AssistButton tone="outline" busy={translating} disabled={translating} onClick={() => void translateFields()}>
                  {translating ? getTranslateMessages(uiLocale).translating : formatTranslateMessage(getTranslateMessages(uiLocale).translateFrom, { source: languageName(sourceLocale) })}
                </AssistButton>
                {machineHere ? <p className="text-sm leading-5 text-muted-foreground">{getTranslateMessages(uiLocale).statusMachine}</p> : null}
              </div>
            ) : null}
          </Panel>

          {initial.showPhotos ? (
            <Panel as="section" aria-labelledby="testimonial-photo" className="space-y-4">
              <h2 id="testimonial-photo" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
                {t('photoTitle')}
              </h2>
              <div className="flex items-start gap-4">
                <div className="size-20 shrink-0 overflow-hidden rounded-full bg-muted">
                  {values.photo?.url ? <MediaFrame src={values.photo.url} alt="" className="size-full" /> : <span className="grid size-full place-items-center px-2 text-center text-xs text-muted-foreground">{t('noPhoto')}</span>}
                </div>
                <div className="flex min-w-0 flex-col items-start gap-2">
                  <p className="text-sm leading-5 text-muted-foreground">{t('photoHint')}</p>
                  {editable ? (
                    <div className="flex flex-wrap items-start gap-2">
                      <Button onClick={() => setPickingPhoto((x) => !x)} aria-expanded={pickingPhoto}>
                        {values.photo ? t('changePhoto') : t('addPhoto')}
                      </Button>
                      {values.photo ? <Button onClick={() => change({ photo: null }, { photo: null })}>{t('removePhoto')}</Button> : null}
                    </div>
                  ) : null}
                </div>
              </div>
              {editable && pickingPhoto ? (
                <Panel>
                  <PhotoSource
                    projectSlug={projectSlug}
                    scope="media"
                    defaultLocale={d}
                    exclude={values.photo ? [values.photo.assetId] : []}
                    room={1}
                    onAdd={(photos) => {
                      const first = photos[0]
                      if (!first) return
                      setPickingPhoto(false)
                      change({ photo: { assetId: first.assetId, url: first.thumbUrl ?? first.url } }, { photo: first.assetId })
                    }}
                  />
                </Panel>
              ) : null}
            </Panel>
          ) : null}

          <Panel as="section" aria-labelledby="testimonial-who" className="space-y-4">
            <h2 id="testimonial-who" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
              {t('whoTitle')}
            </h2>
            <Field label={t('displayName')} hint={t('displayNameHint')}>
              {(p) => (
                <TextInput
                  {...p}
                  value={values.displayName}
                  readOnly={!editable}
                  maxLength={U.displayName}
                  onChange={(e) => change({ displayName: e.target.value }, { displayName: e.target.value })}
                />
              )}
            </Field>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p id="testimonial-anonymous" className="text-[0.9375rem] leading-6 font-medium text-foreground">
                  {t('anonymousLabel')}
                </p>
                <p className="text-sm leading-5 text-muted-foreground">{t('anonymousHint')}</p>
              </div>
              <Switch labelledBy="testimonial-anonymous" checked={values.anonymous} disabled={!editable} onChange={(on) => change({ anonymous: on }, { anonymous: on })} />
            </div>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field label={t('age')} hintBelow hint={t('ageHint')}>
                {(p) => (
                  <TextInput
                    {...p}
                    inputMode="numeric"
                    value={values.age}
                    readOnly={!editable}
                    maxLength={3}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, '').slice(0, 3)
                      const n = raw ? Number(raw) : null
                      change({ age: raw }, n === null ? { age: null } : n >= 1 && n <= U.age ? { age: n } : undefined)
                    }}
                  />
                )}
              </Field>
              <Field label={t('rating')} hintBelow hint={t('ratingHint')}>
                {(p) => (
                  <Select
                    {...p}
                    value={values.rating === null ? '' : String(values.rating)}
                    disabled={!editable}
                    onChange={(e) => {
                      const r = e.target.value ? Number(e.target.value) : null
                      change({ rating: r }, { rating: r })
                    }}
                  >
                    <option value="">{t('noRating')}</option>
                    {ratingOptions.map((n) => (
                      <option key={n} value={n}>
                        {t('ratingOption', { count: n })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('givenOn')} hintBelow hint={t('givenOnHint')}>
                {(p) => <DateInput {...p} value={values.givenOn} readOnly={!editable} disabled={!editable} onChange={(e) => change({ givenOn: e.target.value }, { givenOn: e.target.value || null })} />}
              </Field>
              <Field label={t('writtenIn')} hintBelow hint={t('writtenInHint')}>
                {(p) => (
                  <Select
                    {...p}
                    value={values.originalLocale}
                    disabled={!editable}
                    onChange={(e) => change({ originalLocale: e.target.value }, { originalLocale: e.target.value || null })}
                  >
                    <option value="">{t('writtenInUnknown')}</option>
                    {languages.map((l) => (
                      <option key={l} value={l}>
                        {languageName(l)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('source')} hintBelow hint={t('sourceHint')}>
                {(p) => (
                  <Select {...p} value={values.source} disabled={!editable} onChange={(e) => change({ source: e.target.value as TestimonialSource }, { source: e.target.value })}>
                    {TESTIMONIAL_SOURCES.map((s) => (
                      <option key={s} value={s}>
                        {t(`sources.${s}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('sourceUrl')} hintBelow hint={t('sourceUrlHint')}>
                {(p) => (
                  <TextInput
                    {...p}
                    value={values.sourceUrl}
                    readOnly={!editable}
                    maxLength={U.sourceUrl}
                    placeholder="https://"
                    onChange={(e) => {
                      const v = e.target.value
                      change({ sourceUrl: v }, v.trim() === '' ? { sourceUrl: null } : /^https?:\/\/\S+$/i.test(v.trim()) ? { sourceUrl: v.trim() } : undefined)
                    }}
                  />
                )}
              </Field>
            </div>
          </Panel>

          <Panel as="section" aria-labelledby="testimonial-tags" className="space-y-3">
            <h2 id="testimonial-tags" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
              {t('tagsTitle')}
            </h2>
            <TermPicker
              projectSlug={projectSlug}
              module="testimonials"
              kind="tag"
              label={t('tagsTitle')}
              terms={tagTerms}
              value={values.tags}
              onChange={(tags) => change({ tags }, { tags })}
              defaultLocale={d}
              canAdd={canAddTag && editable}
              disabled={!editable}
            />
            <p className="text-sm leading-5 text-muted-foreground">{t('tagsHint')}</p>
          </Panel>
        </div>

        <div className="min-w-0 space-y-5">
          <Panel as="section" aria-labelledby="testimonial-publishing" className="space-y-3">
            <h2 id="testimonial-publishing" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
              {t('publishingTitle')}
            </h2>
            <div id={PERMISSION_ANCHOR}>
              <CheckboxCard
                label={t('permission')}
                description={t('permissionHint')}
                checked={values.permissionToPublish}
                disabled={!editable}
                onChange={(on) => {
                  change({ permissionToPublish: on }, { permissionToPublish: on })
                  if (on) setPermissionMissing(false)
                }}
              />
            </div>
            <CheckboxCard label={t('featured')} description={t('featuredHint')} checked={values.featured} disabled={!editable} onChange={(on) => change({ featured: on }, { featured: on })} />
          </Panel>

          {privateShown ? (
            <Panel as="section" aria-labelledby="testimonial-private" className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 id="testimonial-private" className="flex items-start gap-2 text-[1.0625rem] leading-7 font-semibold text-foreground">
                  <span className="mt-1 text-muted-foreground">{ICONS.lock}</span>
                  {t('privateTitle')}
                </h2>
                {priv.available && priv.state !== 'idle' ? (
                  <span role="status" className="text-sm leading-5 text-muted-foreground">
                    {t(`privateState.${priv.state}`)}
                  </span>
                ) : null}
              </div>
              <p className="text-sm leading-5 text-muted-foreground">{t('privateHint')}</p>
              {!priv.available ? (
                <Notice tone="info" title={t('privateUnavailableTitle')}>
                  {t('privateUnavailable')}
                </Notice>
              ) : null}
              <Field label={t('fullName')}>
                {(p) => <TextInput {...p} value={priv.fullName} disabled={!priv.available || !editable} readOnly={!editable} maxLength={U.fullName} autoComplete="off" onChange={(e) => changePrivate('fullName', e.target.value)} />}
              </Field>
              <Field label={t('email')}>
                {(p) => <TextInput {...p} type="email" value={priv.email} disabled={!priv.available || !editable} readOnly={!editable} maxLength={U.email} autoComplete="off" onChange={(e) => changePrivate('email', e.target.value)} />}
              </Field>
              <Field label={t('phone')}>
                {(p) => <TextInput {...p} type="tel" value={priv.phone} disabled={!priv.available || !editable} readOnly={!editable} maxLength={U.phone} autoComplete="off" onChange={(e) => changePrivate('phone', e.target.value)} />}
              </Field>
              <Field label={t('note')} hint={t('noteHint')}>
                {(p) => <TextArea {...p} rows={3} value={priv.note} disabled={!priv.available || !editable} readOnly={!editable} maxLength={U.note} onChange={(e) => changePrivate('note', e.target.value)} />}
              </Field>
            </Panel>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'discard' || confirm === 'delete'}
        title={confirm === 'discard' ? t('confirm.discardTitle') : t('confirm.deleteTitle', { name: displayName })}
        body={confirm === 'discard' ? t('confirm.discardBody') : t('confirm.deleteBody')}
        confirmLabel={confirm === 'discard' ? t('confirm.discard') : tl('actions.delete')}
        busy={busy}
        error={confirmError}
        onConfirm={() => void runConfirm()}
        onCancel={() => {
          setConfirm(null)
          setConfirmError(null)
        }}
      />
      <DeletePermanentlyDialog
        open={confirm === 'deletePermanently'}
        titles={[displayName]}
        busy={busy}
        error={confirmError}
        onConfirm={() => void runConfirm()}
        onCancel={() => {
          setConfirm(null)
          setConfirmError(null)
        }}
      />
      <TestimonialActivitySheet open={activity} onClose={() => setActivity(false)} projectSlug={projectSlug} testimonialId={id} />
      <Toast message={toast?.message ?? null} tone={toast?.tone} action={toast?.undo ? t('undo') : undefined} onAction={toast?.undo} />
    </div>
  )
}
