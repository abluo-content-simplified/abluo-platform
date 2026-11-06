'use client'

import { CreateAction } from '@/components/app/ui/CreateAction'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from 'next/navigation'
import { getPathname, useRouter as useAppRouter } from '@/i18n/navigation'
import type { CourseListItem, CourseUsage } from '@/lib/api/course-drafts'
import { courseLifecycleAction } from '@/app/[locale]/(client)/[tenant]/courses/actions'
import {
  activeCourseFilterCount,
  applyCourseFilters,
  courseFiltersToParams,
  courseStateCounts,
  DEFAULT_COURSE_FILTERS,
  isDefaultCourseFilters,
  nextCourseSort,
  parseCourseFilters,
  type CourseFilters,
  type CourseSortColumn,
} from '@/lib/client/courses-filter'
import { DeletePermanentlyDialog } from '@/components/app/lifecycle/DeletePermanentlyDialog'
import { Button, ButtonLink } from '@/components/app/ui/Button'
import type { CardMenuItem } from '@/components/app/ui/CardMenu'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { useViewPreference } from '@/components/app/ui/use-view-preference'
import { ViewSwitch } from '@/components/app/ui/ViewSwitch'
import { CoursesFilters } from './CoursesFilters'
import { CoursesTable } from './CoursesTable'
import { CoursesCardsGrid, CoursesPhoneList } from './CoursesCards'
import { NewCourseDialog } from './NewCourseDialog'
import { CourseActivitySheet } from './CourseActivitySheet'
import { editingZone } from '@/components/app/lifecycle/zoned-time'
import { COURSE_ICONS, toCourseRow, type CourseRow } from './course-bits'

const VIEW_KEY = 'abluo.courses.view'
const VIEWS = ['list', 'cards'] as const
type View = (typeof VIEWS)[number]

/**
 * The Courses list (ADR-045) — a Content-kind list screen, like People and FAQ
 * Sets: ListToolbar + DataTable (computers, the default) ⇄ ContentCard grid,
 * remembered per person; phones get one row per course. Rendered inside the
 * page's PageShell. Filters run in the browser on the loaded list
 * (courses-filter.ts) and live in the URL; `?new=1` opens "New course".
 *
 * Row menu: Edit · Activity · Archive / Restore (write) · Delete (a draft never
 * published; Owner) / Delete permanently (archived; Owner). The server
 * re-checks every rule: deleting is refused while anything shows the course or
 * it still has classes, and the refusal names why. Without courses.course.write
 * the list is read-only (no "New course", no archive).
 */
