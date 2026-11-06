'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import type { CourseImage, CourseSnapshot, CourseState, CourseUsage } from '@/lib/api/course-drafts'
import {
  courseLifecycleAction,
  discardCourseDraftAction,
  getCourseAction,
  openCourseForEditAction,
  publishCourseDraftAction,
  saveCourseDraftAction,
  setCoursePublishDateAction,
  unscheduleCourseAction,
} from '@/app/[locale]/(client)/[tenant]/courses/actions'
import { useAutosave } from '@/lib/client/autosave/use-autosave'
import type { PendingSet } from '@/lib/client/autosave/journal'
import { COURSE_COLORS, type CourseColor } from '@/lib/modules/courses/model'
import type { CoursePlacement } from '@/lib/modules/courses/placement'
import { useDateLocale } from '@/lib/i18n/date-locale-context'
import { PublicationDates } from '@/components/app/lifecycle/PublicationDates'
import { PublicationDateField } from '@/components/app/lifecycle/PublicationDateField'
import { shortMoment } from '@/components/app/lifecycle/publish-plan'
import { editingZone } from '@/components/app/lifecycle/zoned-time'
import { DeletePermanentlyDialog } from '@/components/app/lifecycle/DeletePermanentlyDialog'
import { BackLink } from '@/components/app/ui/BackLink'
import { Button } from '@/components/app/ui/Button'
import { buttonClass } from '@/components/app/ui/button-styles'
import { MediaFrame } from '@/components/app/ui/list/cells'
import { MediaLibraryPicker } from '@/components/client/media/MediaLibraryPicker'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Panel } from '@/components/app/ui/Panel'
import { SaveNotice } from '@/components/app/ui/SaveNotice'
import { SavePill } from '@/components/app/ui/SavePill'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { TextArea, TextInput } from '@/components/app/ui/TextInput'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { CourseActivitySheet } from './CourseActivitySheet'
import { CoursePreviewButton } from './CoursePreviewButton'
import { COURSE_UI_LIMITS, CourseStateBadge } from './course-bits'

type Values = { title: Record<string, string>; shortDescription: Record<string, string>; color: CourseColor; image: CourseImage | null }

const valuesOf = (s: CourseSnapshot): Values => ({ title: s.title, shortDescription: s.shortDescription, color: s.color, image: s.image })

type Confirm = 'discard' | 'delete' | 'deletePermanently' | null

const H2 = 'text-[1.0625rem] leading-7 font-semibold text-foreground'

/**
 * The course editor (ADR-045) — one page, autosaved to the draft (platform
 * rule: incomplete drafts always save; there is no Save button).
 *
 *   Words      title and short description per language of the site · colour
 *   Classes    the course's weekly classes (scheduling wave): the `classes`
 *              prop, else an empty `data-slot="course-classes"` region
 *
 * Publish = online: the course goes on the website through a timetable on a
 * published page (`placement`). Without one, Publish is explained and off
 * ("your website has no timetable showing it"). "Publish on…" schedules it
 * (published document, future date); a scheduled course can change date,
 * go online now, or go back to draft. "View on website" opens that timetable.
 *
 * Publish · Discard changes · Archive / Restore · Delete (Owner, only for a
 * never-published draft or an archived course with no classes) are in the
 * page's header and ⋯ menu. The first edit of a published course opens its
 * draft (from the browser — never on GET). Archived courses are read-only
 * until restored.
 */
