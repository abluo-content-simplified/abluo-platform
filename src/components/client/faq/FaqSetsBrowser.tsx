'use client'

import { CreateAction } from '@/components/app/ui/CreateAction'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from 'next/navigation'
import { getPathname, useRouter as useAppRouter } from '@/i18n/navigation'
import type { FaqSetListItem, FaqSetState, FaqSetUsage, FaqSite } from '@/lib/api/faq-sets'
import { duplicateFaqSetAction, faqSetLifecycleAction } from '@/app/[locale]/(client)/[tenant]/faq-sets/actions'
import {
  activeFaqFilterCount,
  applyFaqFilters,
  DEFAULT_FAQ_FILTERS,
  faqFiltersToParams,
  faqStateCounts,
  isDefaultFaqFilters,
  nextFaqSort,
  parseFaqFilters,
  type FaqSetFilters,
  type FaqSortColumn,
} from '@/lib/client/faq-sets-filter'
import { DeletePermanentlyDialog } from '@/components/app/lifecycle/DeletePermanentlyDialog'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import type { CardMenuItem } from '@/components/app/ui/CardMenu'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { useViewPreference } from '@/components/app/ui/use-view-preference'
import { ViewSwitch } from '@/components/app/ui/ViewSwitch'
import { FaqSetsFilters } from './FaqSetsFilters'
import { FaqSetsTable } from './FaqSetsTable'
import { FaqSetCardsGrid, FaqSetPhoneList } from './FaqSetCards'
import { NewFaqSetDialog } from './NewFaqSetDialog'
import { FAQ_ICONS, toFaqRow, UsedInList, useUsedInSummary, type FaqRow } from './faq-bits'

const VIEW_KEY = 'abluo.faqSets.view'
const VIEWS = ['list', 'cards'] as const
type View = (typeof VIEWS)[number]

/**
 * The FAQ Sets library (ADR-037 D9) — a Content-kind list screen, like
 * Galleries: ListToolbar + DataTable (computers, the default) ⇄ ContentCard
 * grid, remembered per person; phones get one row per set. Rendered inside
 * the page's PageShell. Filters run in the browser on the loaded list
 * (faq-sets-filter.ts) and live in the URL; `?new=1` opens "New FAQ set".
 *
 * Row menu: Edit · Duplicate · Archive / Restore · Delete (a draft never
 * published) / Delete permanently (archived; Owner — canDelete). The server
 * re-checks every rule: archiving is refused while public content shows the
 * set, and the refusal names where. Without faq.set.write the list is
 * read-only (no menus, no "New FAQ set").
 */
