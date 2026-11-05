'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import type { CourseSnapshot, CourseState, CourseUsage } from '@/lib/api/course-drafts'
import {
  courseLifecycleAction,
  discardCourseDraftAction,
  getCourseAction,
  openCourseForEditAction,
  publishCourseDraftAction,
  saveCourseDraftAction,
} from '@/app/[locale]/(client)/[tenant]/courses/actions'
import { useAutosave } from '@/lib/client/autosave/use-autosave'
import type { PendingSet } from '@/lib/client/autosave/journal'
import { COURSE_COLORS, type CourseColor } from '@/lib/modules/courses/model'
import { DeletePermanentlyDialog } from '@/components/app/lifecycle/DeletePermanentlyDialog'
import { BackLink } from '@/components/app/ui/BackLink'
import { Button } from '@/components/app/ui/Button'
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
import { COURSE_UI_LIMITS, CourseStateBadge } from './course-bits'

type Values = { title: Record<string, string>; shortDescription: Record<string, string>; color: CourseColor }

const valuesOf = (s: CourseSnapshot): Values => ({ title: s.title, shortDescription: s.shortDescription, color: s.color })

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
  classes,
}: {
  projectSlug: string
  initial: CourseSnapshot
  /** courses.course.write (the server re-checks). Without it the editor is read-only. Archive and restore need it too. */
  canWrite?: boolean
  canDelete?: boolean
  /** The Classes panel (scheduling wave). Omitted → an empty `data-slot="course-classes"` region. */
  classes?: ReactNode
}) {
  const t = useTranslations('clientDashboard.courses.editor')
  const te = useTranslations('clientDashboard.courses.errors')
  const tl = useTranslations('app.lifecycle')
  const router = useRouter()
  const uiLocale = useLocale()
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
  const [status, setStatus] = useState<{ state: CourseState; hasDraft: boolean; isPublished: boolean }>({ state: initial.state, hasDraft: initial.hasDraft, isPublished: initial.isPublished })
  const [values, setValues] = useState<Values>(() => valuesOf(initial))
  const valuesRef = useRef(values)
  const [lang, setLang] = useState(d)
  /** A server draft exists (decides whether the next save must open one first). */
  const hasDraftRef = useRef(initial.hasDraft)

  const archived = status.state === 'archived'
  const editable = canWrite && !archived

  const apply = useCallback((s: CourseSnapshot) => {
    hasDraftRef.current = s.hasDraft
    setStatus({ state: s.state, hasDraft: s.hasDraft, isPublished: s.isPublished })
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
    setStatus((s) => (s.hasDraft ? s : { ...s, hasDraft: true, state: s.isPublished ? 'changes' : 'draft' }))
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
  const publishReason = !editable ? null : !status.hasDraft ? t('publishReason.upToDate') : null

  async function publish() {
    if (busy || publishReason || missingTitle) return
    setBusy(true)
    setPublishing(true)
    setNotice(null)
    try {
      if (!(await flushed())) return
      const r = await publishCourseDraftAction({ projectSlug, id, rev: autosave.currentRev() })
      if (!r.ok) return setNotice(errorText(r.error, r.detail?.usedIn))
      hasDraftRef.current = false
      await autosave.discard()
      setStatus((s) => ({ ...s, hasDraft: false, isPublished: true, state: 'published' }))
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
  menu.push({ key: 'activity', label: t('menu.activity'), onSelect: () => setActivity(true) })
  if (canWrite) {
    if (archived) menu.push({ key: 'restore', label: tl('actions.restore'), onSelect: () => void restore() })
    else if (status.isPublished) menu.push({ key: 'archive', label: tl('actions.archive'), onSelect: () => void archiveWithUndo() })
  }
  if (canDelete) {
    if (archived) menu.push({ key: 'deletePermanently', label: tl('actions.deletePermanently'), onSelect: () => setConfirm('deletePermanently'), destructive: true, separated: true })
    else if (!status.isPublished) menu.push({ key: 'delete', label: tl('actions.delete'), onSelect: () => setConfirm('delete'), destructive: true, separated: true })
  }

  const colorLabel = (c: CourseColor) => t(`color.${c}`)

  return (
    <div className="space-y-5">
      <BackLink href={listHref} label={t('back')} />
      <div className="-mt-3">
        <PageHeader
          title={displayName}
          actions={
            <>
              {editable ? <SavePill state={autosave.state} onReload={() => window.location.reload()} /> : null}
              {editable ? (
                <Button variant="primary" disabled={busy || !!publishReason || missingTitle} aria-describedby={publishReason || missingTitle ? 'course-publish-reason' : undefined} onClick={() => void publish()}>
                  {publishing ? t('publishing') : t('publish')}
                </Button>
              ) : null}
              <CardMenu label={t('menu.label')} items={menu} />
            </>
          }
        />
      </div>

      <div className="flex flex-col items-start gap-2">
        <CourseStateBadge state={status.state} />
        {editable && (publishReason || missingTitle) ? (
          <p id="course-publish-reason" className="text-sm leading-5 text-muted-foreground">
            {missingTitle ? t('publishBlocked', { language: languageName(d) }) : publishReason}
          </p>
        ) : null}
      </div>

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
      <CourseActivitySheet open={activity} onClose={() => setActivity(false)} projectSlug={projectSlug} courseId={id} />
      <Toast message={toast?.message ?? null} tone={toast?.tone} action={toast?.undo ? t('undo') : undefined} onAction={toast?.undo} />
    </div>
  )
}
