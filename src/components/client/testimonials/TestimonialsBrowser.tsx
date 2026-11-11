'use client'

import { useNavLabel } from '@/components/client/nav-context'
import { CreateAction } from '@/components/app/ui/CreateAction'
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from 'next/navigation'
import { getPathname, useRouter as useAppRouter } from '@/i18n/navigation'
import type { TestimonialListItem } from '@/lib/api/testimonials'
import { createTestimonialAction, testimonialLifecycleAction } from '@/app/[locale]/(client)/[tenant]/testimonials/actions'
import {
  activeTestimonialFilterCount,
  applyTestimonialFilters,
  DEFAULT_TESTIMONIAL_FILTERS,
  isDefaultTestimonialFilters,
  nextTestimonialSort,
  parseTestimonialFilters,
  testimonialFiltersToParams,
  testimonialStateCounts,
  type TestimonialFilters,
  type TestimonialListState,
  type TestimonialSortColumn,
} from '@/lib/client/testimonials-filter'
import { normalizeListQuery } from '@/lib/client/search-landing'
import { useSearchLanding } from '@/lib/client/use-search-landing'
import { DeletePermanentlyDialog } from '@/components/app/lifecycle/DeletePermanentlyDialog'
import { Button } from '@/components/app/ui/Button'
import type { CardMenuItem } from '@/components/app/ui/CardMenu'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { DisplayTimeZoneContext } from '@/components/app/ui/list/cells'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { useViewPreference } from '@/components/app/ui/use-view-preference'
import { ViewSwitch } from '@/components/app/ui/ViewSwitch'
import { editingZone } from '@/components/app/lifecycle/zoned-time'
import { TestimonialsFilters } from './TestimonialsFilters'
import { TestimonialsTable } from './TestimonialsTable'
import { TestimonialCardsGrid, TestimonialPhoneList } from './TestimonialCards'
import { ICONS, toTestimonialRow, type TestimonialRow } from './testimonial-bits'

const VIEW_KEY = 'abluo.testimonials.view'
const VIEWS = ['list', 'cards'] as const
type View = (typeof VIEWS)[number]

/**
 * The Testimonials list (ADR-048 D9) — a Content-kind list screen, like FAQ
 * Sets and People: ListToolbar + DataTable (computers, the default) ⇄
 * ContentCard grid, remembered per person; phones get one row per testimonial.
 * Rendered inside the page's PageShell (below the tabs, when there are any).
 * Filters run in the browser on the loaded list (testimonials-filter.ts) and
 * live in the URL; `?new=1` creates a draft and opens it.
 *
 * "New Testimonial" makes an empty draft and opens the editor at once — no
 * wizard (everything is optional until Publish). Row menu: Edit · Unpublish /
 * Back online · Archive / Restore · Delete (a draft never published) / Delete
 * permanently (archived; Owner). Archive and Unpublish show "… · Undo"; every
 * delete asks first. The server re-checks every rule. Without
 * testimonials.write the list is read-only (no "New Testimonial", menus only
 * open the editor).
 */