export function CourseEditor({
  projectSlug,
  initial,
  canWrite = true,
  canDelete = false,
  placement = null,
  canOpenStudio = false,
  classes,
}: {
  projectSlug: string
  initial: CourseSnapshot
  /** courses.course.write (the server re-checks). Without it the editor is read-only. Archive and restore need it too. */
  canWrite?: boolean
  canDelete?: boolean
  /** Where the website shows this course (a timetable on a published page); null = not checked (the server decides on Publish). */
  placement?: CoursePlacement | null
  /** The person is a platform administrator: the "can't go online" notice offers a link to Studio, where a timetable section is added to a page. */
  canOpenStudio?: boolean
  /** The Classes panel (scheduling wave). Omitted → an empty `data-slot="course-classes"` region. */
  classes?: ReactNode
}) {
  const t = useTranslations('clientDashboard.courses.editor')
  const te = useTranslations('clientDashboard.courses.errors')
  const tl = useTranslations('app.lifecycle')
  const router = useRouter()
  const uiLocale = useLocale()
  const tp = useTranslations('app.lifecycle.publish')
  const dateLocale = useDateLocale()
  const zone = editingZone(initial.site.timeZone)
  const when = (iso: string) => tp('moment', shortMoment(iso, zone, dateLocale))
  const id = initial.id
  const listHref = `/${projectSlug}/courses`
  const languages = initial.site.languages.length ? initial.site.languages : [initial.site.defaultLocale]
  const d = initial.site.defaultLocale || languages[0]

  const languageName = (code: string): string => {
    try {
      return new Intl.DisplayNames([uiLocale], { type: 'language' }).of(code) ?? code.toUpperCase()
    } catch {
      return code.toUpperCase()
    }
  }

  // ── State ──────────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<{ state: CourseState; hasDraft: boolean; isPublished: boolean; publishedAt: string | null }>({ state: initial.state, hasDraft: initial.hasDraft, isPublished: initial.isPublished, publishedAt: initial.publishedAt })
  /** "Publish on" — the chosen go-live moment (UTC ISO) of a never-published course. */
  const [publishAt, setPublishAt] = useState<string | null>(null)
  const [values, setValues] = useState<Values>(() => valuesOf(initial))
  const valuesRef = useRef(values)
  const [lang, setLang] = useState(d)
  const [picking, setPicking] = useState(false)
  /** A server draft exists (decides whether the next save must open one first). */
  const hasDraftRef = useRef(initial.hasDraft)

  const archived = status.state === 'archived'
  const editable = canWrite && !archived

  const apply = useCallback((s: CourseSnapshot) => {
    hasDraftRef.current = s.hasDraft
    setStatus({ state: s.state, hasDraft: s.hasDraft, isPublished: s.isPublished, publishedAt: s.publishedAt })
    const next = valuesOf(s)
    valuesRef.current = next
    setValues(next)
  }, [])

  // ── Autosave (draft) ───────────────────────────────────────────────────────
  const send = useCallback(
    async (input: { rev: string; set: PendingSet }) => {
      let rev = input.rev
      if (!hasDraftRef.current || !rev) {
        // A published course: the first change opens the draft (an exact copy).
        const opened = await openCourseForEditAction({ projectSlug, id })
        if (!opened.ok) return { ok: false, error: opened.error } as const
        rev = opened.rev
        hasDraftRef.current = true
      }
      const r = await saveCourseDraftAction({ projectSlug, id, rev, set: input.set })
      return r.ok ? ({ ok: true, rev: r.rev } as const) : ({ ok: false, error: r.error } as const)
    },
    [projectSlug, id]
  )
  /** Set once useAutosave exists (below): a reload must hand the server's revision to the engine. */
  const adoptRevRef = useRef<(rev: string) => void>(() => {})
  const reload = useCallback(async () => {
    const r = await getCourseAction({ projectSlug, id })
    if (r.ok) {
      apply(r.course)
      // Archive / restore / discard change the draft's revision: without this
      // the next autosave would be refused as "edited elsewhere".
      if (r.course.rev) adoptRevRef.current(r.course.rev)
    }
    return r.ok
  }, [projectSlug, id, apply])
  /** A tab closed mid-save is replayed by the engine; once it lands, show what the server now holds. */
  const [replayed, setReplayed] = useState(false)
  const onReady = useCallback((r: PendingSet | null) => {
    if (r && Object.keys(r).length) setReplayed(true)
  }, [])
  const autosave = useAutosave({ draftId: `course:${id}`, rev: initial.rev, send, onReady })
  const adoptRev = autosave.adoptRev
  useEffect(() => {
    adoptRevRef.current = adoptRev
  }, [adoptRev])
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

  const [notice, setNotice] = useState<string | null>(null)
  const errorText = (code: string, usedIn?: CourseUsage[]) => {
    if (code === 'in_use' && usedIn?.length) {
      return usedIn.some((u) => u.kind === 'classes') ? te('in_use_classes') : te('in_use_where', { places: usedIn.map((u) => u.title).filter(Boolean).join(', ') })
    }
    return te.has(code) ? te(code) : te('failed')
  }
  const { toast, show, schedule } = useUndo()

  /** Every change goes through here: shown at once, autosaved after a pause. */
  const change = (patch: Partial<Values>, set: PendingSet) => {
    if (!editable) return
    const next = { ...valuesRef.current, ...patch }
    valuesRef.current = next
    setValues(next)
    setStatus((s) => (s.hasDraft ? s : { ...s, hasDraft: true, state: s.state === 'scheduled' ? 'scheduled' : s.isPublished ? 'changes' : 'draft' }))
    autosave.set(set)
  }
  const setText = (field: 'title' | 'shortDescription', value: string) => {
    const cur = valuesRef.current
    change({ [field]: { ...cur[field], [lang]: value } }, { [`${field}.${lang}`]: value })
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  const [activity, setActivity] = useState(false)
  const [busy, setBusy] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  /** Everything typed is on the server (or say why not). */
  const flushed = async (): Promise<boolean> => {
    if (await autosave.flush()) return true
    setNotice(te(autosave.currentState() === 'conflict' ? 'conflict' : 'offline'))
    return false
  }

  const displayName = (values.title[d] ?? '').trim() || Object.values(values.title).find((x) => x.trim()) || t('untitled')
  const missingTitle = !(values.title[d] ?? '').trim()
  const scheduled = status.state === 'scheduled'
  /** Online now (published, its date passed or none). */
  const live = status.isPublished && !scheduled && !archived
  /** Nothing on the website would show this course: it cannot go online (a live course being updated is not affected). */
  const noPage = placement !== null && !placement.onWebsite && !live
  const publishReason = !editable ? null : !status.hasDraft && !scheduled ? t('publishReason.upToDate') : null
  const viewUrl = live ? (placement?.url ?? null) : null
  const viewOnWebsite = () => {
    if (viewUrl) window.open(viewUrl, '_blank', 'noopener,noreferrer')
  }

  /** The server's answer to a publish / schedule: what the course is now. */
  const landed = (r: { publishedAt: string | null }, toast: string, state: CourseState) => {
    hasDraftRef.current = false
    setStatus((s) => ({ ...s, hasDraft: false, isPublished: true, state, publishedAt: r.publishedAt }))
    show({ message: toast, tone: 'status' })
    router.refresh()
  }

  async function publish() {
    if (busy || publishReason || missingTitle || noPage) return
    setBusy(true)
    setPublishing(true)
    setNotice(null)
    try {
      if (!(await flushed())) return
      // Online already → an update keeps its date. A scheduled course published "now" goes online now.
      const update = status.isPublished && !scheduled
      const r =
        scheduled && !status.hasDraft
          ? await setCoursePublishDateAction({ projectSlug, id, mode: 'now' })
          : await publishCourseDraftAction({ projectSlug, id, rev: autosave.currentRev(), mode: update ? 'keep' : 'now' })
      if (!r.ok) return setNotice(errorText(r.error, r.detail?.usedIn))
      await autosave.discard()
      landed({ publishedAt: r.publishedAt }, update ? t('published') : t('publishedNowToast'), 'published')
    } catch {
      setNotice(te('failed'))
    } finally {
      setBusy(false)
      setPublishing(false)
    }
  }

  /** "Publish on…" for a never-published course: published with a future date, online by itself then. */
  async function schedule_() {
    if (busy || missingTitle || noPage || !publishAt) return
    setBusy(true)
    setNotice(null)
    try {
      if (!(await flushed())) return
      const r = await publishCourseDraftAction({ projectSlug, id, rev: autosave.currentRev(), mode: 'schedule', publishAt })
      if (!r.ok) return setNotice(errorText(r.error))
      await autosave.discard()
      landed({ publishedAt: r.publishedAt }, t('scheduledToast', { date: when(r.publishedAt ?? publishAt) }), 'scheduled')
      setPublishAt(null)
    } catch {
      setNotice(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  /** A scheduled course: new date (`from`), or null = online now. Its content is not touched. */
  async function changeDate(from: string | null) {
    if (busy || noPage) return
    setBusy(true)
    setNotice(null)
    try {
      if (!(await flushed())) return
      const r = await setCoursePublishDateAction(from ? { projectSlug, id, mode: 'schedule', publishAt: from } : { projectSlug, id, mode: 'now' })
      if (!r.ok) return setNotice(errorText(r.error))
      // The dates are written on the draft too: adopt its new revision.
      await reload()
      show({ message: from ? t('dateSaved') : t('publishedNowToast'), tone: 'status' })
      router.refresh()
    } catch {
      setNotice(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  /** A scheduled course with edits: put the edits into the scheduled version (date unchanged). */
  async function updateScheduled() {
    if (busy || missingTitle || !status.hasDraft) return
    setBusy(true)
    setNotice(null)
    try {
      if (!(await flushed())) return
      const r = await publishCourseDraftAction({ projectSlug, id, rev: autosave.currentRev(), mode: 'keep' })
      if (!r.ok) return setNotice(errorText(r.error))
      await autosave.discard()
      landed({ publishedAt: r.publishedAt }, t('updatedScheduledToast', { date: status.publishedAt ? when(status.publishedAt) : '' }), 'scheduled')
    } catch {
      setNotice(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  /** A scheduled course goes back to being a draft. */
  async function backToDraft() {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      if (!(await flushed())) return
      const r = await unscheduleCourseAction({ projectSlug, id })
      if (!r.ok) return setNotice(errorText(r.error))
      await reload()
      show({ message: t('backToDraftDone'), tone: 'status' })
      router.refresh()
    } catch {
      setNotice(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  async function runConfirm() {
    if (!confirm || busy) return
    setBusy(true)
    setConfirmError(null)
    try {
      if (confirm === 'discard') {
        await autosave.flush()
        const r = await discardCourseDraftAction({ projectSlug, id, rev: autosave.currentRev() })
        if (!r.ok) return setConfirmError(errorText(r.error))
        await autosave.discard()
        await reload()
        setConfirm(null)
        show({ message: t('discarded'), tone: 'status' })
        return
      }
      const op = confirm === 'delete' ? 'deleteDraft' : 'deletePermanently'
      const r = await courseLifecycleAction({ projectSlug, id, op })
      if (!r.ok) return setConfirmError(errorText(r.error, r.detail?.usedIn))
      await autosave.discard()
      setConfirm(null)
      router.push(listHref)
    } catch {
      setConfirmError(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  async function restore() {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const r = await courseLifecycleAction({ projectSlug, id, op: 'restore' })
      if (!r.ok) return setNotice(errorText(r.error, r.detail?.usedIn))
      await reload()
      show({ message: t('restored'), tone: 'status' })
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
    if (!(await flushed())) return
    const before = status
    setNotice(null)
    setStatus((x) => ({ ...x, state: 'archived' }))
    schedule({
      id: `archive:${id}`,
      message: t('archived'),
      undoLabel: t('undo'),
      failMessage: te('failed'),
      restore: () => setStatus(before),
      run: async () => {
        const r = await courseLifecycleAction({ projectSlug, id, op: 'archive' })
        if (!r.ok) {
          setStatus(before)
          setNotice(errorText(r.error, r.detail?.usedIn))
          return false
        }
        await reload()
        router.refresh()
        return true
      },
    })
  }

  const menu: CardMenuItem[] = []
  if (editable && status.isPublished && status.hasDraft) menu.push({ key: 'discard', label: t('menu.discard'), onSelect: () => setConfirm('discard') })
  if (viewUrl) menu.push({ key: 'viewOnWebsite', label: t('viewOnWebsite'), onSelect: viewOnWebsite })
  menu.push({ key: 'activity', label: t('menu.activity'), onSelect: () => setActivity(true) })
  if (canWrite) {
    if (archived) menu.push({ key: 'restore', label: tl('actions.restore'), onSelect: () => void restore() })
    else if (status.isPublished && !scheduled) menu.push({ key: 'archive', label: tl('actions.archive'), onSelect: () => void archiveWithUndo() })
  }
  if (canDelete) {
    if (archived) menu.push({ key: 'deletePermanently', label: tl('actions.deletePermanently'), onSelect: () => setConfirm('deletePermanently'), destructive: true, separated: true })
    else if (!status.isPublished) menu.push({ key: 'delete', label: tl('actions.delete'), onSelect: () => setConfirm('delete'), destructive: true, separated: true })
  }

  const colorLabel = (c: CourseColor) => t(`color.${c}`)

  /** The image is a Media Library asset: picked here, saved to the draft as its id (null removes it). */
  const chooseImage = (photo: { assetId: string; url: string; alt: Record<string, string> } | null) => {
    setPicking(false)
    change({ image: photo ? { assetId: photo.assetId, url: photo.url, alt: photo.alt } : null }, { image: photo ? photo.assetId : null })
  }

  return (
    <div className="space-y-5">
      <BackLink href={listHref} label={t('back')} />
      <div className="-mt-3">
        <PageHeader
          title={displayName}
          actions={
            <>
              {editable ? <SavePill state={autosave.state} onReload={() => window.location.reload()} /> : null}
              {editable ? <CoursePreviewButton projectSlug={projectSlug} courseId={id} language={lang} beforeOpen={flushed} /> : null}
              {editable ? (
                <Button variant="primary" disabled={busy || !!publishReason || missingTitle || noPage} aria-describedby={publishReason || missingTitle ? 'course-publish-reason' : noPage ? 'course-no-page' : undefined} onClick={() => void publish()}>
                  {publishing ? t('publishing') : scheduled ? t('publishNow') : t('publish')}
                </Button>
              ) : null}
              <CardMenu label={t('menu.label')} items={menu} />
            </>
          }
        />
      </div>

      <div className="flex flex-col items-start gap-2">
        <CourseStateBadge state={status.state} publishedAt={status.publishedAt} zone={zone} />
        {editable && (publishReason || missingTitle) ? (
          <p id="course-publish-reason" className="text-sm leading-5 text-muted-foreground">
            {missingTitle ? t('publishBlocked', { language: languageName(d) }) : publishReason}
          </p>
        ) : null}
      </div>

      {editable && noPage ? (
        <Notice
          tone="info"
          id="course-no-page"
          title={t('noPageTitle')}
          action={
            canOpenStudio ? (
              <a href="/studio" target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: 'secondary' })}>
                {t('noPageStudio')}
                <span className="sr-only"> ({t('opensInNewTab')})</span>
              </a>
            ) : undefined
          }
        >
          {t('noPageBody')}
          {canOpenStudio ? null : ` ${t('noPageAskAdmin')}`}
        </Notice>
      ) : null}

      {editable ? <SaveNotice state={autosave.state} rejected={autosave.rejected.map(() => 'other')} onRetry={autosave.retry} onReload={() => window.location.reload()} /> : null}
      {archived ? (
        <Notice tone="info" title={t('archivedTitle')} action={canWrite ? <Button onClick={() => void restore()}>{tl('actions.restore')}</Button> : undefined}>
          {t('archivedBody')}
        </Notice>
      ) : !canWrite ? (
        <Notice tone="info">{t('readOnly')}</Notice>
      ) : null}
      {notice ? (
        <Notice tone="error" onDismiss={() => setNotice(null)} dismissLabel={t('dismiss')}>
          {notice}
        </Notice>
      ) : null}

      <Panel as="section" aria-labelledby="course-words" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="course-words" className={H2}>
            {t('wordsTitle')}
          </h2>
          {languages.length > 1 ? (
            <SegmentedControl label={t('language')} appearance="soft" value={lang} onChange={setLang} options={languages.map((l) => ({ value: l, label: l.toUpperCase() }))} />
          ) : null}
        </div>
        <Field label={t('titleLabel')} hint={lang !== d ? t('titleOtherLanguage', { language: languageName(d) }) : undefined} error={editable && lang === d && missingTitle ? t('titleRequired') : undefined}>
          {(p) => (
            <TextInput
              {...p}
              value={values.title[lang] ?? ''}
              readOnly={!editable}
              maxLength={COURSE_UI_LIMITS.title}
              autoComplete="off"
              onChange={(e) => setText('title', e.target.value)}
            />
          )}
        </Field>
        <Field label={t('shortDescriptionLabel')} hint={t('shortDescriptionHint')}>
          {(p) => (
            <TextArea
              {...p}
              rows={3}
              value={values.shortDescription[lang] ?? ''}
              readOnly={!editable}
              maxLength={COURSE_UI_LIMITS.shortDescription}
              onChange={(e) => setText('shortDescription', e.target.value)}
            />
          )}
        </Field>
        <div className="space-y-2">
          <p className="text-[0.9375rem] font-medium text-foreground">{t('imageLabel')}</p>
          <div className="flex flex-wrap items-end gap-3">
            <MediaFrame src={values.image?.url ?? null} alt={values.image?.alt[d] ?? ''} size={{ width: '12rem', height: '8rem' }} className="rounded-xl border border-border" />
            {editable ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setPicking(true)}>{values.image ? t('imageChange') : t('imageChoose')}</Button>
                {values.image ? <Button onClick={() => chooseImage(null)}>{t('imageRemove')}</Button> : null}
              </div>
            ) : null}
          </div>
          <p className="text-sm leading-5 text-muted-foreground">{t('imageHint')}</p>
        </div>
        <div className="space-y-2">
          <p className="text-[0.9375rem] font-medium text-foreground">{t('colorLabel')}</p>
          <SegmentedControl
            label={t('colorLabel')}
            appearance="soft"
            value={values.color}
            onChange={(c: CourseColor) => change({ color: c }, { color: c })}
            options={COURSE_COLORS.map((c) => ({ value: c, label: colorLabel(c), disabled: !editable }))}
          />
          <p className="text-sm leading-5 text-muted-foreground">{t('colorHint')}</p>
        </div>
      </Panel>

      {!archived ? (
        <Panel as="section" aria-labelledby="course-online" className="space-y-4">
          <h2 id="course-online" className={H2}>
            {t('onlineTitle')}
          </h2>
          {live ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[0.9375rem] leading-6 text-foreground">{t('onlineLive')}</p>
              {viewUrl ? (
                <Button variant="secondary" onClick={viewOnWebsite}>
                  {t('viewOnWebsite')}
                </Button>
              ) : null}
            </div>
          ) : scheduled && status.publishedAt ? (
            <div className="space-y-3">
              <PublicationDates
                id="course-dates"
                from={status.publishedAt}
                until={null}
                allowUntil={false}
                zone={zone}
                busy={busy || !editable}
                onChange={({ from }) => void changeDate(from)}
                sentence={t('scheduledSentence', { date: when(status.publishedAt) })}
              />
              {status.hasDraft ? <p className="text-sm leading-5 text-muted-foreground">{t('changesNotScheduled')}</p> : null}
              {editable ? (
                <div className="flex flex-wrap gap-2">
                  {status.hasDraft ? (
                    <Button variant="secondary" disabled={busy || missingTitle} onClick={() => void updateScheduled()}>
                      {t('updateScheduled')}
                    </Button>
                  ) : null}
                  <Button variant="quiet" disabled={busy} onClick={() => void backToDraft()}>
                    {t('backToDraft')}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('notOnlineYet')}</p>
              {editable ? (
                <div className="space-y-3">
                  <PublicationDateField id="course-publish-on" label={t('publishOn')} value={publishAt} onChange={setPublishAt} zone={zone} />
                  <p className="text-sm leading-5 text-muted-foreground">{t('scheduleHelp')}</p>
                  <Button variant="secondary" disabled={busy || !publishAt || missingTitle || noPage} onClick={() => void schedule_()}>
                    {t('schedule')}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </Panel>
      ) : null}

      <section aria-labelledby="course-classes-title" className="space-y-3">
        <h2 id="course-classes-title" className={H2}>
          {t('classesTitle')}
        </h2>
        {classes ?? <div data-slot="course-classes" />}
      </section>

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
      {picking ? (
        <MediaLibraryPicker
          projectSlug={projectSlug}
          scope="media"
          defaultLocale={d}
          exclude={values.image ? [values.image.assetId] : []}
          room={1}
          onClose={() => setPicking(false)}
          onAdd={(photos) => photos[0] && chooseImage(photos[0])}
        />
      ) : null}
      <CourseActivitySheet open={activity} onClose={() => setActivity(false)} projectSlug={projectSlug} courseId={id} />
      <Toast message={toast?.message ?? null} tone={toast?.tone} action={toast?.undo ? t('undo') : undefined} onAction={toast?.undo} />
    </div>
  )
}
