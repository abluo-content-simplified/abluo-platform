'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import {
  discardEventDraftAction,
  openEventForEditAction,
  patchEventDraftAction,
  publishEventDraftAction,
  setEventCoverAction,
} from '@/app/[locale]/(client)/[tenant]/agenda/actions'
import type { EventCover, EventSnapshot } from '@/lib/api/event-drafts'
import { languageName } from '@/components/client/create/StepHeading'
import { MediaLibraryPicker } from '@/components/client/media/MediaLibraryPicker'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { MediaFrame, Pill } from '@/components/app/ui/list/cells'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { EVENT_BUTTON, EVENT_ICONS, EVENT_INPUT, EVENT_LABEL, EVENT_PRIMARY, EventStatePill, eventState, inputToIso, isoToInput } from './event-bits'

const TEXT_FIELDS = ['title', 'shortDescription', 'location', 'registrationLabel'] as const
type TextField = (typeof TEXT_FIELDS)[number]
type Texts = Record<TextField, Record<string, string>>
type Values = { texts: Texts; start: string; end: string; url: string }

const SAVE_DELAY_MS = 800
const PUBLISH_ERRORS = ['missing_title', 'missing_date', 'conflict', 'forbidden', 'failed']
type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict' | 'invalid'

function valuesOf(e: EventSnapshot): Values {
  return {
    texts: { title: { ...e.title }, shortDescription: { ...e.shortDescription }, location: { ...e.location }, registrationLabel: { ...e.registrationLabel } },
    start: isoToInput(e.startDate),
    end: isoToInput(e.endDate),
    url: e.registrationUrl,
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
  if (from.start !== to.start && inputToIso(to.start)) set.startDate = inputToIso(to.start)
  if (from.end !== to.end) set.endDate = to.end ? inputToIso(to.end) : null
  if (from.url.trim() !== to.url.trim()) set.registrationUrl = to.url.trim()
  return set
}

/**
 * One event (client dashboard · agenda/<id>), edited in place: photo, title,
 * short description and place (per site language), when, and the sign-up
 * button. Every change is saved to the event's draft after a short pause;
 * "Publish changes" updates the website. The rest of an event (full text,
 * programme, prices, photos, streaming) is kept as it is and edited by Abluo.
 */
export function EventEditor({ projectSlug, initial, canWrite, canDelete }: { projectSlug: string; initial: EventSnapshot; canWrite: boolean; canDelete: boolean }) {
  const t = useTranslations('clientDashboard.events.editor')
  const te = useTranslations('clientDashboard.events.errors')
  const ui = useLocale()
  const router = useRouter()
  const ids = { title: useId(), shortDescription: useId(), location: useId(), registrationLabel: useId(), start: useId(), end: useId(), url: useId() }
  const { site, id } = initial
  const d = site.defaultLocale
  const base = `/${projectSlug}/agenda`

  const [values, setValues] = useState<Values>(() => valuesOf(initial))
  const saved = useRef<Values>(valuesOf(initial))
  /** The last saved values, as state (render reads this; the save queue reads the ref). */
  const [savedValues, setSavedValues] = useState<Values>(() => valuesOf(initial))
  const revRef = useRef(initial.rev)
  const [hasDraft, setHasDraft] = useState(initial.hasDraft)
  const [isPublished, setIsPublished] = useState(initial.isPublished)
  const [cover, setCover] = useState<EventCover | null>(initial.cover)
  const [locale, setLocale] = useState(d)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const { toast, show } = useUndo()
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
    if (!canWrite) return
    if (!Object.keys(diff(savedValues, values, site.locales)).length) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [values, savedValues, canWrite, flush, site.locales])

  // Save before leaving the page.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [flush])

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
      show({ message: assetId ? t('photo.saved') : t('photo.removed'), tone: 'status' })
    } catch {
      show({ message: te('failed'), tone: 'error' }, 7000)
    } finally {
      setBusy(false)
    }
  }

  async function publish() {
    if (busy) return
    setBusy(true)
    try {
      await flush()
      if (!revRef.current) return
      const r = await publishEventDraftAction({ projectSlug, id, rev: revRef.current })
      if (!r.ok) return show({ message: te(PUBLISH_ERRORS.includes(r.error) ? r.error : 'failed'), tone: 'error' }, 8000)
      revRef.current = ''
      setHasDraft(false)
      setIsPublished(true)
      setSaveState('idle')
      show({ message: t('published'), tone: 'status' })
      router.refresh()
    } catch {
      show({ message: te('failed'), tone: 'error' }, 8000)
    } finally {
      setBusy(false)
    }
  }

  async function discard() {
    if (confirmBusy) return
    setConfirmBusy(true)
    setConfirmError(null)
    try {
      await chain.current
      const r = await discardEventDraftAction({ projectSlug, id, rev: revRef.current })
      if (!r.ok) return setConfirmError(te(r.error === 'forbidden' ? 'forbidden' : 'failed'))
      if (r.deleted) router.push(base)
      else window.location.reload()
    } catch {
      setConfirmError(te('failed'))
    } finally {
      setConfirmBusy(false)
    }
  }

  const dirty = Object.keys(diff(savedValues, values, site.locales)).length > 0
  const canPublish = canWrite && (hasDraft || dirty)
  const title = values.texts.title[d]?.trim() || t('untitled')
  const others = site.locales.filter((l) => l !== d)
  const disabled = !canWrite
  const menu: CardMenuItem[] =
    canWrite && hasDraft && (isPublished || canDelete)
      ? [{ key: 'discard', label: isPublished ? t('discard') : t('delete'), onSelect: () => setConfirm(true), destructive: !isPublished }]
      : []

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
      <Link
        href={base}
        className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {EVENT_ICONS.back}
        {t('back')}
      </Link>
      <div className="-mt-4">
        <PageHeader
          title={title}
          actions={
            <>
              {canPublish ? (
                <button type="button" disabled={busy} onClick={() => void publish()} className={EVENT_PRIMARY}>
                  {busy ? t('publishing') : isPublished ? t('publishChanges') : t('publish')}
                </button>
              ) : null}
              {menu.length ? <CardMenu label={t('menu')} items={menu} /> : null}
            </>
          }
        />
      </div>

      <div className="-mt-3 flex flex-wrap items-center gap-2">
        <EventStatePill state={eventState({ isPublished, hasDraft: hasDraft || dirty })} />
        {saveLine ? (
          <p role="status" className={`text-sm leading-5 ${saveState === 'error' || saveState === 'conflict' || saveState === 'invalid' ? 'text-destructive' : 'text-muted-foreground'}`}>
            {saveLine}
          </p>
        ) : null}
      </div>
      {!canWrite ? <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('readOnly')}</p> : null}

      {/* Photo */}
      <section aria-labelledby="event-photo" className="space-y-3">
        <h2 id="event-photo" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
          {t('photo.title')}
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <MediaFrame src={cover?.thumbUrl ?? cover?.url ?? null} alt={cover?.alt[d] ?? ''} size={{ width: '12rem', height: '8rem' }} className="rounded-xl border border-border" />
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => setPicking(true)} className={EVENT_BUTTON}>
                {EVENT_ICONS.photo}
                {cover ? t('photo.change') : t('photo.choose')}
              </button>
              {cover ? (
                <button type="button" disabled={busy} onClick={() => void chooseCover(null)} className={EVENT_BUTTON}>
                  {t('photo.remove')}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <p className="text-sm leading-5 text-muted-foreground">{t('photo.helper')}</p>
      </section>

      {/* Words, per language */}
      <section aria-labelledby="event-words" className="space-y-4">
        <h2 id="event-words" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
          {t('words.title')}
        </h2>
        {others.length ? (
          <div role="group" aria-label={t('words.language')} className="flex flex-wrap gap-2">
            {site.locales.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={locale === l}
                onClick={() => setLocale(l)}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-[0.9375rem] font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                  locale === l ? 'border-action bg-action text-action-foreground' : 'border-border text-foreground hover:bg-hover'
                }`}
              >
                {languageName(l, ui)}
                {l !== d && !values.texts.title[l]?.trim() ? <span className="sr-only"> · {t('words.missing')}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
        {locale !== d && values.texts.title[d] ? (
          <p className="text-sm leading-5 text-muted-foreground">{t('words.original', { language: languageName(d, ui), title: values.texts.title[d] })}</p>
        ) : null}
        <div>
          <label htmlFor={ids.title} className={EVENT_LABEL}>
            {t('fields.title')}
          </label>
          <input id={ids.title} disabled={disabled} maxLength={160} value={values.texts.title[locale] ?? ''} onChange={(e) => setText('title', e.target.value)} className={EVENT_INPUT} />
        </div>
        <div>
          <label htmlFor={ids.shortDescription} className={EVENT_LABEL}>
            {t('fields.shortDescription')}
          </label>
          <textarea
            id={ids.shortDescription}
            disabled={disabled}
            maxLength={500}
            rows={4}
            value={values.texts.shortDescription[locale] ?? ''}
            onChange={(e) => setText('shortDescription', e.target.value)}
            className={`${EVENT_INPUT} h-auto py-3 leading-6`}
          />
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{t('fields.shortDescriptionHelper')}</p>
        </div>
        <div>
          <label htmlFor={ids.location} className={EVENT_LABEL}>
            {t('fields.location')}
          </label>
          <input id={ids.location} disabled={disabled} maxLength={160} value={values.texts.location[locale] ?? ''} onChange={(e) => setText('location', e.target.value)} placeholder={t('fields.locationPlaceholder')} className={EVENT_INPUT} />
        </div>
      </section>

      {/* When */}
      <section aria-labelledby="event-when" className="space-y-4">
        <h2 id="event-when" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
          {t('when.title')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.start} className={EVENT_LABEL}>
              {t('when.start')}
            </label>
            <input id={ids.start} type="datetime-local" disabled={disabled} value={values.start} onChange={(e) => setValues((v) => ({ ...v, start: e.target.value }))} className={EVENT_INPUT} />
          </div>
          <div>
            <label htmlFor={ids.end} className={EVENT_LABEL}>
              {t('when.end')}
            </label>
            <input id={ids.end} type="datetime-local" disabled={disabled} value={values.end} min={values.start || undefined} onChange={(e) => setValues((v) => ({ ...v, end: e.target.value }))} className={EVENT_INPUT} />
          </div>
        </div>
        <p className="text-sm leading-5 text-muted-foreground">{t('when.helper')}</p>
      </section>

      {/* Sign-up */}
      <section aria-labelledby="event-signup" className="space-y-4">
        <h2 id="event-signup" className="text-[1.0625rem] leading-7 font-semibold text-foreground">
          {t('signup.title')}
        </h2>
        <div>
          <label htmlFor={ids.url} className={EVENT_LABEL}>
            {t('signup.link')}
          </label>
          <input id={ids.url} type="url" inputMode="url" disabled={disabled} maxLength={500} value={values.url} onChange={(e) => setValues((v) => ({ ...v, url: e.target.value }))} placeholder={t('signup.linkPlaceholder')} className={EVENT_INPUT} />
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{t('signup.linkHelper')}</p>
        </div>
        <div>
          <label htmlFor={ids.registrationLabel} className={EVENT_LABEL}>
            {t('signup.label')}
            {others.length ? <span className="font-normal text-muted-foreground"> · {languageName(locale, ui)}</span> : null}
          </label>
          <input
            id={ids.registrationLabel}
            disabled={disabled}
            maxLength={40}
            value={values.texts.registrationLabel[locale] ?? ''}
            onChange={(e) => setText('registrationLabel', e.target.value)}
            placeholder={t('signup.labelPlaceholder')}
            className={EVENT_INPUT}
          />
        </div>
      </section>

      {initial.hasStudioContent ? (
        <div className="rounded-2xl border border-border-subtle bg-muted px-4 py-3">
          <Pill tone="muted">{t('more.badge')}</Pill>
          <p className="mt-2 text-[0.9375rem] leading-6 text-muted-foreground">{t('more.body')}</p>
        </div>
      ) : null}

      {picking ? (
        <MediaLibraryPicker
          projectSlug={projectSlug}
          scope="media"
          defaultLocale={d}
          exclude={cover ? [cover.assetId] : []}
          room={1}
          onClose={() => setPicking(false)}
          onAdd={(photos) => photos[0] && void chooseCover(photos[0].assetId)}
        />
      ) : null}

      <ConfirmDialog
        open={confirm}
        title={isPublished ? t('confirm.discardTitle') : t('confirm.deleteTitle')}
        body={isPublished ? t('confirm.discardBody') : t('confirm.deleteBody', { title })}
        confirmLabel={isPublished ? t('discard') : t('delete')}
        busy={confirmBusy}
        error={confirmError}
        onConfirm={() => void discard()}
        onCancel={() => {
          setConfirm(false)
          setConfirmError(null)
        }}
      />

      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </div>
  )
}