export function TestimonialsBrowser({
  projectSlug,
  testimonials,
  names,
  defaultLocale,
  languages,
  timeZone = null,
  canWrite,
  canDelete = false,
  initialQuery = '',
  belowHeader,
}: {
  projectSlug: string
  testimonials: TestimonialListItem[]
  /** publicId → the real name behind a testimonial (only sent to people who may see it). */
  names?: Record<string, string>
  defaultLocale: string
  /** The site's languages (main first), for "Missing…" markers. */
  languages: string[]
  timeZone?: string | null
  canWrite: boolean
  /** testimonials.delete: may delete archived testimonials permanently (the server re-checks). */
  canDelete?: boolean
  /** The page's query string at request time. */
  initialQuery?: string
  /** The Testimonials | Submissions tabs, shown under the page header. */
  belowHeader?: ReactNode
}) {
  const t = useTranslations('clientDashboard.testimonials.list')
  const sectionTitle = useNavLabel('testimonials', t('title'))
  const te = useTranslations('clientDashboard.testimonials.errors')
  const tl = useTranslations('app.lifecycle')
  const ui = useLocale()
  const router = useRouter()
  const appRouter = useAppRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()

  const [view, chooseView] = useViewPreference<View>(VIEW_KEY, VIEWS, 'list')

  // ── Filters (in the URL) ───────────────────────────────────────────────────
  const initialParams = useMemo(() => new URLSearchParams(initialQuery), [initialQuery])
  const [filters, setFilters] = useState<TestimonialFilters>(() => parseTestimonialFilters(initialParams))
  // A visit from the dashboard search (`?q=`) while this list is open: start from its address (search-landing.ts).
  const noteWritten = useSearchLanding(initialQuery, (qs) => setFilters(parseTestimonialFilters(new URLSearchParams(qs))), {
    normalize: normalizeListQuery,
    accept: (qs) => new URLSearchParams(qs).has('q'),
  })
  const replaceUrl = (f: TestimonialFilters) => {
    const qs = testimonialFiltersToParams(f).toString()
    noteWritten(qs)
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }
  const update = (patch: Partial<TestimonialFilters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    replaceUrl(next)
  }
  const reset = () => update({ ...DEFAULT_TESTIMONIAL_FILTERS, sort: filters.sort })

  // ── Rows (with lifecycle changes shown at once, until the refresh lands) ──
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [overlay, setOverlay] = useState<Record<string, TestimonialListState>>({})
  const labels = useMemo(() => ({ anonymous: t('anonymous'), untitled: t('untitled') }), [t])
  const rows: TestimonialRow[] = useMemo(
    () =>
      testimonials
        .filter((x) => !hidden.has(x.id))
        .map((x) => {
          const row = toTestimonialRow(x, projectSlug, labels, languages, names?.[x.publicId] ?? null)
          return overlay[x.id] ? { ...row, state: overlay[x.id] } : row
        }),
    [testimonials, hidden, overlay, projectSlug, labels, languages, names]
  )
  const shown = useMemo(() => applyTestimonialFilters(rows, filters), [rows, filters])
  const counts = useMemo(() => testimonialStateCounts(rows, filters), [rows, filters])
  const multilingual = languages.length > 1
  void defaultLocale

  // ── Actions ────────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false)
  const [confirmDraftDelete, setConfirmDraftDelete] = useState<TestimonialRow | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<TestimonialRow | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const { toast, show, schedule } = useUndo()

  const errorText = (code: string) => (te.has(code) ? te(code) : te('failed'))

  const open = (r: TestimonialRow, newTab: boolean) => {
    if (newTab) window.open(getPathname({ href: r.href, locale: ui }), '_blank', 'noopener')
    else appRouter.push(r.href)
  }

  /** "New Testimonial": an empty draft, opened at once. */
  const creating = useRef(false)
  async function create() {
    if (creating.current || !canWrite) return
    creating.current = true
    setBusy(true)
    try {
      const r = await createTestimonialAction({ projectSlug })
      if (!r.ok) {
        creating.current = false
        return show({ message: errorText(r.error), tone: 'error' }, 7000)
      }
      appRouter.push(`/${projectSlug}/testimonials/${r.id}`)
    } catch {
      creating.current = false
      show({ message: te('failed'), tone: 'error' }, 7000)
    } finally {
      setBusy(false)
    }
  }
  // Arriving with ?new=1 (the Add-content sheet) creates the draft straight away.
  const askedNew = canWrite && initialParams.get('new') === '1'
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follow the URL's ?new=1 (creates once)
    if (askedNew) void create()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askedNew])

  const dropOverlay = (id: string) =>
    setOverlay((o) => {
      const n = { ...o }
      delete n[id]
      return n
    })

  async function simple(r: TestimonialRow, op: 'restore' | 'backOnline', done: string, next: TestimonialListState) {
    if (busy) return
    setBusy(true)
    try {
      const res = await testimonialLifecycleAction({ projectSlug, id: r.id, op })
      if (!res.ok) {
        const text = res.error === 'permission_required' ? te('permission_required_list', { name: r.name }) : errorText(res.error)
        return show({ message: text, tone: 'error' }, 9000)
      }
      setOverlay((o) => ({ ...o, [r.id]: next }))
      show({ message: done, tone: 'status' })
      appRouter.refresh()
    } catch {
      show({ message: te('failed'), tone: 'error' }, 7000)
    } finally {
      setBusy(false)
    }
  }

  /** "Archived · Undo" / "Unpublished · Undo": the row changes at once, the server call waits. */
  function undoable(r: TestimonialRow, op: 'archive' | 'unpublish', message: string, next: TestimonialListState) {
    setOverlay((o) => ({ ...o, [r.id]: next }))
    let failure = te('failed')
    schedule({
      id: `${op}:${r.id}`,
      message,
      undoLabel: t('undo'),
      get failMessage() {
        return failure
      },
      restore: () => dropOverlay(r.id),
      run: async () => {
        const res = await testimonialLifecycleAction({ projectSlug, id: r.id, op })
        if (!res.ok) failure = errorText(res.error)
        else appRouter.refresh()
        return res.ok
      },
    })
  }

  async function deleteWith(r: TestimonialRow, op: 'deleteDraft' | 'deletePermanently') {
    if (busy) return
    setBusy(true)
    setDeleteError(null)
    try {
      const res = await testimonialLifecycleAction({ projectSlug, id: r.id, op })
      if (!res.ok) return setDeleteError(errorText(res.error))
      setHidden((h) => new Set([...h, r.id]))
      setConfirmDraftDelete(null)
      setConfirmDelete(null)
      show({ message: t('done.deleted', { name: r.name }), tone: 'status' })
      appRouter.refresh()
    } catch {
      setDeleteError(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  const menuFor = (r: TestimonialRow): CardMenuItem[] => {
    const items: CardMenuItem[] = [{ key: 'edit', label: t('actions.edit'), onSelect: () => appRouter.push(r.href) }]
    if (!canWrite) return items
    if (r.state === 'archived') {
      items.push({ key: 'restore', label: tl('actions.restore'), onSelect: () => void simple(r, 'restore', t('done.restored', { name: r.name }), r.isPublished ? 'unpublished' : 'draft') })
      if (canDelete) items.push({ key: 'deletePermanently', label: tl('actions.deletePermanently'), onSelect: () => setConfirmDelete(r), destructive: true, separated: true })
      return items
    }
    if (r.isPublished && r.state === 'unpublished') {
      items.push({ key: 'backOnline', label: t('actions.backOnline'), onSelect: () => void simple(r, 'backOnline', t('done.backOnline', { name: r.name }), 'published') })
    } else if (r.isPublished) {
      items.push({ key: 'unpublish', label: tl('actions.unpublish'), onSelect: () => undoable(r, 'unpublish', t('done.unpublished', { name: r.name }), 'unpublished') })
    }
    items.push({ key: 'archive', label: tl('actions.archive'), onSelect: () => undoable(r, 'archive', t('done.archived', { name: r.name }), 'archived') })
    if (!r.isPublished) items.push({ key: 'delete', label: tl('actions.delete'), onSelect: () => setConfirmDraftDelete(r), destructive: true, separated: true })
    return items
  }

  const header = (
    <PageHeader
      title={sectionTitle}
      actions={
        <>
          {testimonials.length > 0 ? (
            <ViewSwitch
              label={t('view.label')}
              value={view}
              onChange={chooseView}
              options={[
                { value: 'list', label: t('view.list'), icon: ICONS.list },
                { value: 'cards', label: t('view.cards'), icon: ICONS.grid },
              ]}
            />
          ) : null}
          {canWrite ? (
            <CreateAction>
              <Button variant="primary" disabled={busy} onClick={() => void create()}>
                {ICONS.plus}
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
      <ConfirmDialog
        open={confirmDraftDelete !== null}
        title={t('confirmDelete.title', { name: confirmDraftDelete?.name ?? '' })}
        body={t('confirmDelete.body')}
        confirmLabel={tl('actions.delete')}
        busy={busy}
        error={deleteError}
        onConfirm={() => confirmDraftDelete && void deleteWith(confirmDraftDelete, 'deleteDraft')}
        onCancel={() => {
          setConfirmDraftDelete(null)
          setDeleteError(null)
        }}
      />
      <DeletePermanentlyDialog
        open={confirmDelete !== null}
        titles={confirmDelete ? [confirmDelete.name] : []}
        busy={busy}
        error={deleteError}
        onConfirm={() => confirmDelete && void deleteWith(confirmDelete, 'deletePermanently')}
        onCancel={() => {
          setConfirmDelete(null)
          setDeleteError(null)
        }}
      />
      <Toast message={toast?.message ?? null} tone={toast?.tone} action={toast?.undo ? t('undo') : undefined} onAction={toast?.undo} />
    </>
  )

  const zone = editingZone(timeZone)

  if (testimonials.length === 0) {
    return (
      <DisplayTimeZoneContext.Provider value={zone}>
        <div className="space-y-4">
          {header}
          {belowHeader}
          <EmptyState
            title={t('emptyTitle')}
            body={t('emptyBody')}
            action={
              canWrite ? (
                <Button variant="primary" disabled={busy} onClick={() => void create()}>
                  {ICONS.plus}
                  {t('new')}
                </Button>
              ) : undefined
            }
          />
          {dialogs}
        </div>
      </DisplayTimeZoneContext.Provider>
    )
  }

  return (
    <DisplayTimeZoneContext.Provider value={zone}>
      <div className="space-y-4">
        {header}
        {belowHeader}

        <TestimonialsFilters
          filters={filters}
          update={update}
          reset={reset}
          isDefault={isDefaultTestimonialFilters(filters)}
          counts={counts}
          resultCount={shown.length}
          total={rows.length}
          activeCount={activeTestimonialFilterCount(filters)}
          showSortOnDesktop={view === 'cards'}
        />

        {shown.length === 0 ? (
          <EmptyState titleAs="p" title={t('filters.noMatch')} action={<Button onClick={reset}>{t('filters.clear')}</Button>} />
        ) : (
          <>
            {/* Computers */}
            <div className="hidden md:block">
              {view === 'list' ? (
                <TestimonialsTable
                  rows={shown}
                  multilingual={multilingual}
                  sort={filters.sort}
                  onSort={(column: TestimonialSortColumn) => update({ sort: nextTestimonialSort(column, filters.sort) })}
                  onOpen={open}
                  menuFor={menuFor}
                />
              ) : (
                <TestimonialCardsGrid rows={shown} onOpen={open} menuFor={menuFor} />
              )}
            </div>
            {/* Phones */}
            <div className="md:hidden">
              <TestimonialPhoneList rows={shown} menuFor={menuFor} />
            </div>
          </>
        )}

        {dialogs}
      </div>
    </DisplayTimeZoneContext.Provider>
  )
}
