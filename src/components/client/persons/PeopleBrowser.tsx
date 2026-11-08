'use client'

import { CreateAction } from '@/components/app/ui/CreateAction'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from 'next/navigation'
import { getPathname, useRouter as useAppRouter } from '@/i18n/navigation'
import type { PersonListItem, PersonState, PersonUsage } from '@/lib/api/persons'
import { bulkUpdatePersonsAction, personLifecycleAction, reorderPersonsAction } from '@/app/[locale]/(client)/[tenant]/people/actions'
import { mintPersonPreviewAction } from '@/app/[locale]/(client)/[tenant]/people/preview-action'
import { personPreviewUrl } from '@/lib/client/preview-url'
import {
  activePersonFilterCount,
  applyPersonFilters,
  bulkTargets,
  canReorderPersons,
  DEFAULT_PERSON_FILTERS,
  isDefaultPersonFilters,
  nextPersonSort,
  parsePersonFilters,
  personFiltersToParams,
  personStateCounts,
  type PersonBulkAction,
  type PersonFilters,
  type PersonSortColumn,
} from '@/lib/client/persons-filter'
import { DeletePermanentlyDialog } from '@/components/app/lifecycle/DeletePermanentlyDialog'
import { BarButton, SheetItem } from '@/components/app/ui/BarButton'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import type { CardMenuItem } from '@/components/app/ui/CardMenu'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { SelectAll } from '@/components/app/ui/list/ContentCard'
import { idRange, SelectionBar } from '@/components/app/ui/SelectionBar'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { ICONS as POST_ICONS } from '@/components/client/posts/post-bits'
import { Toast } from '@/components/app/ui/Toast'
import { dropIndex, usePointerDrag } from '@/components/app/ui/use-pointer-drag'
import { useUndo } from '@/components/app/ui/use-undo'
import { useViewPreference } from '@/components/app/ui/use-view-preference'
import { normalizeListQuery } from '@/lib/client/search-landing'
import { useSearchLanding } from '@/lib/client/use-search-landing'
import { ViewSwitch } from '@/components/app/ui/ViewSwitch'
import { pickerLabel, type PickerTerm } from '@/components/client/taxonomy/term-picker-model'
import { PeopleFilters } from './PeopleFilters'
import { PeopleTable, type PersonReorder } from './PeopleTable'
import { PeopleCardsGrid, PeoplePhoneList } from './PeopleCards'
import { NewPersonDialog } from './NewPersonDialog'
import { PersonActivitySheet } from './PersonActivitySheet'
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
 * Row menu: Edit · Preview · Where it's used · Activity · Archive / Restore
 * (Owner) · Delete (a draft never published; Owner) / Delete permanently
 * (archived; Owner) · Anonymise (Owner). The server re-checks every rule:
 * deleting is refused while any content shows the person, and the refusal
 * names where. Without people.person.write the list is read-only (no "New
 * person", no dragging, no selecting).
 *
 * Selection (square checkboxes, shift selects a range) opens the SelectionBar:
 * Groups (add / remove) · Show · Hide (write) · Archive (Owner). The change
 * shows at once and the server call (bulkUpdatePersons) runs after the Undo
 * delay; archiving one person from the menu works the same way ("Archived ·
 * Undo"). Anonymise and permanent delete never have Undo.
 */
export function PeopleBrowser({
  projectSlug,
  persons,
  defaultLocale,
  groupTerms,
  languages,
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
  /** The site's languages (main first), for "Missing… texts in …". */
  languages?: string[]
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
  const tb = useTranslations('clientDashboard.persons.list.bulk')
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
  // A visit from the dashboard search (`?q=`) while this list is open: start from its address (search-landing.ts).
  const noteWritten = useSearchLanding(initialQuery, (qs) => setFilters(parsePersonFilters(new URLSearchParams(qs))), {
    normalize: normalizeListQuery,
    accept: (qs) => new URLSearchParams(qs).has('q'),
  })
  const replaceUrl = (f: PersonFilters) => {
    const qs = personFiltersToParams(f).toString()
    noteWritten(qs)
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
  const [overlay, setOverlay] = useState<Record<string, Partial<Pick<PersonRow, 'state' | 'visibility' | 'groups'>>>>({})
  /** The site order as just dragged, until the refresh brings the saved one. */
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null)
  const anonymisedName = t('anonymisedName')
  const rows: PersonRow[] = useMemo(() => {
    const base = persons
      .filter((p) => !hidden.has(p.id))
      .map((p) => {
        const row = toPersonRow(p, projectSlug, anonymisedName)
        return overlay[p.id] ? { ...row, ...overlay[p.id] } : row
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
  const [activityOf, setActivityOf] = useState<PersonRow | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const { toast, show, schedule } = useUndo()

  const errorText = (code: string, usedIn?: PersonUsage[]) =>
    code === 'in_use' && usedIn?.length ? te('in_use_where', { places: summarize(usedIn) }) : te.has(code) ? te(code) : te('failed')

  const open = (p: PersonRow, newTab: boolean) => {
    if (newTab) window.open(getPathname({ href: p.href, locale: ui }), '_blank', 'noopener')
    else appRouter.push(p.href)
  }

  const dropOverlay = (ids: string[]) =>
    setOverlay((o) => {
      const n = { ...o }
      for (const id of ids) delete n[id]
      return n
    })

  /** Archive: shown at once, "Archived · Undo", the server runs after the delay. */
  function archive(p: PersonRow) {
    setOverlay((o) => ({ ...o, [p.id]: { ...o[p.id], state: 'archived' } }))
    schedule({
      id: p.id,
      message: t('done.archived', { name: p.name }),
      undoLabel: t('undo'),
      failMessage: te('failed'),
      restore: () => dropOverlay([p.id]),
      run: async () => {
        const r = await personLifecycleAction({ projectSlug, id: p.id, op: 'archive' })
        if (r.ok) appRouter.refresh()
        else {
          dropOverlay([p.id])
          show({ message: errorText(r.error, r.detail?.usedIn), tone: 'error' }, 9000)
        }
        return true // the refusal was already said, with its reason
      },
    })
  }

  async function restore(p: PersonRow) {
    if (busy) return
    setBusy(true)
    try {
      const r = await personLifecycleAction({ projectSlug, id: p.id, op: 'restore' })
      if (!r.ok) return show({ message: errorText(r.error, r.detail?.usedIn), tone: 'error' }, 9000)
      const next: PersonState = p.isPublished ? (p.hasDraft ? 'changes' : 'published') : 'draft'
      setOverlay((o) => ({ ...o, [p.id]: { ...o[p.id], state: next } }))
      show({ message: t('done.restored', { name: p.name }), tone: 'status' })
      appRouter.refresh()
    } catch {
      show({ message: te('failed'), tone: 'error' }, 7000)
    } finally {
      setBusy(false)
    }
  }

  /** The private, 15-minute preview of the profile page (as the editor does). */
  async function preview(p: PersonRow) {
    const tab = window.open('about:blank', '_blank')
    if (tab) tab.opener = null
    try {
      const r = await mintPersonPreviewAction({ projectSlug, id: p.id })
      if (!r.ok) throw new Error(r.error)
      const url = personPreviewUrl({ origin: r.origin, locale: defaultLocale, projectSlug: r.projectSlug, id: p.id, token: r.token })
      if (tab) tab.location.href = url
      else window.location.assign(url)
    } catch {
      tab?.close()
      show({ message: t('previewFailed'), tone: 'error' }, 7000)
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

  // ── Selection (square checkboxes; shift selects a range) and bulk changes ───
  const canSelect = canWrite || canArchive
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lastPicked, setLastPicked] = useState<string | null>(null)
  const [groupSheet, setGroupSheet] = useState(false)
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
    ? { selected, onToggle: toggle, allState, onToggleAll: toggleAll, rowLabel: (r: PersonRow) => tb('checkbox', { name: r.name }), allLabel: tb('allLabel') }
    : undefined

  /** Shown at once, "… · Undo"; the server call (one bulkUpdatePersons) runs after the delay. */
  function runBulk(op: PersonBulkAction, group?: string) {
    const { targets, skipped } = bulkTargets(selectedRows, op, group)
    clearSelection()
    setGroupSheet(false)
    if (!targets.length) return show({ message: tb('nothing'), tone: 'status' }, 6000)
    const ids = targets.map((r) => r.id)
    setOverlay((o) => {
      const n = { ...o }
      for (const r of targets) {
        const change: Partial<Pick<PersonRow, 'state' | 'visibility' | 'groups'>> =
          op === 'archive' ? { state: 'archived' } : op === 'show' ? { visibility: 'listed' } : op === 'hide' ? { visibility: 'off' } : { groups: op === 'addGroup' ? [...r.groups, group!] : r.groups.filter((k) => k !== group) }
        n[r.id] = { ...n[r.id], ...change }
      }
      return n
    })
    const note = skipped ? ` · ${tb('skipped', { count: skipped })}` : ''
    schedule({
      id: `bulk-${op}-${ids.join(',')}`,
      message: tb(`message.${op}`, { count: ids.length, group: group ? groupLabel(group) : '' }) + note,
      undoLabel: t('undo'),
      failMessage: te('failed'),
      restore: () => dropOverlay(ids),
      run: async () => {
        const r = await bulkUpdatePersonsAction({ projectSlug, ids, op, ...(group && { group }) })
        if (!r.ok) {
          dropOverlay(ids)
          show({ message: errorText(r.error), tone: 'error' }, 9000)
          return true
        }
        // Whoever the server skipped or could not change goes back to what they were.
        const notChanged = [...r.skipped.map((x) => x.id), ...r.failed.map((x) => x.id)]
        if (notChanged.length) dropOverlay(notChanged)
        if (r.failed.length) {
          const names = r.failed.slice(0, 3).map((f) => `${rows.find((x) => x.id === f.id)?.name ?? ''} — ${errorText(f.code)}`)
          show({ message: tb('attention', { count: r.failed.length, details: names.join('; ') + (r.failed.length > 3 ? ` +${r.failed.length - 3}` : '') }), tone: 'error' }, 9000)
        }
        appRouter.refresh()
        return true
      },
    })
  }
  const anyEditable = selectedRows.some((r) => !r.anonymised && r.state !== 'archived')
  const groupChoices = groupTerms.map((g) => ({ key: g.value, label: groupLabel(g.value), add: bulkTargets(selectedRows, 'addGroup', g.value).targets.length, remove: bulkTargets(selectedRows, 'removeGroup', g.value).targets.length }))

  const menuFor = (p: PersonRow): CardMenuItem[] => {
    const items: CardMenuItem[] = [{ key: 'edit', label: t('actions.edit'), onSelect: () => appRouter.push(p.href) }]
    if (!p.anonymised) items.push({ key: 'preview', label: t('actions.preview'), onSelect: () => void preview(p) })
    if (p.usageCount) items.push({ key: 'usedIn', label: t('actions.usedIn'), onSelect: () => setUsedInOf(p) })
    items.push({ key: 'activity', label: t('actions.activity'), onSelect: () => setActivityOf(p) })
    if (p.state === 'archived') {
      if (canArchive) items.push({ key: 'restore', label: tl('actions.restore'), onSelect: () => void restore(p) })
    } else if (p.isPublished && canArchive && !p.anonymised) {
      items.push({ key: 'archive', label: tl('actions.archive'), onSelect: () => archive(p) })
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
      <PersonActivitySheet open={activityOf !== null} onClose={() => setActivityOf(null)} projectSlug={projectSlug} personId={activityOf?.id ?? ''} />
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
        languages={(languages ?? []).filter((l) => l !== defaultLocale)}
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
                sort={filters.sort}
                onSort={(column: PersonSortColumn) => update({ sort: nextPersonSort(column, filters.sort) })}
                onOpen={open}
                onUsedIn={setUsedInOf}
                menuFor={menuFor}
                groupLabel={groupLabel}
                reorder={reorder}
                selection={selection}
              />
            ) : (
              <>
                {selection ? (
                  <div className="mb-3">
                    <SelectAll label={tb('all')} ariaLabel={tb('allLabel')} state={allState} onChange={toggleAll} />
                  </div>
                ) : null}
                <PeopleCardsGrid rows={shown} selection={selection} onOpen={open} onUsedIn={setUsedInOf} menuFor={menuFor} groupLabel={groupLabel} />
              </>
            )}
          </div>
          {/* Phones */}
          <div className="md:hidden">
            <PeoplePhoneList rows={shown} selection={selection} menuFor={menuFor} groupLabel={groupLabel} reorder={reorder} />
          </div>
        </>
      )}

      {canSelect && selectedRows.length > 0 ? (
        <SelectionBar label={tb('toolbar')} count={tb('count', { count: selectedRows.length })}>
          {canWrite && groupTerms.length > 0 ? (
            <BarButton disabled={!anyEditable} onPress={() => setGroupSheet(true)} icon={PERSON_ICONS.tag}>
              {tb('bar.groups')}
            </BarButton>
          ) : null}
          {canWrite ? (
            <BarButton disabled={bulkTargets(selectedRows, 'show').targets.length === 0} onPress={() => runBulk('show')} icon={POST_ICONS.online}>
              {tb('bar.show')}
            </BarButton>
          ) : null}
          {canWrite ? (
            <BarButton disabled={bulkTargets(selectedRows, 'hide').targets.length === 0} onPress={() => runBulk('hide')} icon={POST_ICONS.offline}>
              {tb('bar.hide')}
            </BarButton>
          ) : null}
          {canArchive ? (
            <BarButton disabled={bulkTargets(selectedRows, 'archive').targets.length === 0} onPress={() => runBulk('archive')} icon={POST_ICONS.archiveAction}>
              {tb('bar.archive')}
            </BarButton>
          ) : null}
          <BarButton onPress={clearSelection} icon={POST_ICONS.x}>
            {tb('bar.clear')}
          </BarButton>
        </SelectionBar>
      ) : null}

      <BottomSheet open={groupSheet} title={tb('groupsTitle', { count: selectedRows.length })} onClose={() => setGroupSheet(false)}>
        <div className="mt-2 flex flex-col">
          {groupChoices.some((g) => g.add > 0) ? <p className="px-3 pt-2 pb-1 text-sm font-semibold text-muted-foreground">{tb('addHeading')}</p> : null}
          {groupChoices
            .filter((g) => g.add > 0)
            .map((g) => (
              <SheetItem key={`add-${g.key}`} onPress={() => runBulk('addGroup', g.key)}>
                {g.label}
              </SheetItem>
            ))}
          {groupChoices.some((g) => g.remove > 0) ? <p className="px-3 pt-3 pb-1 text-sm font-semibold text-muted-foreground">{tb('removeHeading')}</p> : null}
          {groupChoices
            .filter((g) => g.remove > 0)
            .map((g) => (
              <SheetItem key={`remove-${g.key}`} onPress={() => runBulk('removeGroup', g.key)}>
                {g.label}
              </SheetItem>
            ))}
          {groupChoices.every((g) => g.add === 0 && g.remove === 0) ? <p className="px-3 py-2 text-[0.9375rem] text-muted-foreground">{tb('nothing')}</p> : null}
        </div>
      </BottomSheet>

      {dialogs}
    </div>
  )
}
