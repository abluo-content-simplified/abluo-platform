'use client'

import { BackLink } from '@/components/app/ui/BackLink'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import {
  discardEventDraftAction,
  eventLifecycleAction,
  getEventAction,
  openEventForEditAction,
  patchEventDraftAction,
  publishEventDraftAction,
  setEventCoverAction,
  setEventCoverFocalAction,
  setEventDatesAction,
} from '@/app/[locale]/(client)/[tenant]/agenda/actions'
import type { EventCover, EventLifecycle, EventSnapshot, EventUsage } from '@/lib/api/event-drafts'
import { languageName } from '@/components/client/create/StepHeading'
import { PhotoSource } from '@/components/client/media/PhotoSource'
import { FocalPointPicker, type FocalPoint } from '@/components/app/ui/FocalPointPicker'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Panel } from '@/components/app/ui/Panel'
import { MediaFrame } from '@/components/app/ui/list/cells'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { EVENT_ICONS, EventLifecycleBadge } from './event-bits'
import { EventActivitySheet } from './EventActivitySheet'
import { Button } from '@/components/app/ui/Button'
import { FieldLabel } from '@/components/app/ui/FieldLabel'
import { TextArea, TextInput } from '@/components/app/ui/TextInput'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { DateTimePicker } from '@/components/app/ui/DateTimePicker'
import { Notice } from '@/components/app/ui/Notice'
import { TermPicker } from '@/components/client/taxonomy/TermPicker'
import type { PersonPickerPerson } from '@/components/app/ui/PersonPicker'
import { PersonPickerField } from '@/components/client/persons/PersonPickerField'
import { editingZone } from '@/components/app/lifecycle/zoned-time'
import { DeletePermanentlyDialog } from '@/components/app/lifecycle/DeletePermanentlyDialog'
import { PublicationDateField } from '@/components/app/lifecycle/PublicationDateField'
import { PublicationDates } from '@/components/app/lifecycle/PublicationDates'
import { UnpublishDateSheet } from '@/components/app/lifecycle/UnpublishDateSheet'
import { shortMoment } from '@/components/app/lifecycle/publish-plan'
import { useDateLocale } from '@/lib/i18n/date-locale-context'

const TEXT_FIELDS = ['title', 'shortDescription', 'location', 'registrationLabel'] as const
type TextField = (typeof TEXT_FIELDS)[number]
type Texts = Record<TextField, Record<string, string>>
type Values = {
  texts: Texts
  start: string
  end: string
  url: string
  // ADR-031 — visibility, status, how people attend, and the place token.
  visibility: EventSnapshot['visibility']
  eventStatus: EventSnapshot['eventStatus']
  attendanceMode: EventSnapshot['attendanceMode']
  place: string
  /** ADR-033 Amendment J — category keys. */
  categories: string[]
  /** ADR-043 — hosts from the People module (person ids, in order). */
  hostPeople: string[]
}
const CHOICES = ['visibility', 'eventStatus', 'attendanceMode', 'place'] as const

const SAVE_DELAY_MS = 800
type Confirm = 'discard' | 'delete' | 'deletePermanently' | 'unpublish' | null
type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict' | 'invalid'

function valuesOf(e: EventSnapshot): Values {
  return {
    texts: { title: { ...e.title }, shortDescription: { ...e.shortDescription }, location: { ...e.location }, registrationLabel: { ...e.registrationLabel } },
    start: e.startDate ?? '',
    end: e.endDate ?? '',
    url: e.registrationUrl,
    visibility: e.visibility,
    eventStatus: e.eventStatus,
    attendanceMode: e.attendanceMode,
    place: e.place,
    categories: [...e.categories],
    hostPeople: [...e.hostPeople],
  }
}

/** The patch that takes `from` to `to` (only what changed). */
function diff(from: Values, to: Values, locales: string[]): Record<string, unknown> {
  const set: Record<string, unknown> = {}
  for (const f of TEXT_FIELDS) {
    for (const l of locales) {
      const a = (from.texts[f][l] ?? '').trim()
      const b = (to.texts[f][l] ?? '').trim()
      if (a !== b) set[`${f}.${l}`] = b
    }
  }
  if (from.start !== to.start && to.start) set.startDate = to.start
  if (from.end !== to.end) set.endDate = to.end || null
  if (from.url.trim() !== to.url.trim()) set.registrationUrl = to.url.trim()
  for (const f of CHOICES) if (from[f] !== to[f]) set[f] = to[f]
  if (from.categories.join('\n') !== to.categories.join('\n')) set.categories = to.categories
  if (from.hostPeople.join('\n') !== to.hostPeople.join('\n')) set.hostPeople = to.hostPeople
  return set
}

/**
 * One row of big, tappable choices (the ADR-031 fields): the shared
 * SegmentedControl in its chips look, so a phone user picks with one tap.
 */
function ChoiceChips<V extends string>({ label, value, options, onChange, disabled }: { label: string; value: V; options: { value: V; label: string }[]; onChange: (v: V) => void; disabled: boolean }) {
  return <SegmentedControl appearance="chips" label={label} value={value} onChange={onChange} options={options.map((o) => ({ ...o, disabled }))} />
}

