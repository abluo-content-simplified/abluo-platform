'use client'

import { CreateAction } from '@/components/app/ui/CreateAction'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from 'next/navigation'
import { getPathname, useRouter as useAppRouter } from '@/i18n/navigation'
import type { CourseListItem } from '@/lib/api/course-drafts'
import { bulkUpdateCoursesAction, courseLifecycleAction, setClassesLastDateAction } from '@/app/[locale]/(client)/[tenant]/courses/actions'
import type { CourseUsage } from '@/lib/api/course-drafts'
import type { ClassLastDateResult, CourseBulkResult } from '@/lib/api/course-bulk'
import { courseBulkSkip, courseBulkTargets, type CourseBulkOp } from '@/lib/client/courses-bulk'
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
import { BarButton, SheetItem } from '@/components/app/ui/BarButton'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button, ButtonLink } from '@/components/app/ui/Button'
import type { CardMenuItem } from '@/components/app/ui/CardMenu'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { SelectAll } from '@/components/app/ui/list/ContentCard'
import { idRange, SelectionBar } from '@/components/app/ui/SelectionBar'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { useViewPreference } from '@/components/app/ui/use-view-preference'
import { normalizeListQuery } from '@/lib/client/search-landing'
import { useSearchLanding } from '@/lib/client/use-search-landing'
import { ViewSwitch } from '@/components/app/ui/ViewSwitch'
import { CoursesFilters } from './CoursesFilters'
import { CoursesTable } from './CoursesTable'
import { CoursesCardsGrid, CoursesPhoneList } from './CoursesCards'
import { NewCourseDialog } from './NewCourseDialog'
import { CourseActivitySheet } from './CourseActivitySheet'
import { CoursesDeleteDialog } from './CoursesDeleteDialog'
import { CoursesLastDateDialog } from './CoursesLastDateDialog'
import { editingZone } from '@/components/app/lifecycle/zoned-time'
import { ICONS as POST_ICONS } from '@/components/client/posts/post-bits'
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
 * published, or an archived course; Owner). EVERY delete asks first in a dialog
 * that names the courses and says their classes go too. The server re-checks
 * every rule: deleting is refused while anything shows the course, and the
 * refusal names where.
 *
 * Selection (square checkboxes, shift selects a range) opens the SelectionBar:
 * Publish · Archive · Restore · Last date (change the last date of the classes)
 * · Delete. Each applies to the courses it fits, one by one on the server with
 * the same permissions as the row menu, and the toast reports "4 archived, 1
 * skipped: …". Without courses.course.write the list is read-only (no "New
 * course", no archive, no selecting).
 */