export function FaqSetsBrowser({
  projectSlug,
  sets,
  site,
  canWrite,
  canDelete = false,
  initialQuery = '',
}: {
  projectSlug: string
  sets: FaqSetListItem[]
  site: FaqSite
  canWrite: boolean
  /** faq.set.delete: may delete archived sets permanently (the server re-checks). */
  canDelete?: boolean
  /** The page's query string at request time. */
  initialQuery?: string
}) {
  const t = useTranslations('clientDashboard.faq.list')
  const te = useTranslations('clientDashboard.faq.errors')
  const tl = useTranslations('app.lifecycle')
  const ui = useLocale()
  const router = useRouter()
  const appRouter = useAppRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()
  const summarize = useUsedInSummary()

  const [view, chooseView] = useViewPreference<View>(VIEW_KEY, VIEWS, 'list')

  // ── Filters (in the URL) ───────────────────────────────────────────────────
  const initialParams = useMemo(() => new URLSearchParams(initialQuery), [initialQuery])
  const [filters, setFilters] = useState<FaqSetFilters>(() => parseFaqFilters(initialParams))
  const replaceUrl = (f: FaqSetFilters) => {
    const qs = faqFiltersToParams(f).toString()
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }
  const update = (patch: Partial<FaqSetFilters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    replaceUrl(next)
  }
  const reset = () => update({ ...DEFAULT_FAQ_FILTERS, sort: filters.sort })

  // ── "New FAQ set" (also from the Add-content sheet: ?new=1) ────────────────
  const [creating, setCreating] = useState(() => canWrite && initialParams.get('new') === '1')
  // Arriving again with ?new=1 (the Add-content sheet while already on this page) opens it too.
  const askedNew = canWrite && initialParams.get('new') === '1'
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follow the URL's ?new=1
    if (askedNew) setCreating(true)
  }, [askedNew, initialQuery])
  const closeCreate = () => {
    setCreating(false)
    if (initialParams.get('new')) replaceUrl(filters)
  }

  // ── Rows (with lifecycle changes shown at once, until the refresh lands) ──
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [overlay, setOverlay] = useState<Record<string, FaqSetState>>({})
  const untitled = t('untitled')
  const rows: FaqRow[] = useMemo(
    () =>
      sets
        .filter((s) => !hidden.has(s.id))
        .map((s) => {
          const row = toFaqRow(s, projectSlug, untitled)
          return overlay[s.id] ? { ...row, state: overlay[s.id] } : row
        }),
    [sets, hidden, overlay, projectSlug, untitled]
  )
  const shown = useMemo(() => applyFaqFilters(rows, filters), [rows, filters])
  const counts = useMemo(() => faqStateCounts(rows, filters), [rows, filters])
  const multilingual = site.languages.length > 1

  // ── Actions ────────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false)
  const [usedInOf, setUsedInOf] = useState<FaqRow | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<FaqRow | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const { toast, show, schedule } = useUndo()

  const errorText = (code: string, usedIn?: FaqSetUsage[]) =>
    code === 'in_use' && usedIn?.length ? te('in_use', { places: summarize(usedIn) }) : te.has(code) ? te(code) : te('failed')

  const open = (s: FaqRow, newTab: boolean) => {
    if (newTab) window.open(getPathname({ href: s.href, locale: ui }), '_blank', 'noopener')
    else appRouter.push(s.href)
  }

  async function duplicate(s: FaqRow) {
    if (busy) return
    setBusy(true)
    try {
      const r = await duplicateFaqSetAction({ projectSlug, id: s.id, name: t('copyOf', { name: s.name }).slice(0, 120) })
      if (!r.ok) return show({ message: errorText(r.error), tone: 'error' }, 7000)
      appRouter.push(`/${projectSlug}/faq-sets/${r.id}`)
    } catch {
      show({ message: te('failed'), tone: 'error' }, 7000)
    } finally {
      setBusy(false)
    }
  }

  async function lifecycle(s: FaqRow, op: 'archive' | 'restore') {
    if (busy) return
    setBusy(true)
    try {
      const r = await faqSetLifecycleAction({ projectSlug, id: s.id, op })
      if (!r.ok) return show({ message: errorText(r.error, r.detail?.usedIn), tone: 'error' }, 9000)
      const next: FaqSetState = op === 'archive' ? 'archived' : s.isPublished ? (s.hasDraft ? 'changes' : 'published') : 'draft'
      setOverlay((o) => ({ ...o, [s.id]: next }))
      show({ message: op === 'archive' ? t('done.archived', { name: s.name }) : t('done.restored', { name: s.name }), tone: 'status' })
      appRouter.refresh()
    } catch {
      show({ message: te('failed'), tone: 'error' }, 7000)
    } finally {
      setBusy(false)
    }
  }

  /** A draft that was never published goes behind "Deleted · Undo" (as Posts). */
  function deleteDraft(s: FaqRow) {
    setHidden((h) => new Set([...h, s.id]))
    schedule({
      id: s.id,
      message: t('done.deleted', { name: s.name }),
      undoLabel: t('undo'),
      failMessage: te('failed'),
      restore: () =>
        setHidden((h) => {
          const n = new Set(h)
          n.delete(s.id)
          return n
        }),
      run: async () => {
        const r = await faqSetLifecycleAction({ projectSlug, id: s.id, op: 'deleteDraft' })
        if (r.ok) appRouter.refresh()
        return r.ok
      },
    })
  }

  async function deletePermanently() {
    const s = confirmDelete
    if (!s || busy) return
    setBusy(true)
    setDeleteError(null)
    try {
      const r = await faqSetLifecycleAction({ projectSlug, id: s.id, op: 'deletePermanently' })
      if (!r.ok) return setDeleteError(errorText(r.error, r.detail?.usedIn))
      setHidden((h) => new Set([...h, s.id]))
      setConfirmDelete(null)
      show({ message: t('done.deleted', { name: s.name }), tone: 'status' })
      appRouter.refresh()
    } catch {
      setDeleteError(te('failed'))
    } finally {
      setBusy(false)
    }
  }

  const menuFor = (s: FaqRow): CardMenuItem[] => {
    const items: CardMenuItem[] = [{ key: 'edit', label: t('actions.edit'), onSelect: () => appRouter.push(s.href) }]
    if (s.usedIn.length) items.push({ key: 'usedIn', label: t('actions.usedIn'), onSelect: () => setUsedInOf(s) })
    if (!canWrite) return items
    items.push({ key: 'duplicate', label: t('actions.duplicate'), onSelect: () => void duplicate(s) })
    if (s.state === 'archived') {
      items.push({ key: 'restore', label: tl('actions.restore'), onSelect: () => void lifecycle(s, 'restore') })
      if (canDelete) items.push({ key: 'deletePermanently', label: tl('actions.deletePermanently'), onSelect: () => setConfirmDelete(s), destructive: true, separated: true })
    } else if (s.isPublished) {
      items.push({ key: 'archive', label: tl('actions.archive'), onSelect: () => void lifecycle(s, 'archive') })
    } else {
      items.push({ key: 'delete', label: tl('actions.delete'), onSelect: () => deleteDraft(s), destructive: true, separated: true })
    }
    return items
  }

  const header = (
    <PageHeader
      title={t('title')}
      actions={
        <>
          {sets.length > 0 ? (
            <ViewSwitch
              label={t('view.label')}
              value={view}
              onChange={chooseView}
              options={[
                { value: 'list', label: t('view.list'), icon: FAQ_ICONS.list },
                { value: 'cards', label: t('view.cards'), icon: FAQ_ICONS.grid },
              ]}
            />
          ) : null}
          {canWrite ? (
            <CreateAction>
            <Button variant="primary" onClick={() => setCreating(true)}>
              {FAQ_ICONS.plus}
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
      {canWrite ? <NewFaqSetDialog open={creating} onClose={closeCreate} projectSlug={projectSlug} /> : null}
      <BottomSheet open={usedInOf !== null} title={t('usedInTitle', { name: usedInOf?.name ?? '' })} onClose={() => setUsedInOf(null)}>
        {usedInOf ? <UsedInList usedIn={usedInOf.usedIn} projectSlug={projectSlug} /> : null}
      </BottomSheet>
      <DeletePermanentlyDialog
        open={confirmDelete !== null}
        titles={confirmDelete ? [confirmDelete.name] : []}
        busy={busy}
        error={deleteError}
        onConfirm={() => void deletePermanently()}
        onCancel={() => {
          setConfirmDelete(null)
          setDeleteError(null)
        }}
      />
      <Toast message={toast?.message ?? null} tone={toast?.tone} action={toast?.undo ? t('undo') : undefined} onAction={toast?.undo} />
    </>
  )

  if (sets.length === 0) {
    return (
      <div className="space-y-4">
        {header}
        <EmptyState
          title={t('emptyTitle')}
          body={t('emptyBody')}
          action={
            canWrite ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                {FAQ_ICONS.plus}
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

      <FaqSetsFilters
        filters={filters}
        update={update}
        reset={reset}
        isDefault={isDefaultFaqFilters(filters)}
        counts={counts}
        resultCount={shown.length}
        total={rows.length}
        activeCount={activeFaqFilterCount(filters)}
        showSortOnDesktop={view === 'cards'}
      />

      {shown.length === 0 ? (
        <EmptyState titleAs="p" title={t('filters.noMatch')} action={<Button onClick={reset}>{t('filters.clear')}</Button>} />
      ) : (
        <>
          {/* Computers */}
          <div className="hidden md:block">
            {view === 'list' ? (
              <FaqSetsTable
                rows={shown}
                canWrite={canWrite}
                multilingual={multilingual}
                sort={filters.sort}
                onSort={(column: FaqSortColumn) => update({ sort: nextFaqSort(column, filters.sort) })}
                onOpen={open}
                onUsedIn={setUsedInOf}
                menuFor={menuFor}
              />
            ) : (
              <FaqSetCardsGrid rows={shown} canWrite={canWrite} onOpen={open} onUsedIn={setUsedInOf} menuFor={menuFor} />
            )}
          </div>
          {/* Phones */}
          <div className="md:hidden">
            <FaqSetPhoneList rows={shown} canWrite={canWrite} menuFor={menuFor} />
          </div>
        </>
      )}

      {dialogs}
    </div>
  )
}
