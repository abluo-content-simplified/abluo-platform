'use client'

import { CreateAction } from '@/components/app/ui/CreateAction'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from 'next/navigation'
import { getPathname, useRouter as useAppRouter } from '@/i18n/navigation'
import type { PersonListItem, PersonState, PersonUsage } from '@/lib/api/persons'
import { personLifecycleAction, reorderPersonsAction } from '@/app/[locale]/(client)/[tenant]/people/actions'
import {
  activePersonFilterCount,
  applyPersonFilters,
  canReorderPersons,
  DEFAULT_PERSON_FILTERS,
  isDefaultPersonFilters,
  nextPersonSort,
  parsePersonFilters,
  personFiltersToParams,
  personStateCounts,
  type PersonFilters,
  type PersonSortColumn,
} from '@/lib/client/persons-filter'
import { DeletePermanentlyDialog } from '@/components/app/lifecycle/DeletePermanentlyDialog'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import type { CardMenuItem } from '@/components/app/ui/CardMenu'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Toast } from '@/components/app/ui/Toast'
import { dropIndex, usePointerDrag } from '@/components/app/ui/use-pointer-drag'
import { useUndo } from '@/components/app/ui/use-undo'
import { useViewPreference } from '@/components/app/ui/use-view-preference'
import { ViewSwitch } from '@/components/app/ui/ViewSwitch'
import { pickerLabel, type PickerTerm } from '@/components/client/taxonomy/term-picker-model'
import { PeopleFilters } from './PeopleFilters'
import { PeopleTable, type PersonReorder } from './PeopleTable'
import { PeopleCardsGrid, PeoplePhoneList } from './PeopleCards'
import { NewPersonDialog } from './NewPersonDialog'
import { PersonAnonymiseDialog } from './PersonAnonymiseDialog'
import { PERSON_ICONS, toPersonRow, useGroupLabel, useUsageSummary, type PersonRow } from './person-bits'
import { PersonUsedInLoader } from './PersonUsedInLoader'
import { anonymiseFromList } from './person-actions'

const VIEW_KEY = 'abluo.people.view'
const VIEWS = ['list', 'cards'] as const
type View = (typeof VIEWS)[number]

/**
 * The People list (ADR-043 D8) — a Content-kind list screen, like Galleries
 * and FAQ Sets: ListToolbar + DataTable (computers, the default) ⇄ ContentCard
 * grid, remembered per person; phones get one row per person. Rendered inside
 * the page's PageShell. Filters run in the browser on the loaded list
 * (persons-filter.ts) and live in the URL; `?new=1` opens "New person".
 *
 * Order (D6): one site-wide order. With the whole list in view (no search or
 * filter, sorted by "Order") a grip on every row drags a person to a new place
 * (the shared DragGrip: pointer drag or ArrowUp / ArrowDown); the order is
 * saved at once for the whole list.
 *
 * Row menu: Edit · Where it's used · Archive / Restore (Owner) · Delete (a
 * draft never published; Owner) / Delete permanently (archived; Owner) ·
 * Anonymise (Owner). The server re-checks every rule: deleting is refused
 * while any content shows the person, and the refusal names where. Without
 * people.person.write the list is read-only (no "New person", no dragging).
 */