export function CoursesBrowser({
  projectSlug,
  courses,
  defaultLocale,
  timeZone = null,
  canWrite,
  canDelete = false,
  canScheduleWrite = false,
  initialQuery = '',
}: {
  projectSlug: string
  courses: CourseListItem[]
  defaultLocale: string
  /** The site's IANA time zone (dates on Scheduled badges). */
  timeZone?: string | null
  canWrite: boolean
  canDelete?: boolean
  /** courses.schedule.write: may change the classes' last date. */
  canScheduleWrite?: boolean
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
  // A visit from the dashboard search (`?q=`) while this list is open: start from its address (search-landing.ts).
  const noteWritten = useSearchLanding(initialQuery, (qs) => setFilters(parseCourseFilters(new URLSearchParams(qs))), {
    normalize: normalizeListQuery,
    accept: (qs) => new URLSearchParams(qs).has('q'),
  })
  const replaceUrl = (f: CourseFilters) => {
    const qs = courseFiltersToParams(f).toString()
    noteWritten(qs)
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
  const [deleteTargets, setDeleteTargets] = useState<CourseRow[]>([])
  const [deleteSkipped, setDeleteSkipped] = useState(0)
  const [lastDateOpen, setLastDateOpen] = useState(false)
  const [moreSheet, setMoreSheet] = useState(false)
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

  /** Every delete asks first: the dialog names what goes (and that the classes go too). */
  function askDelete(c: CourseRow) {
    setDialogError(null)
    setDeleteSkipped(0)
    setDeleteTargets([c])
  }

  function closeDelete() {
    setDeleteTargets([])
    setDialogError(null)
  }

  async function confirmDelete() {
    const targets = deleteTargets
    if (!targets.length || busy) return
    setBusy(true)
    setDialogError(null)
    try {
      const r = await bulkUpdateCoursesAction({ projectSlug, ids: targets.map((c) => c.id), op: 'delete' })
      if (!r.ok) return setDialogError(errorText(r.error))
      if (r.changed.length) {
        setHidden((h) => new Set([...h, ...r.changed]))
        setSelected((cur) => new Set([...cur].filter((id) => !r.changed.includes(id))))
      }
      if (r.failed.length && !r.changed.length) return setDialogError(errorText(r.failed[0].code, r.failed[0].usedIn))
      closeDelete()
      reportBulk('delete', r, rows)
      appRouter.refresh()
    } catch {
      setDialogError(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  // ── Selection (square checkboxes; shift selects a range) and bulk changes ───
  const canSelect = canWrite || canDelete
  const tb = useTranslations('clientDashboard.courses.list.bulk')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lastPicked, setLastPicked] = useState<string | null>(null)
  const selectedRows = shown.filter((r) => selected.has(r.id))
  const allState: 'none' | 'some' | 'all' = selectedRows.length === 0 ? 'none' : selectedRows.length === shown.length ? 'all' : 'some'
  const toggle = (id: string, checked: boolean, shift: boolean) => {
    const order = shown.map((r) => r.id)
    setSelected((cur) => {
      const n = new Set(cur)
      const ids = shift && lastPicked && lastPicked !== id ? idRange(order, lastPicked, id) : [id]
      for (const x of ids) {
        if (checked) n.add(x)
        else n.delete(x)
      }
      return n
    })
    setLastPicked(id)
  }
  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(shown.map((r) => r.id)) : new Set())
    setLastPicked(null)
  }
  const clearSelection = () => {
    setSelected(new Set())
    setLastPicked(null)
  }
  const selection = canSelect
    ? { selected, onToggle: toggle, allState, onToggleAll: toggleAll, rowLabel: (r: CourseRow) => tb('checkbox', { name: r.title || t('untitled') }), allLabel: tb('allLabel') }
    : undefined

  /** "Yoga (published), Pilates (…) +2" — who is left as they were, and why. */
  const details = (items: Array<{ name: string; reason: string }>) =>
    items
      .slice(0, 3)
      .map((x) => tb('detail', { name: x.name, reason: x.reason }))
      .join('; ') + (items.length > 3 ? ` +${items.length - 3}` : '')
  const nameOf = (id: string, from: readonly CourseRow[]) => from.find((x) => x.id === id)?.title || t('untitled')

  /** One toast for the whole result: "4 archived, 1 skipped: Yoga (not published)". */
  function reportBulk(op: CourseBulkOp, r: CourseBulkResult, from: readonly CourseRow[]) {
    const parts: string[] = []
    if (r.changed.length) parts.push(tb(`done.${op}`, { count: r.changed.length }))
    if (op === 'delete' && r.classesEnded) parts.push(tb('done.deleteClasses', { count: r.classesEnded }))
    if (r.skipped.length) parts.push(tb('skipped', { count: r.skipped.length, details: details(r.skipped.map((x) => ({ name: nameOf(x.id, from), reason: tb(`reason.${x.reason}`) }))) }))
    if (r.failed.length) parts.push(tb('attention', { count: r.failed.length, details: details(r.failed.map((x) => ({ name: nameOf(x.id, from), reason: errorText(x.code, x.usedIn) }))) }))
    if (r.classesLeft) parts.push(tb('classesLeft', { count: r.classesLeft }))
    show({ message: parts.join(' '), tone: r.failed.length || r.classesLeft ? 'error' : 'status' }, r.failed.length || r.skipped.length ? 10000 : 6000)
  }

  /** The courses an action can't touch, with why (when it can touch none). */
  function nothingToChange(op: CourseBulkOp) {
    const why = selectedRows.map((r) => ({ name: r.title || t('untitled'), reason: tb(`reason.${courseBulkSkip(r, op)}`) }))
    show({ message: tb('nothing', { details: details(why) }), tone: 'status' }, 9000)
  }

  async function applyBulk(op: 'publish' | 'archive' | 'restore', targets: CourseRow[]) {
    if (busy) return
    setBusy(true)
    const from = selectedRows
    try {
      const r = await bulkUpdateCoursesAction({ projectSlug, ids: targets.map((c) => c.id), op })
      if (!r.ok) return show({ message: errorText(r.error), tone: 'error' }, 9000)
      setOverlay((o) => {
        const n = { ...o }
        for (const c of targets) {
          if (!r.changed.includes(c.id)) continue
          const state = op === 'archive' ? 'archived' : op === 'publish' ? 'published' : c.isPublished ? (c.hasDraft ? 'changes' : 'published') : 'draft'
          n[c.id] = { ...n[c.id], state }
        }
        return n
      })
      // Whoever was skipped up front (not eligible) is reported too.
      const upFront = from.filter((c) => !targets.includes(c)).map((c) => ({ id: c.id, reason: courseBulkSkip(c, op)! }))
      reportBulk(op, { ...r, skipped: [...r.skipped, ...upFront] }, from)
      clearSelection()
      appRouter.refresh()
    } catch {
      show({ message: te('failed'), tone: 'error' }, 7000)
    } finally {
      setBusy(false)
    }
  }

  function runBulk(op: 'publish' | 'archive' | 'restore') {
    setMoreSheet(false)
    const { targets } = courseBulkTargets(selectedRows, op)
    if (!targets.length) return nothingToChange(op)
    void applyBulk(op, targets)
  }

  /** Delete always asks first, naming the courses. */
  function runBulkDelete() {
    setMoreSheet(false)
    const { targets, skipped } = courseBulkTargets(selectedRows, 'delete')
    if (!targets.length) return nothingToChange('delete')
    setDialogError(null)
    setDeleteSkipped(skipped)
    setDeleteTargets(targets)
  }

  async function changeLastDate(endsOn: string) {
    if (busy) return
    setBusy(true)
    setDialogError(null)
    const from = selectedRows
    try {
      const r = await setClassesLastDateAction({ projectSlug, ids: from.map((c) => c.id), endsOn })
      if (!r.ok) return setDialogError(errorText(r.error))
      setLastDateOpen(false)
      reportLastDate(r, from)
      clearSelection()
      appRouter.refresh()
    } catch {
      setDialogError(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  function reportLastDate(r: ClassLastDateResult, from: readonly CourseRow[]) {
    const parts: string[] = []
    if (r.changed.length) parts.push(tb('lastDate.done', { count: r.changed.length }))
    const reasons = new Map<string, number>()
    for (const x of r.skipped) reasons.set(x.reason, (reasons.get(x.reason) ?? 0) + 1)
    if (reasons.size) parts.push([...reasons].map(([reason, count]) => tb(`lastDate.reason.${reason}`, { count })).join(', ') + '.')
    if (r.failed.length) {
      const why = r.failed.map((x) => ({ name: from.find((c) => c.publicId.toLowerCase() === x.courseId.toLowerCase())?.title || t('untitled'), reason: errorText(x.code) }))
      parts.push(tb('attention', { count: r.failed.length, details: details(why) }))
    }
    if (!parts.length) parts.push(tb('lastDate.nothing'))
    show({ message: parts.join(' '), tone: r.failed.length ? 'error' : 'status' }, 10000)
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
        items.push({ key: 'deletePermanently', label: tl('actions.deletePermanently'), onSelect: () => askDelete(c), destructive: true, separated: true })
      } else if (!c.isPublished) {
        items.push({ key: 'delete', label: tl('actions.delete'), onSelect: () => askDelete(c), destructive: true, separated: true })
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
      <CoursesDeleteDialog courses={deleteTargets} skipped={deleteSkipped} busy={busy} error={dialogError} onConfirm={() => void confirmDelete()} onCancel={closeDelete} />
      <CoursesLastDateDialog
        open={lastDateOpen}
        count={selectedRows.length}
        busy={busy}
        error={dialogError}
        onClose={() => {
          setLastDateOpen(false)
          setDialogError(null)
        }}
        onConfirm={(day) => void changeLastDate(day)}
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
              <CoursesTable rows={shown} sort={filters.sort} onSort={(column: CourseSortColumn) => update({ sort: nextCourseSort(column, filters.sort) })} onOpen={open} menuFor={menuFor} selection={selection} />
            ) : (
              <>
                {selection ? (
                  <div className="mb-3">
                    <SelectAll label={tb('all')} ariaLabel={tb('allLabel')} state={allState} onChange={toggleAll} />
                  </div>
                ) : null}
                <CoursesCardsGrid rows={shown} selection={selection} onOpen={open} menuFor={menuFor} />
              </>
            )}
          </div>
          {/* Phones */}
          <div className="md:hidden">
            <CoursesPhoneList rows={shown} selection={selection} menuFor={menuFor} />
          </div>
        </>
      )}

      {canSelect && selectedRows.length > 0 ? (
        <SelectionBar label={tb('toolbar')} count={tb('count', { count: selectedRows.length })}>
          {canWrite ? (
            <BarButton onPress={() => runBulk('publish')} icon={COURSE_ICONS.publish}>
              {tb('bar.publish')}
            </BarButton>
          ) : null}
          {canWrite ? (
            <BarButton onPress={() => runBulk('archive')} icon={POST_ICONS.archiveAction}>
              {tb('bar.archive')}
            </BarButton>
          ) : null}
          {canWrite ? (
            <BarButton className="hidden md:flex" onPress={() => runBulk('restore')} icon={COURSE_ICONS.restore}>
              {tb('bar.restore')}
            </BarButton>
          ) : null}
          {canWrite && canScheduleWrite ? (
            <BarButton className="hidden md:flex" onPress={() => setLastDateOpen(true)} icon={COURSE_ICONS.dates}>
              {tb('bar.lastDate')}
            </BarButton>
          ) : null}
          {canDelete ? (
            <BarButton className="hidden md:flex" destructive onPress={runBulkDelete} icon={COURSE_ICONS.trash}>
              {tb('bar.delete')}
            </BarButton>
          ) : null}
          <BarButton className="md:hidden" onPress={() => setMoreSheet(true)} icon={COURSE_ICONS.more}>
            {tb('bar.more')}
          </BarButton>
          <BarButton onPress={clearSelection} icon={POST_ICONS.x}>
            {tb('bar.clear')}
          </BarButton>
        </SelectionBar>
      ) : null}

      <BottomSheet open={moreSheet} title={tb('moreTitle', { count: selectedRows.length })} onClose={() => setMoreSheet(false)}>
        <div className="mt-2 flex flex-col">
          {canWrite ? <SheetItem onPress={() => runBulk('restore')}>{tb('bar.restore')}</SheetItem> : null}
          {canWrite && canScheduleWrite ? (
            <SheetItem
              onPress={() => {
                setMoreSheet(false)
                setLastDateOpen(true)
              }}
            >
              {tb('bar.lastDateLong')}
            </SheetItem>
          ) : null}
          {canDelete ? (
            <SheetItem destructive onPress={runBulkDelete}>
              {tb('bar.delete')}
            </SheetItem>
          ) : null}
        </div>
      </BottomSheet>

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
