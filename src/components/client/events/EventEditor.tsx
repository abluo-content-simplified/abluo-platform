'use client'

import { BackLink } from '@/components/app/ui/BackLink'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
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
import { MediaFrame } from '@/components/app/ui/list/cells'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { EVENT_ICONS, EventStatePill, eventState } from './event-bits'
import { Button } from '@/components/app/ui/Button'
import { FieldLabel } from '@/components/app/ui/FieldLabel'
import { TextArea, TextInput } from '@/components/app/ui/TextInput'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { DateTimePicker } from '@/components/app/ui/DateTimePicker'
import { Notice } from '@/components/app/ui/Notice'
import { TermPicker } from '@/components/client/taxonomy/TermPicker'
import { editingZone } from '@/components/app/lifecycle/zoned-time'

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
}
const CHOICES = ['visibility', 'eventStatus', 'attendanceMode', 'place'] as const

const SAVE_DELAY_MS = 800
const PUBLISH_ERRORS = ['missing_title', 'missing_date', 'conflict', 'forbidden', 'failed']
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
 */
export function EventEditor({ projectSlug, initial, canWrite, canDelete, canAddCategory = false }: { projectSlug: string; initial: EventSnapshot; canWrite: boolean; canDelete: boolean; /** Holds events.taxonomy.write: the category field offers "+ Add category" (and shows even with no category yet). */ canAddCategory?: boolean }) {
  const t = useTranslations('clientDashboard.events.editor')
  const te = useTranslations('clientDashboard.events.errors')
  const ui = useLocale()
  const router = useRouter()
  const ids = { title: useId(), shortDescription: useId(), location: useId(), registrationLabel: useId(), start: useId(), end: useId(), url: useId() }
  const { site, id, placeOptions, capabilities: caps } = initial
  const d = site.defaultLocale
  const zone = editingZone(site.timeZone)
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
      <BackLink href={base} label={t('back')} />
      <div className="-mt-4">
        <PageHeader
          title={title}
          actions={
            <>
              {canPublish ? (
                <Button variant="primary" disabled={busy} onClick={() => void publish()}>
                  {busy ? t('publishing') : isPublished ? t('publishChanges') : t('publish')}
                </Button>
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
              <Button disabled={busy} onClick={() => setPicking(true)}>
                {EVENT_ICONS.photo}
                {cover ? t('photo.change') : t('photo.choose')}
              </Button>
              {cover ? (
                <Button disabled={busy} onClick={() => void chooseCover(null)}>
                  {t('photo.remove')}
                </Button>
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
      {initial.categoryOptions.length > 0 || initial.categories.length > 0 || (canAddCategory && canWrite) ? (
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
            canAdd={canAddCategory && canWrite}
            disabled={disabled}
          />
          <p className="text-sm leading-5 text-muted-foreground">{t('categories.helper')}</p>
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
