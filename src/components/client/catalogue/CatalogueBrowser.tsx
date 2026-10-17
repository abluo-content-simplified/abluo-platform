'use client'

import { useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { ViewSwitch } from '@/components/app/ui/ViewSwitch'
import { FilterBar, FilterSearch, FilterSelect } from '@/components/app/ui/FilterBar'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { CardGrid, CardGridItem, ContentCard, SelectAll } from '@/components/app/ui/list/ContentCard'
import { CellDate, CellImage, CellPill, CellText, Chips, DisplayTimeZoneContext, MediaFrame, Pill } from '@/components/app/ui/list/cells'
import { Checkbox, isShiftChange } from '@/components/app/ui/Checkbox'
import { idRange, SelectionBar } from '@/components/app/ui/SelectionBar'
import { BarButton } from '@/components/app/ui/BarButton'
import { ICONS as POST_ICONS } from '@/components/client/posts/post-bits'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { Toast } from '@/components/app/ui/Toast'
import { useViewPreference } from '@/components/app/ui/use-view-preference'
import { useUndo } from '@/components/app/ui/use-undo'
import { LifecycleBadge } from '@/components/app/lifecycle/LifecycleBadge'
import { lifecycleMenu, type LifecycleAction } from '@/components/app/lifecycle/lifecycle-menu'
import { DeletePermanentlyDialog } from '@/components/app/lifecycle/DeletePermanentlyDialog'
import { editingZone } from '@/components/app/lifecycle/zoned-time'
import { catalogueLifecycleAction, publishCatalogueDraftAction } from '@/app/[locale]/(client)/[tenant]/catalogue/actions'
import type { CatalogueAbilities, CatalogueLists, CatalogueSite } from '@/lib/api/catalogue-drafts'
import type { LifecycleState } from '@/lib/lifecycle/status'
import type { Referrer } from '@/lib/lifecycle/service'
import { catalogueImageShape, itemSecondaryLine, type ImageShape } from '@/lib/modules/catalogue/list-model'
import { formatPrice } from '@/lib/modules/catalogue/resolve'
import { inCatalogueStatus, itemGaps, parseStatusFilter, searchable, type CatalogueStatusFilter, type ItemGap } from '@/lib/modules/catalogue/dashboard-form'
import type { CatalogueKind } from '@/lib/modules/catalogue/dashboard-patch'
import {
  availableBatchOps,
  batchStep,
  canPublishChanges,
  formatListSort,
  LIST_SORT_KEYS,
  nextListSort,
  parseListSort,
  sortListRows,
  summarizeBatch,
  type BatchOp,
  type BatchOutcome,
  type BatchStep,
  type ListSort,
  type ListSortKey,
} from '@/lib/modules/catalogue/list-model'
import { CAT_ICONS, GapBadges, InUseNotice, SegmentTabs, UnpublishDateSheet, catalogueHref, textIn, useCatalogueError } from './catalogue-ui'
import { ButtonLink } from '@/components/app/ui/Button'

export type CatalogueView = 'items' | 'collections' | 'optionLists'
const VIEWS: readonly CatalogueView[] = ['items', 'collections', 'optionLists']
const KIND: Record<CatalogueView, CatalogueKind> = { items: 'item', collections: 'collection', optionLists: 'optionList' }

type Row = {
  kind: CatalogueKind
  id: string
  name: string
  href: string
  thumb: string | null
  showsMedia: boolean
  /** Frame shape of this row's image (per item profile). */
  shape: ImageShape
  status: LifecycleState
  details: string
  chips: string[]
  gaps: ItemGap[]
  updatedAt: string
  search: string
  categories: string[]
  /** The draft's revision (what publishing is guarded on); '' without a draft. */
  draftRev: string
  hasPage: boolean
  /** Effective publish / unpublish dates (ISO) for the columns and sorting. */
  publishOn: string | null
  unpublishOn: string | null
  price: number | null
  priceLabel: string
  /** Where the live page is, only when it resolves right now. */
  publicUrl: string | null
}

/**
 * The catalogue screen (spec §10.2/§10.5): one nav entry (ADR-033 D12) with
 * Items (default), Collections and Option lists as internal views. Desktop: a
 * table or cards (the view switch); phones: cards, menus in bottom sheets.
 * Status filter uses the lifecycle vocabulary — archived is hidden from "All".
 * Gaps (no photo, no price) are quiet badges, never blocking.
 */
export function CatalogueBrowser({
  projectSlug,
  title,
  lists,
  site,
  can,
  initialView,
  initialStatus,
  initialSort = null,
}: {
  projectSlug: string
  /** The tenant's name for the module (navLabel) or the messages default. */
  title: string
  lists: CatalogueLists
  site: Pick<CatalogueSite, 'defaultLocale' | 'timeZone'> & { currency: string; /** Frame shape for items without a profile (starter-preset fallback); items with a profile follow the registry. */ imageShape: ImageShape; categories: { value: string; label: Record<string, string> }[] }
  can: CatalogueAbilities
  initialView: string | null
  initialStatus: string | null
  initialSort?: string | null
}) {
  const t = useTranslations('catalogue.dashboard.list')
  const tl = useTranslations('app.lifecycle')
  const ui = useLocale()
  const router = useRouter()
  const errorText = useCatalogueError()
  const [view, setView] = useState<CatalogueView>(VIEWS.includes(initialView as CatalogueView) ? (initialView as CatalogueView) : 'items')
  const [status, setStatus] = useState<CatalogueStatusFilter>(parseStatusFilter(initialStatus))
  const [sort, setSort] = useState<ListSort>(() => parseListSort(initialSort))
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lastPicked, setLastPicked] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [display, setDisplay] = useViewPreference<'list' | 'cards'>('catalogue.view', ['list', 'cards'], 'list')
  const [busy, setBusy] = useState(false)
  const { toast, show: setToast } = useUndo()
  const [inUse, setInUse] = useState<Referrer[] | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Row | null>(null)
  const [dateFor, setDateFor] = useState<Row | null>(null)
  const zone = editingZone(site.timeZone)
  const kind = KIND[view]
  const abilities = can[kind]
  const d = site.defaultLocale
  const catLabel = useMemo(() => new Map(site.categories.map((c) => [c.value, textIn(c.label, ui, d) || c.value])), [site.categories, ui, d])

  const syncUrl = (v: CatalogueView, s: CatalogueStatusFilter, so: ListSort = sort) => {
    try {
      const u = new URL(window.location.href)
      u.searchParams.set('view', v)
      if (s === 'all') u.searchParams.delete('status')
      else u.searchParams.set('status', s)
      if (so.key === 'name' && so.dir === 'asc') u.searchParams.delete('sort')
      else u.searchParams.set('sort', formatListSort(so))
      window.history.replaceState(window.history.state, '', u.pathname + u.search)
    } catch {
      /* ignore */
    }
  }

  const rows: Row[] = useMemo(() => {
    const nameOf = (names: Record<string, string>, fallback: string) => textIn(names, ui, d) || fallback
    const base = (x: { id: string; status: LifecycleState; draftRev: string; publishedAt: string | null; expiresAt: string | null; publicUrl: string | null; updatedAt: string }) => ({
      id: x.id,
      status: x.status,
      draftRev: x.draftRev,
      publishOn: x.status.status === 'draft' ? null : x.publishedAt,
      unpublishOn: x.status.status === 'draft' ? null : x.expiresAt,
      publicUrl: x.publicUrl,
      updatedAt: x.updatedAt,
    })
    if (view === 'items') {
      return lists.items.map((i): Row => {
        const name = nameOf(i.names, t('untitled'))
        const price = i.fromPrice !== null ? formatPrice(i.fromPrice, site.currency, ui) : ''
        const chips = i.categories.map((c) => catLabel.get(c) ?? c)
        return {
          ...base(i),
          kind: 'item',
          name,
          href: catalogueHref(projectSlug, 'item', i.id),
          thumb: i.thumb,
          showsMedia: true,
          shape: i.itemProfile ? catalogueImageShape({ itemProfile: i.itemProfile }) : site.imageShape,
          details: itemSecondaryLine({ itemProfile: i.itemProfile, byline: textIn(i.byline, ui, d), author: i.bookAuthor, year: i.bookYear }),
          chips,
          gaps: itemGaps(i).filter((g) => g !== 'noPrice'),
          search: searchable(`${Object.values(i.names).join(' ')} ${Object.values(i.byline).join(' ')} ${i.bookAuthor ?? ''} ${chips.join(' ')}`),
          categories: i.categories,
          hasPage: i.hasPage,
          price: i.fromPrice,
          priceLabel: price ? (i.offerCount > 1 ? t('fromPrice', { price }) : price) : '',
        }
      })
    }
    if (view === 'collections') {
      return lists.collections.map((c): Row => {
        const names = c.sectionNames.map((n) => textIn(n, ui, d)).filter(Boolean)
        const shownNames = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '')
        return {
          ...base(c),
          kind: 'collection',
          name: nameOf(c.names, t('untitled')),
          href: catalogueHref(projectSlug, 'collection', c.id),
          thumb: null,
          showsMedia: false,
          shape: 'landscape',
          details: [t(`collectionType.${c.collectionType}`), names.length ? shownNames : t('sectionsCount', { count: c.sectionCount }), t('itemsCount', { count: c.itemCount })].join(' · '),
          chips: [],
          gaps: [],
          search: searchable(`${Object.values(c.names).join(' ')} ${names.join(' ')}`),
          categories: [],
          hasPage: c.hasPage,
          price: null,
          priceLabel: '',
        }
      })
    }
    return lists.optionLists.map((o): Row => ({
      ...base(o),
      kind: 'optionList',
      name: nameOf(o.names, t('untitled')),
      href: catalogueHref(projectSlug, 'optionList', o.id),
      thumb: null,
      showsMedia: false,
      shape: 'landscape',
      details: [t('optionsCount', { count: o.optionCount }), t('usedBy', { count: o.usedBy })].join(' · '),
      chips: [],
      gaps: [],
      search: searchable(Object.values(o.names).join(' ')),
      categories: [],
      hasPage: false,
      price: null,
      priceLabel: '',
    }))
  }, [view, lists, ui, d, t, site.currency, site.imageShape, catLabel, projectSlug])

  const q = searchable(query.trim())
  const shown = useMemo(
    () => sortListRows(rows.filter((r) => inCatalogueStatus(r.status.status, status) && (!q || r.search.includes(q)) && (!category || r.categories.includes(category))), sort, ui),
    [rows, status, q, category, sort, ui]
  )
  const total = rows.length

  async function act(row: Row, action: LifecycleAction, expiresAt?: string | null) {
    if (busy) return false
    setBusy(true)
    setInUse(null)
    try {
      const r = await catalogueLifecycleAction({ projectSlug, kind: row.kind, op: action, id: row.id, expiresAt })
      if (!r.ok) {
        if (r.error === 'in_use' && r.detail?.referrers?.length) setInUse(r.detail.referrers)
        else setToast({ message: errorText(r.error), tone: 'error' })
        return false
      }
      setToast({ message: t('done'), tone: 'status' })
      router.refresh()
      return true
    } catch {
      setToast({ message: errorText('offline'), tone: 'error' })
      return false
    } finally {
      setBusy(false)
    }
  }

  // ── Selection (checkboxes only; shift selects a range) ─────────────────────
  const canSelect = abilities.write
  const selectedIds = shown.filter((r) => selected.has(r.id)).map((r) => r.id)
  const selectedRows = shown.filter((r) => selected.has(r.id))
  const allState: 'none' | 'some' | 'all' = selectedIds.length === 0 ? 'none' : selectedIds.length === shown.length ? 'all' : 'some'
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
  const batchOps = availableBatchOps(selectedRows.map((r) => r.status), abilities.write)

  /** One existing per-item server action — each keeps its own permission, validation and lifecycle checks. */
  async function execStep(row: Row, step: BatchStep): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const r =
        step.via === 'publish'
          ? await publishCatalogueDraftAction({ projectSlug, kind: row.kind, id: row.id, rev: row.draftRev, mode: step.mode })
          : await catalogueLifecycleAction({ projectSlug, kind: row.kind, op: step.op, id: row.id })
      return r.ok ? { ok: true } : { ok: false, reason: errorText(r.error) }
    } catch {
      return { ok: false, reason: errorText('offline') }
    }
  }

  async function runBatch(op: BatchOp) {
    if (busy) return
    const targets = selectedRows.map((row) => ({ row, step: batchStep(row.status, op, abilities.write) })).filter((x): x is { row: Row; step: BatchStep } => x.step !== null)
    if (!targets.length) return
    setBusy(true)
    setInUse(null)
    const outcomes: BatchOutcome[] = []
    try {
      // Sequential on purpose: one item at a time, so a slow or refused one never blocks the others' checks.
      for (const { row, step } of targets) {
        const r = await execStep(row, step)
        outcomes.push({ id: row.id, name: row.name, ok: r.ok, reason: r.ok ? undefined : r.reason })
      }
    } finally {
      setBusy(false)
    }
    const { done, failed } = summarizeBatch(outcomes)
    const parts = [
      done ? t(`batch.done.${op}`, { count: done }) : '',
      failed.length ? t('batch.attention', { count: failed.length, details: failed.slice(0, 3).map((f) => `${f.name} — ${f.reason}`).join('; ') + (failed.length > 3 ? ` +${failed.length - 3}` : '') }) : '',
    ].filter(Boolean)
    setToast({ message: parts.join(' · '), tone: done === 0 ? 'error' : 'status' }, 9000)
    clearSelection()
    router.refresh()
  }

  async function publishChanges(row: Row) {
    if (busy) return
    setBusy(true)
    setInUse(null)
    const r = await execStep(row, { via: 'publish', mode: 'keep' })
    setBusy(false)
    if (r.ok) {
      setToast({ message: t('done'), tone: 'status' })
      router.refresh()
    } else setToast({ message: `${row.name} — ${r.reason}`, tone: 'error' }, 7000)
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setToast({ message: t('linkCopied'), tone: 'status' })
    } catch {
      setToast({ message: t('linkCopyFailed'), tone: 'error' })
    }
  }

  const onSort = (key: ListSortKey) => {
    const next = nextListSort(sort, key)
    setSort(next)
    syncUrl(view, status, next)
  }

  const menuFor = (row: Row): CardMenuItem[] => {
    const entries = lifecycleMenu(row.status.status, abilities)
    const items: CardMenuItem[] = [{ key: 'open', label: t('open'), onSelect: () => router.push(row.href), href: row.href }]
    if (abilities.write && canPublishChanges(row.status)) items.push({ key: 'publishChanges', label: t('menu.publishChanges'), onSelect: () => void publishChanges(row) })
    if (row.publicUrl) {
      const url = row.publicUrl
      items.push({ key: 'view', label: t('menu.viewOnWebsite'), onSelect: () => window.open(url, '_blank', 'noopener,noreferrer') })
      items.push({ key: 'copyLink', label: t('menu.copyLink'), onSelect: () => void copyLink(url) })
    }
    for (const e of entries) {
      items.push({
        key: e.action,
        label: tl(`actions.${e.action}`),
        destructive: e.destructive,
        separated: e.separated,
        onSelect: () => {
          if (e.action === 'delete' || e.action === 'deletePermanently') setConfirmDelete(row)
          else if (e.action === 'setUnpublishDate') setDateFor(row)
          else void act(row, e.action)
        },
      })
    }
    return items
  }

  const newHref = view === 'items' ? `/${projectSlug}/catalogue/new` : view === 'collections' ? `/${projectSlug}/catalogue/collections/new` : `/${projectSlug}/catalogue/option-lists/new`
  const newLabel = t(`new.${view}`)
  const statusOptions = (['all', 'draft', 'scheduled', 'published', 'unpublished', 'archived'] as const).map((s) => ({
    value: s,
    label: s === 'all' ? t('statusAll') : tl(`status.${s}`),
  }))

  const changesPill = (r: Row) => (r.status.hasChanges && r.status.status !== 'archived' ? <Pill tone="highlight">{t('changes.pending')}</Pill> : null)
  const showPrice = view === 'items'

  const columns: DataTableColumn<Row>[] = [
    {
      key: 'name',
      header: t('columns.name'),
      sortable: true,
      width: 'min-w-64',
      render: (r) => (
        <div className="flex items-start gap-3">
          {r.showsMedia ? <CellImage src={r.thumb} alt="" fit="contain" shape={r.shape} /> : null}
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <CellText primary={r.name} secondary={r.details} secondaryLines={1} href={r.href} />
            {r.chips.length ? <Chips items={r.chips} max={3} /> : null}
            <GapBadges gaps={r.gaps} />
          </div>
        </div>
      ),
    },
    { key: 'status', header: t('columns.status'), sortable: true, width: 'w-32', render: (r) => <LifecycleBadge status={r.status.status} /> },
    {
      key: 'changes',
      header: t('columns.changes'),
      sortable: true,
      width: 'w-40',
      render: (r) => <CellPill>{changesPill(r) ?? <CellDate iso={null} />}</CellPill>,
    },
    { key: 'publishOn', header: t('columns.publishOn'), sortable: true, width: 'w-32', render: (r) => <CellDate iso={r.publishOn} /> },
    { key: 'unpublishOn', header: t('columns.unpublishOn'), sortable: true, width: 'w-32', render: (r) => <CellDate iso={r.unpublishOn} /> },
    ...(showPrice
      ? [{ key: 'price', header: t('columns.price'), sortable: true, width: 'w-28', className: 'whitespace-nowrap', render: (r: Row) => <span className="flex min-h-6 items-center text-sm leading-6 text-foreground">{r.priceLabel || <span className="text-muted-foreground">—</span>}</span> }]
      : []),
    { key: 'updated', header: t('columns.updated'), sortable: true, width: 'w-32', render: (r) => <CellDate iso={r.updatedAt} /> },
    { key: 'menu', header: <span className="sr-only">{t('columns.actions')}</span>, width: 'w-14', render: (r) => <CardMenu variant="cell" label={t('menuFor', { name: r.name })} items={menuFor(r)} /> },
  ]

  const selection = canSelect
    ? { selected, onToggle: toggle, allState, onToggleAll: toggleAll, rowLabel: (r: Row) => t('select.checkbox', { name: r.name }), allLabel: t('select.allLabel') }
    : undefined
  const sortOptions = LIST_SORT_KEYS.filter((k) => k !== 'price' || showPrice).map((k) => ({ value: k, label: t(`columns.${k}`) }))

  const emptyAll = total === 0
  return (
    <DisplayTimeZoneContext.Provider value={zone}>
      <div className="space-y-4">
        <PageHeader
          title={title}
          actions={
            <>
              <span className="hidden md:inline-flex">
                <ViewSwitch
                  label={t('display.label')}
                  value={display}
                  onChange={setDisplay}
                  options={[
                    { value: 'list', label: t('display.list'), icon: CAT_ICONS.list },
                    { value: 'cards', label: t('display.cards'), icon: CAT_ICONS.cards },
                  ]}
                />
              </span>
              {abilities.write ? (
                <ButtonLink variant="primary" href={newHref}>
                  {CAT_ICONS.plus}
                  <span className="hidden sm:inline">{newLabel}</span>
                  <span className="sr-only sm:hidden">{newLabel}</span>
                </ButtonLink>
              ) : null}
            </>
          }
        />

        <SegmentTabs
          label={t('views.label')}
          value={view}
          onChange={(v) => {
            setView(v)
            setCategory('')
            syncUrl(v, status)
          }}
          options={VIEWS.map((v) => ({ value: v, label: t(`views.${v}`) }))}
        />

        {inUse ? <InUseNotice projectSlug={projectSlug} referrers={inUse} onClose={() => setInUse(null)} /> : null}

        {emptyAll ? (
          <EmptyState
            title={t(`empty.${view}.title`)}
            body={t(`empty.${view}.body`)}
            action={
              abilities.write ? (
                <ButtonLink variant="primary" href={newHref}>
                  {CAT_ICONS.plus}
                  {newLabel}
                </ButtonLink>
              ) : null
            }
          />
        ) : (
          <>
            <FilterBar label={t('filters.label')}>
              <FilterSearch value={query} onChange={setQuery} placeholder={t('filters.search')} label={t('filters.search')} sizing="w-full md:w-72" />
              <FilterSelect
                label={t('filters.status')}
                value={status}
                onChange={(v) => {
                  const s = parseStatusFilter(v)
                  setStatus(s)
                  syncUrl(view, s)
                }}
                options={statusOptions}
              />
              {view === 'items' && site.categories.length ? (
                <FilterSelect
                  label={t('filters.category')}
                  value={category}
                  onChange={setCategory}
                  options={[{ value: '', label: t('filters.anyCategory') }, ...site.categories.map((c) => ({ value: c.value, label: catLabel.get(c.value) ?? c.value }))]}
                />
              ) : null}
              <span className={`contents ${display === 'cards' ? '' : 'md:hidden'}`}>
                <FilterSelect
                  label={t('filters.sort')}
                  value={sort.key}
                  onChange={(v) => onSort(v as ListSortKey)}
                  options={sortOptions}
                />
              </span>
            </FilterBar>
            <p className="flex items-center gap-4 text-sm text-muted-foreground" aria-live="polite">
              <span>{t('count', { shown: shown.length, total })}</span>
              {canSelect && display === 'cards' && shown.length > 0 ? (
                <span className="hidden md:inline-flex">
                  <SelectAll label={t('select.all')} ariaLabel={t('select.allLabel')} state={allState} onChange={toggleAll} />
                </span>
              ) : null}
            </p>

            {shown.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-6 py-10">
                <p className="font-medium text-foreground">{t('noMatch')}</p>
                <button
                  type="button"
                  onClick={() => {
                    setQuery('')
                    setCategory('')
                    setStatus('all')
                    syncUrl(view, 'all')
                  }}
                  className="mt-3 inline-flex h-11 items-center rounded-xl border border-border px-4 text-sm font-medium text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {t('clearFilters')}
                </button>
              </div>
            ) : (
              <>
                {/* Computers: a table or cards. */}
                <div className="hidden md:block">
                  {display === 'list' ? (
                    <DataTable rows={shown} columns={columns} rowKey={(r) => r.id} rowHref={(r) => r.href} selection={selection} sort={{ column: sort.key, dir: sort.dir, onSort: (key) => onSort(key as ListSortKey) }} label={title} minWidth="64rem" />
                  ) : (
                    <CardGrid label={title}>
                      {shown.map((r) => (
                        <CardGridItem key={r.id}>
                          <ContentCard
                            media={{ src: r.thumb, fit: 'contain' }}
                            mediaShape={r.showsMedia && r.shape === 'portrait' ? 'portrait' : 'landscape'}
                            mediaContent={r.showsMedia ? undefined : <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-muted text-muted-foreground">{r.kind === 'collection' ? CAT_ICONS.menu : CAT_ICONS.listType}</span>}
                            title={r.name}
                            subtitle={r.details}
                            href={r.href}
                            selection={canSelect ? { checked: selected.has(r.id), onChange: (checked, shift) => toggle(r.id, checked, shift), label: t('select.checkbox', { name: r.name }) } : undefined}
                            overlay={<CardMenu variant="chip" label={t('menuFor', { name: r.name })} items={menuFor(r)} />}
                          >
                            {r.chips.length ? <Chips items={r.chips} max={3} /> : null}
                            <LifecycleBadge status={r.status.status} changes={r.status.hasChanges} />
                            <GapBadges gaps={r.gaps} />
                            {r.priceLabel ? <span className="mt-auto text-sm font-medium text-foreground">{r.priceLabel}</span> : null}
                          </ContentCard>
                        </CardGridItem>
                      ))}
                    </CardGrid>
                  )}
                </div>
                {/* Phones: cards, top-aligned, the menu as a bottom sheet. */}
                <ul className="flex flex-col gap-3 md:hidden" aria-label={title}>
                  {shown.map((r) => {
                    const isSel = selected.has(r.id)
                    return (
                      <li key={r.id} className={`flex items-start gap-1 rounded-xl border bg-card py-2 pr-1 ${isSel ? 'border-action ring-1 ring-action' : 'border-border'} ${canSelect ? 'pl-1' : 'pl-3'}`}>
                        {canSelect ? <Checkbox checked={isSel} aria-label={t('select.checkbox', { name: r.name })} onChange={(checked, e) => toggle(r.id, checked, isShiftChange(e))} /> : null}
                        <Link href={r.href} className="flex min-w-0 flex-1 items-start gap-3 pt-1 pb-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                          {r.showsMedia ? <MediaFrame src={r.thumb} alt="" fit="contain" size={r.shape === 'portrait' ? { width: '3.5rem', height: '5.25rem' } : { width: '4.5rem', height: '4.5rem' }} className="shrink-0 rounded-lg" /> : null}
                          <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
                            <span className="line-clamp-2 text-[0.9375rem] leading-6 font-semibold text-foreground">{r.name}</span>
                            {r.details ? <span className="line-clamp-1 max-w-full text-sm leading-5 text-muted-foreground">{r.details}</span> : null}
                            <LifecycleBadge status={r.status.status} changes={r.status.hasChanges} />
                            <GapBadges gaps={r.gaps} />
                            {r.priceLabel ? <span className="text-sm font-medium text-foreground">{r.priceLabel}</span> : null}
                          </span>
                        </Link>
                        <CardMenu label={t('menuFor', { name: r.name })} items={menuFor(r)} />
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </>
        )}

        {canSelect && selectedIds.length > 0 ? (
          <SelectionBar label={t('select.toolbar')} count={t('select.count', { count: selectedIds.length })}>
            {batchOps.includes('publish') ? (
              <BarButton disabled={busy} onPress={() => void runBatch('publish')} icon={POST_ICONS.online}>
                {t('bar.publish')}
              </BarButton>
            ) : null}
            {batchOps.includes('unpublish') ? (
              <BarButton disabled={busy} onPress={() => void runBatch('unpublish')} icon={POST_ICONS.offline}>
                {t('bar.unpublish')}
              </BarButton>
            ) : null}
            {batchOps.includes('archive') ? (
              <BarButton disabled={busy} onPress={() => void runBatch('archive')} icon={POST_ICONS.archiveAction}>
                {t('bar.archive')}
              </BarButton>
            ) : null}
            {batchOps.includes('restore') ? (
              <BarButton disabled={busy} onPress={() => void runBatch('restore')} icon={POST_ICONS.restore}>
                {t('bar.restore')}
              </BarButton>
            ) : null}
            <BarButton onPress={clearSelection} icon={POST_ICONS.x}>
              {t('bar.clear')}
            </BarButton>
          </SelectionBar>
        ) : null}

        <DeletePermanentlyDialog
          open={confirmDelete !== null}
          titles={confirmDelete ? [confirmDelete.name] : []}
          busy={busy}
          onConfirm={async () => {
            const row = confirmDelete
            if (!row) return
            const ok = await act(row, row.status.status === 'draft' ? 'delete' : 'deletePermanently')
            if (ok || !busy) setConfirmDelete(null)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
        <UnpublishDateSheet
          key={dateFor?.id ?? 'none'}
          open={dateFor !== null}
          busy={busy}
          zone={zone}
          onClose={() => setDateFor(null)}
          onSave={async (iso) => {
            if (dateFor && (await act(dateFor, 'setUnpublishDate', iso))) setDateFor(null)
          }}
          onRemove={
            dateFor?.status.unpublishOn
              ? async () => {
                  if (dateFor && (await act(dateFor, 'setUnpublishDate', null))) setDateFor(null)
                }
              : undefined
          }
        />
        <Toast message={toast?.message ?? null} tone={toast?.tone} />
      </div>
    </DisplayTimeZoneContext.Provider>
  )
}