export function PeopleBrowser({
  projectSlug,
  persons,
  defaultLocale,
  groupTerms,
  canWrite,
  canArchive = false,
  canDelete = false,
  canAnonymise = false,
  initialQuery = '',
}: {
  projectSlug: string
  persons: PersonListItem[]
  defaultLocale: string
  /** The People groups (Categories & Tags), in the vocabulary's order. */
  groupTerms: PickerTerm[]
  canWrite: boolean
  canArchive?: boolean
  canDelete?: boolean
  canAnonymise?: boolean
  /** The page's query string at request time. */
  initialQuery?: string
}) {
  const t = useTranslations('clientDashboard.persons.list')
  const te = useTranslations('clientDashboard.persons.errors')
  const tl = useTranslations('app.lifecycle')
  const ta = useTranslations('clientDashboard.persons.anonymise')
  const ui = useLocale()
  const router = useRouter()
  const appRouter = useAppRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()
  const summarize = useUsageSummary()
  const groupLabel = useGroupLabel(groupTerms, defaultLocale)

  const [view, chooseView] = useViewPreference<View>(VIEW_KEY, VIEWS, 'list')

  // ── Filters (in the URL) ───────────────────────────────────────────────────
  const initialParams = useMemo(() => new URLSearchParams(initialQuery), [initialQuery])
  const [filters, setFilters] = useState<PersonFilters>(() => parsePersonFilters(initialParams))
  const replaceUrl = (f: PersonFilters) => {
    const qs = personFiltersToParams(f).toString()
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }
  const update = (patch: Partial<PersonFilters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    replaceUrl(next)
  }
  const reset = () => update({ ...DEFAULT_PERSON_FILTERS, sort: filters.sort })

  // ── "New person" (also from the Add-content sheet: ?new=1) ─────────────────
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
  const [overlay, setOverlay] = useState<Record<string, PersonState>>({})
  /** The site order as just dragged, until the refresh brings the saved one. */
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null)
  const anonymisedName = t('anonymisedName')
  const rows: PersonRow[] = useMemo(() => {
    const base = persons
      .filter((p) => !hidden.has(p.id))
      .map((p) => {
        const row = toPersonRow(p, projectSlug, anonymisedName)
        return overlay[p.id] ? { ...row, state: overlay[p.id] } : row
      })
    if (!orderOverride) return base
    const at = new Map(orderOverride.map((id, n) => [id, n]))
    return [...base].sort((a, b) => (at.get(a.id) ?? 1e9) - (at.get(b.id) ?? 1e9))
  }, [persons, hidden, overlay, projectSlug, anonymisedName, orderOverride])
  const shown = useMemo(() => applyPersonFilters(rows, filters), [rows, filters])
  const counts = useMemo(() => personStateCounts(rows, filters), [rows, filters])
  const groupOptions = useMemo(() => groupTerms.map((g) => ({ value: g.value, label: pickerLabel(g, ui, defaultLocale) })), [groupTerms, ui, defaultLocale])

  // ── Actions ────────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false)
  const [usedInOf, setUsedInOf] = useState<PersonRow | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<PersonRow | null>(null)
  const [confirmAnonymise, setConfirmAnonymise] = useState<PersonRow | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const { toast, show, schedule } = useUndo()

  const errorText = (code: string, usedIn?: PersonUsage[]) =>
    code === 'in_use' && usedIn?.length ? te('in_use_where', { places: summarize(usedIn) }) : te.has(code) ? te(code) : te('failed')

  const open = (p: PersonRow, newTab: boolean) => {
    if (newTab) window.open(getPathname({ href: p.href, locale: ui }), '_blank', 'noopener')
    else appRouter.push(p.href)
  }

  async function lifecycle(p: PersonRow, op: 'archive' | 'restore') {
    if (busy) return
    setBusy(true)
    try {
      const r = await personLifecycleAction({ projectSlug, id: p.id, op })
      if (!r.ok) return show({ message: errorText(r.error, r.detail?.usedIn), tone: 'error' }, 9000)
      const next: PersonState = op === 'archive' ? 'archived' : p.isPublished ? (p.hasDraft ? 'changes' : 'published') : 'draft'
      setOverlay((o) => ({ ...o, [p.id]: next }))
      show({ message: op === 'archive' ? t('done.archived', { name: p.name }) : t('done.restored', { name: p.name }), tone: 'status' })
      appRouter.refresh()
    } catch {
      show({ message: te('failed'), tone: 'error' }, 7000)
    } finally {
      setBusy(false)
    }
  }

  /** A draft that was never published goes behind "Deleted · Undo" (as Posts). */
  function deleteDraft(p: PersonRow) {
    setHidden((h) => new Set([...h, p.id]))
    schedule({
      id: p.id,
      message: t('done.deleted', { name: p.name }),
      undoLabel: t('undo'),
      failMessage: te('failed'),
      restore: () =>
        setHidden((h) => {
          const n = new Set(h)
          n.delete(p.id)
          return n
        }),
      run: async () => {
        const r = await personLifecycleAction({ projectSlug, id: p.id, op: 'deleteDraft' })
        if (r.ok) appRouter.refresh()
        else show({ message: errorText(r.error, r.detail?.usedIn), tone: 'error' }, 9000)
        return r.ok
      },
    })
  }

  async function deletePermanently() {
    const p = confirmDelete
    if (!p || busy) return
    setBusy(true)
    setDialogError(null)
    try {
      const r = await personLifecycleAction({ projectSlug, id: p.id, op: 'deletePermanently' })
      if (!r.ok) return setDialogError(errorText(r.error, r.detail?.usedIn))
      setHidden((h) => new Set([...h, p.id]))
      setConfirmDelete(null)
      show({ message: t('done.deleted', { name: p.name }), tone: 'status' })
      appRouter.refresh()
    } catch {
      setDialogError(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  async function anonymise() {
    const p = confirmAnonymise
    if (!p || busy) return
    setBusy(true)
    setDialogError(null)
    try {
      const error = await anonymiseFromList(projectSlug, p.id)
      if (error) return setDialogError(errorText(error))
      setConfirmAnonymise(null)
      show({ message: ta('done', { name: p.name }), tone: 'status' })
      appRouter.refresh()
    } catch {
      setDialogError(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  // ── Order (drag) ───────────────────────────────────────────────────────────
  const [reordering, setReordering] = useState(false)
  const rowsRef = useRef(rows)
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])
  async function saveOrder(ids: string[]) {
    const previous = rowsRef.current.map((r) => r.id)
    setOrderOverride(ids)
    setReordering(true)
    try {
      const r = await reorderPersonsAction({ projectSlug, ids })
      if (!r.ok) {
        setOrderOverride(previous)
        return show({ message: errorText(r.error), tone: 'error' }, 7000)
      }
      show({ message: t('done.ordered'), tone: 'status' })
      appRouter.refresh()
    } catch {
      setOrderOverride(previous)
      show({ message: te('failed'), tone: 'error' }, 7000)
    } finally {
      setReordering(false)
    }
  }
  const drag = usePointerDrag((key, over) => {
    const ids = rowsRef.current.map((r) => r.id)
    const to = dropIndex(ids, key, over)
    if (to === null) return
    const next = ids.filter((x) => x !== key)
    next.splice(to, 0, key)
    void saveOrder(next)
  })
  const reorder: PersonReorder | undefined =
    canWrite && canReorderPersons(filters) && shown.length > 1
      ? {
          drag,
          disabled: reordering,
          move: (id, direction) => {
            const ids = rowsRef.current.map((r) => r.id)
            const from = ids.indexOf(id)
            const to = from + direction
            if (from < 0 || to < 0 || to >= ids.length) return
            const next = ids.slice()
            next.splice(to, 0, ...next.splice(from, 1))
            void saveOrder(next)
          },
        }
      : undefined

  const menuFor = (p: PersonRow): CardMenuItem[] => {
    const items: CardMenuItem[] = [{ key: 'edit', label: t('actions.edit'), onSelect: () => appRouter.push(p.href) }]
    if (p.usageCount) items.push({ key: 'usedIn', label: t('actions.usedIn'), onSelect: () => setUsedInOf(p) })
    if (p.state === 'archived') {
      if (canArchive) items.push({ key: 'restore', label: tl('actions.restore'), onSelect: () => void lifecycle(p, 'restore') })
    } else if (p.isPublished && canArchive) {
      items.push({ key: 'archive', label: tl('actions.archive'), onSelect: () => void lifecycle(p, 'archive') })
    }
    if (canAnonymise && !p.anonymised) items.push({ key: 'anonymise', label: t('actions.anonymise'), onSelect: () => setConfirmAnonymise(p), separated: true })
    if (canDelete) {
      if (p.state === 'archived') {
        items.push({ key: 'deletePermanently', label: tl('actions.deletePermanently'), onSelect: () => setConfirmDelete(p), destructive: true, separated: !canAnonymise })
      } else if (!p.isPublished) {
        items.push({ key: 'delete', label: tl('actions.delete'), onSelect: () => deleteDraft(p), destructive: true, separated: !canAnonymise })
      }
    }
    return items
  }

  const header = (
    <PageHeader
      title={t('title')}
      actions={
        <>
          {persons.length > 0 ? (
            <ViewSwitch
              label={t('view.label')}
              value={view}
              onChange={chooseView}
              options={[
                { value: 'list', label: t('view.list'), icon: PERSON_ICONS.list },
                { value: 'cards', label: t('view.cards'), icon: PERSON_ICONS.grid },
              ]}
            />
          ) : null}
          {canWrite ? (
            <CreateAction>
              <Button variant="primary" onClick={() => setCreating(true)}>
                {PERSON_ICONS.plus}
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
      {canWrite ? <NewPersonDialog open={creating} onClose={closeCreate} projectSlug={projectSlug} /> : null}
      <BottomSheet open={usedInOf !== null} title={t('usedInTitle', { name: usedInOf?.name ?? '' })} onClose={() => setUsedInOf(null)}>
        {usedInOf ? <PersonUsedInLoader projectSlug={projectSlug} personId={usedInOf.id} /> : null}
      </BottomSheet>
      <DeletePermanentlyDialog
        open={confirmDelete !== null}
        titles={confirmDelete ? [confirmDelete.name] : []}
        busy={busy}
        error={dialogError}
        onConfirm={() => void deletePermanently()}
        onCancel={() => {
          setConfirmDelete(null)
          setDialogError(null)
        }}
      />
      <PersonAnonymiseDialog
        open={confirmAnonymise !== null}
        name={confirmAnonymise?.name ?? ''}
        busy={busy}
        error={dialogError}
        onConfirm={() => void anonymise()}
        onCancel={() => {
          setConfirmAnonymise(null)
          setDialogError(null)
        }}
      />
      <Toast message={toast?.message ?? null} tone={toast?.tone} action={toast?.undo ? t('undo') : undefined} onAction={toast?.undo} />
    </>
  )

  if (persons.length === 0) {
    return (
      <div className="space-y-4">
        {header}
        <EmptyState
          title={t('emptyTitle')}
          body={t('emptyBody')}
          action={
            canWrite ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                {PERSON_ICONS.plus}
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

      <PeopleFilters
        filters={filters}
        update={update}
        reset={reset}
        isDefault={isDefaultPersonFilters(filters)}
        counts={counts}
        groups={groupOptions}
        resultCount={shown.length}
        total={rows.length}
        activeCount={activePersonFilterCount(filters)}
        showSortOnDesktop={view === 'cards'}
      />

      {shown.length === 0 ? (
        <EmptyState titleAs="p" title={t('filters.noMatch')} action={<Button onClick={reset}>{t('filters.clear')}</Button>} />
      ) : (
        <>
          {/* Computers */}
          <div className="hidden md:block">
            {view === 'list' ? (
              <PeopleTable
                rows={shown}
                canWrite={canWrite}
                sort={filters.sort}
                onSort={(column: PersonSortColumn) => update({ sort: nextPersonSort(column, filters.sort) })}
                onOpen={open}
                onUsedIn={setUsedInOf}
                menuFor={menuFor}
                groupLabel={groupLabel}
                reorder={reorder}
              />
            ) : (
              <PeopleCardsGrid rows={shown} canWrite={canWrite} onOpen={open} onUsedIn={setUsedInOf} menuFor={menuFor} groupLabel={groupLabel} />
            )}
          </div>
          {/* Phones */}
          <div className="md:hidden">
            <PeoplePhoneList rows={shown} canWrite={canWrite} menuFor={menuFor} groupLabel={groupLabel} reorder={reorder} />
          </div>
        </>
      )}

      {dialogs}
    </div>
  )
}