export function CoursesBrowser({
  projectSlug,
  courses,
  defaultLocale,
  timeZone = null,
  canWrite,
  canDelete = false,
  initialQuery = '',
}: {
  projectSlug: string
  courses: CourseListItem[]
  defaultLocale: string
  /** The site's IANA time zone (dates on Scheduled badges). */
  timeZone?: string | null
  canWrite: boolean
  canDelete?: boolean
  /** The page's query string at request time. */
  initialQuery?: string
}) {
  const t = useTranslations('clientDashboard.courses.list')
  const te = useTranslations('clientDashboard.courses.errors')
  const tl = useTranslations('app.lifecycle')
  const ui = useLocale()
  const zone = editingZone(timeZone)
  const router = useRouter()
  const appRouter = useAppRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()

  const [view, chooseView] = useViewPreference<View>(VIEW_KEY, VIEWS, 'list')

  // ── Filters (in the URL) ───────────────────────────────────────────────────
  const initialParams = useMemo(() => new URLSearchParams(initialQuery), [initialQuery])
  const [filters, setFilters] = useState<CourseFilters>(() => parseCourseFilters(initialParams))
  const replaceUrl = (f: CourseFilters) => {
    const qs = courseFiltersToParams(f).toString()
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }
  const update = (patch: Partial<CourseFilters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    replaceUrl(next)
  }
  const reset = () => update({ ...DEFAULT_COURSE_FILTERS, sort: filters.sort })

  // ── "New course" (also from the Add-content sheet: ?new=1) ─────────────────
  const [creating, setCreating] = useState(() => canWrite && initialParams.get('new') === '1')
  const askedNew = canWrite && initialParams.get('new') === '1'
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follow the URL's ?new=1
    if (askedNew) setCreating(true)
  }, [askedNew, initialQuery])
  const closeCreate = () => {
    setCreating(false)
    if (initialParams.get('new')) replaceUrl(filters)
  }

  // ── Rows (with changes shown at once, until the refresh lands) ─────────────
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [overlay, setOverlay] = useState<Record<string, Partial<Pick<CourseRow, 'state'>>>>({})
  const rows: CourseRow[] = useMemo(
    () =>
      courses
        .filter((c) => !hidden.has(c.id))
        .map((c) => {
          const row = toCourseRow(c, projectSlug, zone)
          return overlay[c.id] ? { ...row, ...overlay[c.id] } : row
        }),
    [courses, hidden, overlay, projectSlug, zone]
  )
  const shown = useMemo(() => applyCourseFilters(rows, filters), [rows, filters])
  const counts = useMemo(() => courseStateCounts(rows, filters), [rows, filters])

  // ── Actions ────────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<CourseRow | null>(null)
  const [activityOf, setActivityOf] = useState<CourseRow | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const { toast, show, schedule } = useUndo()

  const errorText = (code: string, usedIn?: CourseUsage[]) => {
    if (code === 'in_use' && usedIn?.length) {
      const classes = usedIn.some((u) => u.kind === 'classes')
      return classes ? te('in_use_classes') : te('in_use_where', { places: usedIn.map((u) => u.title).filter(Boolean).join(', ') })
    }
    return te.has(code) ? te(code) : te('failed')
  }

  const open = (c: CourseRow, newTab: boolean) => {
    if (newTab) window.open(getPathname({ href: c.href, locale: ui }), '_blank', 'noopener')
    else appRouter.push(c.href)
  }

  const dropOverlay = (ids: string[]) =>
    setOverlay((o) => {
      const n = { ...o }
      for (const id of ids) delete n[id]
      return n
    })

  /** Archive: shown at once, "Archived · Undo", the server runs after the delay. */
  function archive(c: CourseRow) {
    setOverlay((o) => ({ ...o, [c.id]: { ...o[c.id], state: 'archived' } }))
    schedule({
      id: c.id,
      message: t('done.archived', { name: c.title }),
      undoLabel: t('undo'),
      failMessage: te('failed'),
      restore: () => dropOverlay([c.id]),
      run: async () => {
        const r = await courseLifecycleAction({ projectSlug, id: c.id, op: 'archive' })
        if (r.ok) appRouter.refresh()
        else {
          dropOverlay([c.id])
          show({ message: errorText(r.error, r.detail?.usedIn), tone: 'error' }, 9000)
        }
        return true // the refusal was already said, with its reason
      },
    })
  }

  async function restore(c: CourseRow) {
    if (busy) return
    setBusy(true)
    try {
      const r = await courseLifecycleAction({ projectSlug, id: c.id, op: 'restore' })
      if (!r.ok) return show({ message: errorText(r.error, r.detail?.usedIn), tone: 'error' }, 9000)
      const next = c.isPublished ? (c.hasDraft ? 'changes' : 'published') : 'draft'
      setOverlay((o) => ({ ...o, [c.id]: { ...o[c.id], state: next } }))
      show({ message: t('done.restored', { name: c.title }), tone: 'status' })
      appRouter.refresh()
    } catch {
      show({ message: te('failed'), tone: 'error' }, 7000)
    } finally {
      setBusy(false)
    }
  }

  /** A draft that was never published goes behind "Deleted · Undo" (as Posts). */
  function deleteDraft(c: CourseRow) {
    setHidden((h) => new Set([...h, c.id]))
    schedule({
      id: c.id,
      message: t('done.deleted', { name: c.title }),
      undoLabel: t('undo'),
      failMessage: te('failed'),
      restore: () =>
        setHidden((h) => {
          const n = new Set(h)
          n.delete(c.id)
          return n
        }),
      run: async () => {
        const r = await courseLifecycleAction({ projectSlug, id: c.id, op: 'deleteDraft' })
        if (r.ok) appRouter.refresh()
        else show({ message: errorText(r.error, r.detail?.usedIn), tone: 'error' }, 9000)
        return r.ok
      },
    })
  }

  async function deletePermanently() {
    const c = confirmDelete
    if (!c || busy) return
    setBusy(true)
    setDialogError(null)
    try {
      const r = await courseLifecycleAction({ projectSlug, id: c.id, op: 'deletePermanently' })
      if (!r.ok) return setDialogError(errorText(r.error, r.detail?.usedIn))
      setHidden((h) => new Set([...h, c.id]))
      setConfirmDelete(null)
      show({ message: t('done.deleted', { name: c.title }), tone: 'status' })
      appRouter.refresh()
    } catch {
      setDialogError(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  const menuFor = (c: CourseRow): CardMenuItem[] => {
    const items: CardMenuItem[] = [{ key: 'edit', label: t('actions.edit'), onSelect: () => appRouter.push(c.href) }]
    items.push({ key: 'activity', label: t('actions.activity'), onSelect: () => setActivityOf(c) })
    if (c.state === 'archived') {
      if (canWrite) items.push({ key: 'restore', label: tl('actions.restore'), onSelect: () => void restore(c) })
    } else if (c.isPublished && canWrite && c.state !== 'scheduled') {
      items.push({ key: 'archive', label: tl('actions.archive'), onSelect: () => archive(c) })
    }
    if (canDelete) {
      if (c.state === 'archived') {
        items.push({ key: 'deletePermanently', label: tl('actions.deletePermanently'), onSelect: () => setConfirmDelete(c), destructive: true, separated: true })
      } else if (!c.isPublished) {
        items.push({ key: 'delete', label: tl('actions.delete'), onSelect: () => deleteDraft(c), destructive: true, separated: true })
      }
    }
    return items
  }

  const header = (
    <PageHeader
      title={t('title')}
      actions={
        <>
          {courses.length > 0 ? (
            <ViewSwitch
              label={t('view.label')}
              value={view}
              onChange={chooseView}
              options={[
                { value: 'list', label: t('view.list'), icon: COURSE_ICONS.list },
                { value: 'cards', label: t('view.cards'), icon: COURSE_ICONS.grid },
              ]}
            />
          ) : null}
          <ButtonLink variant="secondary" href={`/${projectSlug}/courses/timetable`}>
            {t('timetable')}
          </ButtonLink>
          {canWrite ? (
            <CreateAction>
              <Button variant="primary" onClick={() => setCreating(true)}>
                {COURSE_ICONS.plus}
                {t('new')}
              </Button>
            </CreateAction>
          ) : null}
        </>
      }
    />
  )

  const dialogs = (
    <>
      {canWrite ? <NewCourseDialog open={creating} onClose={closeCreate} projectSlug={projectSlug} languageName={languageLabel(defaultLocale, ui)} /> : null}
      <CourseActivitySheet open={activityOf !== null} onClose={() => setActivityOf(null)} projectSlug={projectSlug} courseId={activityOf?.id ?? ''} />
      <DeletePermanentlyDialog
        open={confirmDelete !== null}
        titles={confirmDelete ? [confirmDelete.title] : []}
        busy={busy}
        error={dialogError}
        onConfirm={() => void deletePermanently()}
        onCancel={() => {
          setConfirmDelete(null)
          setDialogError(null)
        }}
      />
      <Toast message={toast?.message ?? null} tone={toast?.tone} action={toast?.undo ? t('undo') : undefined} onAction={toast?.undo} />
    </>
  )

  if (courses.length === 0) {
    return (
      <div className="space-y-4">
        {header}
        <EmptyState
          title={t('emptyTitle')}
          body={t('emptyBody')}
          action={
            canWrite ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                {COURSE_ICONS.plus}
                {t('new')}
              </Button>
            ) : undefined
          }
        />
        {dialogs}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {header}

      <CoursesFilters
        filters={filters}
        update={update}
        reset={reset}
        isDefault={isDefaultCourseFilters(filters)}
        counts={counts}
        resultCount={shown.length}
        total={rows.length}
        activeCount={activeCourseFilterCount(filters)}
        showSortOnDesktop={view === 'cards'}
      />

      {shown.length === 0 ? (
        <EmptyState titleAs="p" title={t('filters.noMatch')} action={<Button onClick={reset}>{t('filters.clear')}</Button>} />
      ) : (
        <>
          {/* Computers */}
          <div className="hidden md:block">
            {view === 'list' ? (
              <CoursesTable rows={shown} sort={filters.sort} onSort={(column: CourseSortColumn) => update({ sort: nextCourseSort(column, filters.sort) })} onOpen={open} menuFor={menuFor} />
            ) : (
              <CoursesCardsGrid rows={shown} onOpen={open} menuFor={menuFor} />
            )}
          </div>
          {/* Phones */}
          <div className="md:hidden">
            <CoursesPhoneList rows={shown} menuFor={menuFor} />
          </div>
        </>
      )}

      {dialogs}
    </div>
  )
}

/** The language's name in the dashboard language ("French"), falling back to the code. */
function languageLabel(code: string, ui: string): string {
  try {
    return new Intl.DisplayNames([ui], { type: 'language' }).of(code) ?? code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}