/**
 * One event (client dashboard · agenda/<id>), edited in place: photo, title,
 * short description and place (per site language), when, and the sign-up
 * button. Every change is saved to the event's draft after a short pause;
 * "Publish changes" updates the website. The rest of an event (full text,
 * programme, prices, photos, streaming) is kept as it is and edited by Abluo.
 *
 * Publication (ADR-032 Phase 3) — one status, the words of every module:
 * Draft · Scheduled · Published · Unpublished · Archived. "Publish" means
 * online on the website. A "Publishing" block holds Publish on / Unpublish on
 * (site time zone, 24 h); Unpublish, Archive, Restore and Delete permanently
 * are in the ⋯ menu (archive first, then delete; restore always lands as
 * Unpublished and never republishes). Past events are never archived for you.
 * The event's own status (cancelled, postponed, sold out) and who can see it
 * are separate choices below and never change whether it is published.
 */
export function EventEditor({ projectSlug, initial, canWrite, canDelete, canAddCategory = false, people }: { projectSlug: string; initial: EventSnapshot; canWrite: boolean; canDelete: boolean; /** Holds events.taxonomy.write: the category field offers "+ Add category" (and shows even with no category yet). */ canAddCategory?: boolean; /** ADR-043 — present only with the People module and people.person.read: the hosts field. `initial` = the hosts already on the event, named; `canCreate` = people.person.write. */ people?: { initial: PersonPickerPerson[]; canCreate: boolean } }) {
  const t = useTranslations('clientDashboard.events.editor')
  const te = useTranslations('clientDashboard.events.errors')
  const tl = useTranslations('app.lifecycle')
  const tp = useTranslations('app.lifecycle.publish')
  const dateLocale = useDateLocale()
  const ui = useLocale()
  const router = useRouter()
  const ids = { title: useId(), shortDescription: useId(), location: useId(), registrationLabel: useId(), start: useId(), end: useId(), url: useId() }
  const { site, id, placeOptions, capabilities: caps } = initial
  const d = site.defaultLocale
  const zone = editingZone(site.timeZone)
  const when = (iso: string) => tp('moment', shortMoment(iso, zone, dateLocale))
  const base = `/${projectSlug}/agenda`

  const [values, setValues] = useState<Values>(() => valuesOf(initial))
  // The people the hosts picker shows (names of people added here are kept for the session).
  const [knownPeople, setKnownPeople] = useState<PersonPickerPerson[]>(people?.initial ?? [])
  const saved = useRef<Values>(valuesOf(initial))
  /** The last saved values, as state (render reads this; the save queue reads the ref). */
  const [savedValues, setSavedValues] = useState<Values>(() => valuesOf(initial))
  const revRef = useRef(initial.rev)
  const [hasDraft, setHasDraft] = useState(initial.hasDraft)
  const [isPublished, setIsPublished] = useState(initial.isPublished)
  // ADR-032 — the publication state of the PUBLISHED version (what the website shows).
  const [life, setLife] = useState<EventLifecycle>(initial.lifecycle)
  /** "Publish on" / "Unpublish on" chosen for an event that is not online yet. */
  const [publishOn, setPublishOn] = useState<string | null>(null)
  const [unpublishOnNew, setUnpublishOnNew] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [activity, setActivity] = useState(false)
  const [dateSheet, setDateSheet] = useState(false)
  const archived = life.status === 'archived'
  const scheduled = life.status === 'scheduled'
  const unpublished = life.status === 'unpublished'
  const live = life.status === 'published'
  /** Archived events are read-only until restored (ADR-032). */
  const editable = canWrite && !archived
  const [cover, setCover] = useState<EventCover | null>(initial.cover)
  // The cover's focus point — this event's own (heroImage.hotspot), never the
  // Media Library photo's (Tom, 2026-10-22). Saved when the dot is let go.
  const [focal, setFocal] = useState<FocalPoint | null>(initial.cover?.focal ?? null)
  const [adjusting, setAdjusting] = useState(false)
  const [focalStatus, setFocalStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const focalRef = useRef<FocalPoint | null>(initial.cover?.focal ?? null)
  const focalDirty = useRef(false)
  const [locale, setLocale] = useState(d)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const { toast, show, schedule } = useUndo()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const latest = useRef(values)
  useEffect(() => {
    latest.current = values
  }, [values])

  /** The draft's revision; a published event's first change opens its draft (an exact copy) first. */
  const draftRev = useCallback(async (): Promise<string> => {
    if (revRef.current) return revRef.current
    const opened = await openEventForEditAction({ projectSlug, id })
    if (!opened.ok || !opened.rev) throw new Error(opened.ok ? 'failed' : opened.error)
    revRef.current = opened.rev
    setHasDraft(true)
    return opened.rev
  }, [projectSlug, id])

  /** Saves whatever differs from the last saved state; runs one save at a time. */
  const flush = useCallback((): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    chain.current = chain.current.then(async () => {
      const target = latest.current
      const set = diff(saved.current, target, site.locales)
      if (!Object.keys(set).length) return
      setSaveState('saving')
      try {
        const rev = await draftRev()
        const r = await patchEventDraftAction({ projectSlug, id, rev, set })
        if (!r.ok) {
          setSaveState(r.error === 'conflict' ? 'conflict' : r.error === 'bad_dates' || r.error === 'invalid_value' ? 'invalid' : 'error')
          return
        }
        revRef.current = r.rev
        saved.current = target
        setSavedValues(target)
        setSaveState('saved')
      } catch {
        setSaveState('error')
      }
    })
    return chain.current
  }, [draftRev, projectSlug, id, site.locales])

  useEffect(() => {
    if (!editable) return
    if (!Object.keys(diff(savedValues, values, site.locales)).length) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [values, savedValues, editable, flush, site.locales])

  /** Saves a moved focus point (after any pending text save, one save at a time). */
  const saveFocal = useCallback(() => {
    if (!focalDirty.current || !focalRef.current) return
    focalDirty.current = false
    void flush()
    setFocalStatus('saving')
    chain.current = chain.current.then(async () => {
      const point = focalRef.current
      if (!point) return
      try {
        const rev = await draftRev()
        const r = await setEventCoverFocalAction({ projectSlug, id, rev, focal: point })
        if (!r.ok) throw new Error(r.error)
        revRef.current = r.rev
        if (r.cover) setCover(r.cover)
        setFocalStatus(focalDirty.current ? 'saving' : 'saved')
      } catch {
        // Retried with the next move.
        focalDirty.current = true
        setFocalStatus('failed')
      }
    })
  }, [flush, draftRev, projectSlug, id])

  const changeFocal = (point: FocalPoint) => {
    focalRef.current = point
    focalDirty.current = true
    setFocal(point)
  }

  // Save before leaving the page.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return
      saveFocal()
      void flush()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [flush, saveFocal])

  const setText = (field: TextField, value: string) =>
    setValues((v) => ({ ...v, texts: { ...v.texts, [field]: { ...v.texts[field], [locale]: value } } }))

  async function chooseCover(assetId: string | null) {
    setPicking(false)
    if (busy) return
    setBusy(true)
    try {
      await flush()
      const rev = await draftRev()
      const r = await setEventCoverAction(assetId ? { projectSlug, id, rev, assetId } : { projectSlug, id, rev, remove: true })
      if (!r.ok) throw new Error(r.error)
      revRef.current = r.rev
      setCover(r.cover)
      // A new photo starts from its Media Library focus point; none without a photo.
      focalRef.current = r.cover?.focal ?? null
      focalDirty.current = false
      setFocal(focalRef.current)
      setFocalStatus('idle')
      if (!r.cover) setAdjusting(false)
      show({ message: assetId ? t('photo.saved') : t('photo.removed'), tone: 'status' })
    } catch {
      show({ message: te('failed'), tone: 'error' }, 7000)
    } finally {
      setBusy(false)
    }
  }

  /** What the server said, as words (an `in_use` refusal names where the event is used). */
  const errorText = (code: string, usedIn?: EventUsage[]) =>
    code === 'in_use' && usedIn?.length ? te('in_use_where', { places: usedIn.map((u) => u.title).filter(Boolean).join(', ') }) : te.has(code) ? te(code) : te('failed')

  /** Shows what the server now holds: publication state, draft or not, and the draft's revision (lifecycle changes touch both versions). */
  const reload = useCallback(async (): Promise<boolean> => {
    const r = await getEventAction({ projectSlug, id })
    if (!r.ok) return false
    revRef.current = r.event.rev
    setHasDraft(r.event.hasDraft)
    setIsPublished(r.event.isPublished)
    setLife(r.event.lifecycle)
    return true
  }, [projectSlug, id])

  const dirty = Object.keys(diff(savedValues, values, site.locales)).length > 0
  const withContent = hasDraft || dirty
  const title = values.texts.title[d]?.trim() || t('untitled')
  const missingTitle = !values.texts.title[d]?.trim()
  const missingStart = !values.start
  /** Why "Publish" is off (it always says why; never a silent grey button). */
  const publishReason = !editable
    ? null
    : missingTitle
      ? t('reason.missingTitle', { language: languageName(d, ui) })
      : missingStart
        ? t('reason.missingStart')
        : live && !withContent
          ? t('reason.upToDate')
          : null

  /** Publish = online on the website: a draft's content goes live (now, or the dates chosen), or an unpublished / scheduled event goes online now. */
  async function publish(update = false) {
    if (busy || publishReason) return
    setBusy(true)
    setNotice(null)
    try {
      await flush()
      if (!withContent) {
        // Nothing new to publish: only the dates move.
        const r = unpublished ? await eventLifecycleAction({ projectSlug, id, op: 'publishAgain' }) : await setEventDatesAction({ projectSlug, id, publishAt: 'now' })
        if (!r.ok) return setNotice(errorText(r.error, r.detail?.usedIn))
        await reload()
        show({ message: t('toast.online'), tone: 'status' })
        router.refresh()
        return
      }
      if (!revRef.current) return
      const mode = update || live ? 'keep' : 'now'
      const r = await publishEventDraftAction({
        projectSlug,
        id,
        rev: revRef.current,
        mode,
        ...(!isPublished && unpublishOnNew ? { unpublishAt: unpublishOnNew } : {}),
      })
      if (!r.ok) return setNotice(errorText(r.error, r.detail?.usedIn))
      revRef.current = ''
      setHasDraft(false)
      setSaveState('idle')
      setUnpublishOnNew(null)
      await reload()
      show({ message: live || update ? t('published') : t('toast.online'), tone: 'status' })
      router.refresh()
    } catch {
      setNotice(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  /** "Publish on…" for an event that is not online yet: published with a future date, online by itself then. */
  async function scheduleIt() {
    if (busy || publishReason || !publishOn) return
    setBusy(true)
    setNotice(null)
    try {
      await flush()
      if (!revRef.current) return
      const r = await publishEventDraftAction({ projectSlug, id, rev: revRef.current, mode: 'schedule', publishAt: publishOn, ...(unpublishOnNew ? { unpublishAt: unpublishOnNew } : {}) })
      if (!r.ok) return setNotice(errorText(r.error, r.detail?.usedIn))
      revRef.current = ''
      setHasDraft(false)
      setSaveState('idle')
      await reload()
      show({ message: t('toast.scheduled', { date: when(publishOn) }), tone: 'status' })
      setPublishOn(null)
      setUnpublishOnNew(null)
      router.refresh()
    } catch {
      setNotice(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  /** Publish on / Unpublish on of an event that is already published. `from` null = online now. */
  async function changeDates(next: { from?: string | null; until?: string | null }, message: string) {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      await flush()
      const r = await setEventDatesAction({
        projectSlug,
        id,
        ...(next.from !== undefined ? { publishAt: next.from ?? 'now' } : {}),
        ...(next.until !== undefined ? { unpublishAt: next.until } : {}),
      })
      if (!r.ok) return setNotice(errorText(r.error))
      await reload()
      setDateSheet(false)
      show({ message, tone: 'status' })
      router.refresh()
    } catch {
      setNotice(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  /** Everything the dialogs confirm: discard changes, delete a draft, unpublish, delete permanently. */
  async function runConfirm() {
    if (!confirm || confirmBusy) return
    setConfirmBusy(true)
    setConfirmError(null)
    try {
      await chain.current
      if (confirm === 'discard' || confirm === 'delete') {
        const r = await discardEventDraftAction({ projectSlug, id, rev: revRef.current })
        if (!r.ok) return setConfirmError(errorText(r.error))
        if (r.deleted) router.push(base)
        else window.location.reload()
        return
      }
      if (confirm === 'unpublish') {
        await flush()
        const r = await eventLifecycleAction({ projectSlug, id, op: 'unpublish' })
        if (!r.ok) return setConfirmError(errorText(r.error, r.detail?.usedIn))
        await reload()
        setConfirm(null)
        show({ message: t('toast.unpublished'), tone: 'status' })
        router.refresh()
        return
      }
      const r = await eventLifecycleAction({ projectSlug, id, op: 'deletePermanently' })
      if (!r.ok) return setConfirmError(errorText(r.error, r.detail?.usedIn))
      router.push(base)
    } catch {
      setConfirmError(te('failed'))
    } finally {
      setConfirmBusy(false)
    }
  }

  /** Restore: archived → Unpublished. It is not published again by itself. */
  async function restore() {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const r = await eventLifecycleAction({ projectSlug, id, op: 'restore' })
      if (!r.ok) return setNotice(errorText(r.error, r.detail?.usedIn))
      await reload()
      show({ message: t('toast.restored'), tone: 'status' })
      router.refresh()
    } catch {
      setNotice(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  /** Archive from the editor: shown at once ("Archived · Undo"), carried out after the Undo window (or when the page is left). */
  async function archiveWithUndo() {
    if (busy || !canWrite) return
    await flush()
    const before = life
    setNotice(null)
    setLife({ ...before, status: 'archived' })
    schedule({
      id: `archive:${id}`,
      message: t('toast.archived'),
      undoLabel: t('undo'),
      failMessage: te('failed'),
      restore: () => setLife(before),
      run: async () => {
        const r = await eventLifecycleAction({ projectSlug, id, op: 'archive' })
        if (!r.ok) {
          setLife(before)
          setNotice(errorText(r.error, r.detail?.usedIn))
          return false
        }
        await reload()
        router.refresh()
        return true
      },
    })
  }

  const others = site.locales.filter((l) => l !== d)
  const disabled = !editable
  const menu: CardMenuItem[] = []
  if (editable && hasDraft && isPublished) menu.push({ key: 'discard', label: t('discard'), onSelect: () => setConfirm('discard') })
  menu.push({ key: 'activity', label: t('menu.activity'), onSelect: () => setActivity(true) })
  if (canWrite) {
    if (archived) menu.push({ key: 'restore', label: tl('actions.restore'), onSelect: () => void restore() })
    else if (isPublished) {
      if (live || scheduled) menu.push({ key: 'unpublish', label: tl('actions.unpublish'), onSelect: () => setConfirm('unpublish') })
      menu.push({ key: 'archive', label: tl('actions.archive'), onSelect: () => void archiveWithUndo() })
    }
  }
  if (canDelete) {
    if (archived) menu.push({ key: 'deletePermanently', label: tl('actions.deletePermanently'), onSelect: () => setConfirm('deletePermanently'), destructive: true, separated: true })
    else if (canWrite && !isPublished && hasDraft) menu.push({ key: 'delete', label: t('delete'), onSelect: () => setConfirm('delete'), destructive: true, separated: true })
  }
  const primaryLabel = scheduled ? t('publishNow') : unpublished && !withContent ? tl('actions.publishAgain') : live && withContent ? t('publishChanges') : t('publish')

  const saveLine =
    saveState === 'saving'
      ? t('save.saving')
      : saveState === 'saved'
        ? t('save.saved')
        : saveState === 'conflict'
          ? t('save.conflict')
          : saveState === 'invalid'
            ? t('save.invalid')
            : saveState === 'error'
              ? t('save.error')
              : null

  return (
    <div className="max-w-2xl space-y-6">
      <BackLink href={base} label={t('back')} />
      <div className="-mt-4">
        <PageHeader
          title={title}
          actions={
            <>
              {editable ? (
                <Button variant="primary" disabled={busy || !!publishReason} aria-describedby={publishReason ? 'event-publish-reason' : undefined} onClick={() => void publish()}>
                  {busy ? t('publishing') : primaryLabel}
                </Button>
              ) : null}
              <CardMenu label={t('menu.label')} items={menu} />
            </>
          }
        />
      </div>

      <div className="-mt-3 flex flex-col items-start gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <EventLifecycleBadge lifecycle={life} changes={isPublished && withContent} zone={zone} />
          {saveLine ? (
            <p role="status" className={`text-sm leading-5 ${saveState === 'error' || saveState === 'conflict' || saveState === 'invalid' ? 'text-destructive' : 'text-muted-foreground'}`}>
              {saveLine}
            </p>
          ) : null}
        </div>
        {publishReason ? (
          <p id="event-publish-reason" className="text-sm leading-5 text-muted-foreground">
            {publishReason}
          </p>
        ) : null}
      </div>
      {archived ? (
        <Notice tone="info" title={t('archived.title')} action={canWrite ? <Button disabled={busy} onClick={() => void restore()}>{tl('actions.restore')}</Button> : undefined}>
          {t('archived.body')}
        </Notice>
      ) : !canWrite ? (
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('readOnly')}</p>
      ) : null}
      {notice ? (
        <Notice tone="error" onDismiss={() => setNotice(null)} dismissLabel={t('dismiss')}>
          {notice}
        </Notice>
      ) : null}

      {/* Publishing — ADR-032: Publish on / Unpublish on. Separate from the event's own status and visibility below. */}
      {!archived ? (
        <Panel as="section" aria-labelledby="event-publishing" className="space-y-4">
          <h2 id="event-publishing" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
            {t('publishing.title')}
          </h2>
          {live ? (
            <div className="space-y-3">
              <p className="text-[0.9375rem] leading-6 text-foreground">{life.unpublishOn ? t('publishing.liveUntil', { date: when(life.unpublishOn) }) : t('publishing.live')}</p>
              {editable ? (
                <Button variant="secondary" disabled={busy} onClick={() => setDateSheet(true)}>
                  {tl('actions.setUnpublishDate')}
                </Button>
              ) : null}
            </div>
          ) : scheduled && life.publishedAt ? (
            <div className="space-y-3">
              <PublicationDates
                id="event-dates"
                from={life.publishedAt}
                until={life.unpublishOn}
                zone={zone}
                busy={busy || !editable}
                onChange={(next) => void changeDates({ from: next.from, until: next.until }, next.from ? t('toast.datesSaved') : t('toast.online'))}
                sentence={t('publishing.scheduledSentence', { date: when(life.publishedAt) })}
              />
              {withContent ? <p className="text-sm leading-5 text-muted-foreground">{t('publishing.changesNotScheduled')}</p> : null}
              {editable && withContent ? (
                <Button variant="secondary" disabled={busy || !!publishReason} onClick={() => void publish(true)}>
                  {t('publishing.updateScheduled')}
                </Button>
              ) : null}
            </div>
          ) : unpublished ? (
            <div className="space-y-3">
              <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('publishing.unpublishedBody')}</p>
              {editable ? (
                <Button variant="secondary" disabled={busy || !!publishReason} onClick={() => void publish()}>
                  {tl('actions.publishAgain')}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('publishing.notOnline')}</p>
              {editable ? (
                <div className="space-y-3">
                  <PublicationDateField id="event-publish-on" label={tl('dates.publishOn')} value={publishOn} onChange={setPublishOn} zone={zone} />
                  <PublicationDateField id="event-unpublish-on" label={tl('dates.unpublishOn')} value={unpublishOnNew} onChange={setUnpublishOnNew} zone={zone} after={publishOn} />
                  <p className="text-sm leading-5 text-muted-foreground">{t('publishing.datesHelp')}</p>
                  <Button variant="secondary" disabled={busy || !publishOn || !!publishReason} aria-describedby={!publishOn ? 'event-schedule-reason' : undefined} onClick={() => void scheduleIt()}>
                    {tp('schedule')}
                  </Button>
                  {!publishOn ? (
                    <p id="event-schedule-reason" className="text-sm leading-5 text-muted-foreground">
                      {t('publishing.scheduleNeedsDate')}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
          <p className="text-sm leading-5 text-muted-foreground">{t('publishing.separate')}</p>
        </Panel>
      ) : null}

      {/* Photo */}
      <section aria-labelledby="event-photo" className="space-y-3">
        <h2 id="event-photo" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
          {t('photo.title')}
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <MediaFrame src={cover?.thumbUrl ?? cover?.url ?? null} alt={cover?.alt[d] ?? ''} size={{ width: '12rem', height: '8rem' }} className="rounded-xl border border-border" />
          {editable ? (
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
                {EVENT_ICONS.photo}
                {cover ? t('photo.change') : t('photo.choose')}
              </Button>
              {cover?.url ? (
                <Button disabled={busy} aria-expanded={adjusting} onClick={() => (adjusting ? (saveFocal(), setAdjusting(false)) : setAdjusting(true))}>
                  {adjusting ? t('photo.done') : t('photo.adjust')}
                </Button>
              ) : null}
              {cover ? (
                <Button disabled={busy} onClick={() => void chooseCover(null)}>
                  {t('photo.remove')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <p className="text-sm leading-5 text-muted-foreground">{t('photo.helper')}</p>
        {/* Take a photo · upload · Media Library — the shared "add photos" block. */}
        {editable && picking ? (
          <Panel>
            <PhotoSource
              projectSlug={projectSlug}
              scope="media"
              defaultLocale={d}
              exclude={cover ? [cover.assetId] : []}
              room={1}
              disabled={busy}
              onAdd={(photos) => photos[0] && void chooseCover(photos[0].assetId)}
            />
          </Panel>
        ) : null}
        {editable && adjusting && cover?.url ? (
          <Panel className="space-y-2">
            <FocalPointPicker
              url={cover.url}
              alt={cover.alt[d] ?? ''}
              point={focal}
              onChange={changeFocal}
              onCommit={saveFocal}
              compact
              status={focalStatus === 'idle' ? '' : t(`photo.focal.${focalStatus}`)}
              statusError={focalStatus === 'failed'}
              labels={{
                title: t('photo.focal.title'),
                helper: t('photo.focal.helper'),
                keys: t('photo.focal.keys'),
                label: t('photo.focal.label'),
                valueText: (x: number, y: number) => t('photo.focal.valueText', { x, y }),
                previews: t('photo.focal.previews'),
                preview: {
                  wide: t('photo.focal.preview.wide'),
                  card: t('photo.focal.preview.card'),
                  square: t('photo.focal.preview.square'),
                  tall: t('photo.focal.preview.tall'),
                },
              }}
            />
            <p className="text-sm leading-5 text-muted-foreground">{t('photo.focal.scope')}</p>
          </Panel>
        ) : null}
      </section>

      {/* Words, per language */}
      <section aria-labelledby="event-words" className="space-y-4">
        <h2 id="event-words" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
          {t('words.title')}
        </h2>
        {others.length ? (
          <SegmentedControl
            appearance="chips"
            label={t('words.language')}
            value={locale}
            onChange={setLocale}
            options={site.locales.map((l) => ({
              value: l,
              label: (
                <>
                  {languageName(l, ui)}
                  {l !== d && !values.texts.title[l]?.trim() ? <span className="sr-only"> · {t('words.missing')}</span> : null}
                </>
              ),
            }))}
          />
        ) : null}
        {locale !== d && values.texts.title[d] ? (
          <p className="text-sm leading-5 text-muted-foreground">{t('words.original', { language: languageName(d, ui), title: values.texts.title[d] })}</p>
        ) : null}
        <div>
          <FieldLabel htmlFor={ids.title}>
            {t('fields.title')}
          </FieldLabel>
          <TextInput id={ids.title} disabled={disabled} maxLength={160} value={values.texts.title[locale] ?? ''} onChange={(e) => setText('title', e.target.value)} />
        </div>
        <div>
          <FieldLabel htmlFor={ids.shortDescription}>
            {t('fields.shortDescription')}
          </FieldLabel>
          <TextArea
            id={ids.shortDescription}
            disabled={disabled}
            maxLength={500}
            rows={4}
            value={values.texts.shortDescription[locale] ?? ''}
            onChange={(e) => setText('shortDescription', e.target.value)}
          />
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{t('fields.shortDescriptionHelper')}</p>
        </div>
        {values.place === '' && values.attendanceMode !== 'online' ? (
          <div>
            <FieldLabel htmlFor={ids.location}>
              {t('fields.location')}
            </FieldLabel>
            <TextInput id={ids.location} disabled={disabled} maxLength={160} value={values.texts.location[locale] ?? ''} onChange={(e) => setText('location', e.target.value)} placeholder={t('fields.locationPlaceholder')} />
          </div>
        ) : null}
      </section>

      {/* Category — ADR-033 Amendment J: chosen from Categories & Tags, new ones added on the spot */}
      {initial.categoryOptions.length > 0 || initial.categories.length > 0 || (canAddCategory && editable) ? (
        <section aria-labelledby="event-categories" className="space-y-3">
          <h2 id="event-categories" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
            {t('categories.title')}
          </h2>
          <TermPicker
            projectSlug={projectSlug}
            module="events"
            kind="category"
            label={t('categories.title')}
            terms={initial.categoryOptions}
            value={values.categories}
            onChange={(categories) => setValues((v) => ({ ...v, categories }))}
            defaultLocale={d}
            canAdd={canAddCategory && editable}
            disabled={disabled}
          />
          <p className="text-sm leading-5 text-muted-foreground">{t('categories.helper')}</p>
        </section>
      ) : null}

      {/* Hosts — ADR-043: people from the People list; the Hosts capability (ADR-038 D6) governs it */}
      {caps.hosts && (people || initial.legacyHosts.length > 0) ? (
        <section aria-labelledby="event-hosts" className="space-y-3">
          <h2 id="event-hosts" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
            {t('hosts.title')}
          </h2>
          {people ? (
            <>
              <PersonPickerField
                projectSlug={projectSlug}
                label={t('hosts.title')}
                max={50}
                canCreate={people.canCreate && editable}
                disabled={disabled}
                value={values.hostPeople.map((pid) => knownPeople.find((p) => p.id === pid) ?? { id: pid, name: t('hosts.unknownPerson') })}
                onChange={(next) => {
                  setKnownPeople((k) => [...next, ...k.filter((p) => !next.some((n) => n.id === p.id))])
                  setValues((v) => ({ ...v, hostPeople: next.map((p) => p.id) }))
                }}
              />
              <p className="text-sm leading-5 text-muted-foreground">{t('hosts.helper')}</p>
            </>
          ) : null}
          {initial.legacyHosts.length > 0 ? (
            <Notice tone="info" title={t('hosts.legacyTitle')}>
              {t('hosts.legacyBody', { names: initial.legacyHosts.map((h) => (h.role ? `${h.name} (${h.role})` : h.name)).join(', ') })}
            </Notice>
          ) : null}
        </section>
      ) : null}

      {/* Where — ADR-031: how people attend, and the place */}
      <section aria-labelledby="event-place" className="space-y-4">
        <h2 id="event-place" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
          {t('attendance.title')}
        </h2>
        <ChoiceChips
          label={t('attendance.title')}
          value={values.attendanceMode}
          disabled={disabled}
          onChange={(attendanceMode) => setValues((v) => ({ ...v, attendanceMode }))}
          // ADR-038 D6 — only the ways of attending this site offers, plus the one the event already has.
          options={(['inPerson', 'online', 'mixed'] as const)
            .filter((m) => caps.attendance[m] || m === initial.attendanceMode)
            .map((m) => ({ value: m, label: t(`attendance.${m}`) }))}
        />
        {values.attendanceMode !== 'online' && (placeOptions.locations.length > 0 || placeOptions.venues.length > 0) ? (
          <div className="space-y-2">
            <FieldLabel as="p">{t('place.title')}</FieldLabel>
            <ChoiceChips
              label={t('place.title')}
              value={values.place}
              disabled={disabled}
              onChange={(place) => setValues((v) => ({ ...v, place }))}
              options={[
                ...placeOptions.locations.map((l) => ({ value: `location:${l.key}`, label: l.name })),
                ...placeOptions.venues.map((v) => ({ value: `venue:${v.id}`, label: v.name })),
                { value: '', label: t('place.elsewhere') },
              ]}
            />
            <p className="text-sm leading-5 text-muted-foreground">{t('place.helper')}</p>
          </div>
        ) : null}
      </section>

      {/* When */}
      <section aria-labelledby="event-when" className="space-y-4">
        <h2 id="event-when" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
          {t('when.title')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor={ids.start}>
              {t('when.start')}
            </FieldLabel>
            <DateTimePicker id={ids.start} title={t('when.start')} disabled={disabled} allowPast zone={zone} value={values.start || null} onChange={(start) => setValues((v) => ({ ...v, start }))} />
          </div>
          <div>
            <FieldLabel htmlFor={ids.end}>
              {t('when.end')}
            </FieldLabel>
            <DateTimePicker id={ids.end} title={t('when.end')} disabled={disabled} allowPast after={values.start || null} zone={zone} value={values.end || null} onChange={(end) => setValues((v) => ({ ...v, end }))} showZone={false} />
            {values.end && !disabled ? (
              <Button variant="link" className="px-0" onClick={() => setValues((v) => ({ ...v, end: '' }))}>
                {t('when.removeEnd')}
              </Button>
            ) : null}
          </div>
        </div>
        <p className="text-sm leading-5 text-muted-foreground">{t('when.helper')}</p>
      </section>

      {/* Sign-up — only when the project offers it (ADR-038 D6) */}
      {caps.registration === 'externalLink' ? (
      <section aria-labelledby="event-signup" className="space-y-4">
        <h2 id="event-signup" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
          {t('signup.title')}
        </h2>
        <div>
          <FieldLabel htmlFor={ids.url}>
            {t('signup.link')}
          </FieldLabel>
          <TextInput id={ids.url} type="url" inputMode="url" disabled={disabled} maxLength={500} value={values.url} onChange={(e) => setValues((v) => ({ ...v, url: e.target.value }))} placeholder={t('signup.linkPlaceholder')} />
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{t('signup.linkHelper')}</p>
        </div>
        <div>
          <FieldLabel htmlFor={ids.registrationLabel}>
            {t('signup.label')}
            {others.length ? <span className="font-normal text-muted-foreground"> · {languageName(locale, ui)}</span> : null}
          </FieldLabel>
          <TextInput
            id={ids.registrationLabel}
            disabled={disabled}
            maxLength={40}
            value={values.texts.registrationLabel[locale] ?? ''}
            onChange={(e) => setText('registrationLabel', e.target.value)}
            placeholder={t('signup.labelPlaceholder')}
          />
        </div>
      </section>
      ) : null}

      {/* Status and visibility — ADR-031 */}
      <section aria-labelledby="event-status" className="space-y-4">
        <h2 id="event-status" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
          {t('status.title')}
        </h2>
        <ChoiceChips
          label={t('status.title')}
          value={values.eventStatus}
          disabled={disabled}
          onChange={(eventStatus) => setValues((v) => ({ ...v, eventStatus }))}
          options={(['scheduled', 'cancelled', 'postponed', 'soldOut'] as const).map((st) => ({ value: st, label: t(`status.${st}`) }))}
        />
        <p className="text-sm leading-5 text-muted-foreground">{t('status.helper')}</p>
        <h2 id="event-visibility" className="pt-2 text-[1.0625rem] leading-7 font-semibold text-foreground">
          {t('visibility.title')}
        </h2>
        <ChoiceChips
          label={t('visibility.title')}
          value={values.visibility}
          disabled={disabled}
          onChange={(visibility) => setValues((v) => ({ ...v, visibility }))}
          options={(['public', 'websiteOnly', 'unlisted'] as const).map((vis) => ({ value: vis, label: t(`visibility.${vis}`) }))}
        />
        <p className="text-sm leading-5 text-muted-foreground">{t(`visibility.${values.visibility}Helper`)}</p>
      </section>

      {initial.hasStudioContent ? (
        <Notice tone="info" title={t('more.badge')}>
          {t('more.body')}
        </Notice>
      ) : null}


      <ConfirmDialog
        open={confirm === 'discard' || confirm === 'delete'}
        title={confirm === 'discard' ? t('confirm.discardTitle') : t('confirm.deleteTitle', { title })}
        body={confirm === 'discard' ? t('confirm.discardBody') : t('confirm.deleteBody', { title })}
        confirmLabel={confirm === 'discard' ? t('discard') : t('delete')}
        busy={confirmBusy}
        error={confirmError}
        onConfirm={() => void runConfirm()}
        onCancel={() => {
          setConfirm(null)
          setConfirmError(null)
        }}
      />
      <ConfirmDialog
        open={confirm === 'unpublish'}
        title={t('confirm.unpublishTitle', { title })}
        body={t('confirm.unpublishBody')}
        confirmLabel={tl('actions.unpublish')}
        cancelLabel={t('confirm.unpublishKeep')}
        busy={confirmBusy}
        error={confirmError}
        onConfirm={() => void runConfirm()}
        onCancel={() => {
          setConfirm(null)
          setConfirmError(null)
        }}
      />
      <DeletePermanentlyDialog
        open={confirm === 'deletePermanently'}
        titles={[title]}
        busy={confirmBusy}
        error={confirmError}
        onConfirm={() => void runConfirm()}
        onCancel={() => {
          setConfirm(null)
          setConfirmError(null)
        }}
      />
      <UnpublishDateSheet
        open={dateSheet}
        busy={busy}
        zone={zone}
        onClose={() => setDateSheet(false)}
        onSave={(iso) => void changeDates({ until: iso }, t('toast.unpublishDateSaved', { date: when(iso) }))}
        onRemove={life.unpublishOn ? () => void changeDates({ until: null }, t('toast.unpublishDateRemoved')) : undefined}
      />
      <EventActivitySheet open={activity} onClose={() => setActivity(false)} projectSlug={projectSlug} eventId={id} />

      <Toast message={toast?.message ?? null} tone={toast?.tone} action={toast?.undo ? t('undo') : undefined} onAction={toast?.undo} />
    </div>
  )
}
