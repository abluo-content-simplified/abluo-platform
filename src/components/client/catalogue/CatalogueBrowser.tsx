'use client'

import { useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { ViewSwitch } from '@/components/app/ui/ViewSwitch'
import { FilterBar, FilterSearch, FilterSelect } from '@/components/app/ui/FilterBar'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { CardGrid, CardGridItem, ContentCard } from '@/components/app/ui/list/ContentCard'
import { CellDate, CellImage, CellText, Chips, DisplayTimeZoneContext, MediaFrame } from '@/components/app/ui/list/cells'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { Toast } from '@/components/app/ui/Toast'
import { useViewPreference } from '@/components/app/ui/use-view-preference'
import { useUndo } from '@/components/app/ui/use-undo'
import { LifecycleBadge } from '@/components/app/lifecycle/LifecycleBadge'
import { lifecycleMenu, type LifecycleAction } from '@/components/app/lifecycle/lifecycle-menu'
import { DeletePermanentlyDialog } from '@/components/app/lifecycle/DeletePermanentlyDialog'
import { editingZone } from '@/components/app/lifecycle/zoned-time'
import { catalogueLifecycleAction } from '@/app/[locale]/(client)/[tenant]/catalogue/actions'
import type { CatalogueAbilities, CatalogueLists, CatalogueSite } from '@/lib/api/catalogue-drafts'
import type { LifecycleState } from '@/lib/lifecycle/status'
import type { Referrer } from '@/lib/lifecycle/service'
import { formatPrice } from '@/lib/modules/catalogue/resolve'
import { inCatalogueStatus, itemGaps, parseStatusFilter, searchable, type CatalogueStatusFilter, type ItemGap } from '@/lib/modules/catalogue/dashboard-form'
import type { CatalogueKind } from '@/lib/modules/catalogue/dashboard-patch'
import { CAT_ICONS, CAT_PRIMARY, GapBadges, InUseNotice, SegmentTabs, UnpublishDateSheet, catalogueHref, textIn, useCatalogueError } from './catalogue-ui'

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
  status: LifecycleState
  details: string
  chips: string[]
  gaps: ItemGap[]
  updatedAt: string
  search: string
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
}: {
  projectSlug: string
  /** The tenant's name for the module (navLabel) or the messages default. */
  title: string
  lists: CatalogueLists
  site: Pick<CatalogueSite, 'defaultLocale' | 'timeZone'> & { currency: string; categories: { value: string; label: Record<string, string> }[] }
  can: CatalogueAbilities
  initialView: string | null
  initialStatus: string | null
}) {
  const t = useTranslations('catalogue.dashboard.list')
  const tl = useTranslations('app.lifecycle')
  const tt = useTranslations('catalogue.dashboard.itemProfiles')
  const ui = useLocale()
  const router = useRouter()
  const errorText = useCatalogueError()
  const [view, setView] = useState<CatalogueView>(VIEWS.includes(initialView as CatalogueView) ? (initialView as CatalogueView) : 'items')
  const [status, setStatus] = useState<CatalogueStatusFilter>(parseStatusFilter(initialStatus))
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

  const syncUrl = (v: CatalogueView, s: CatalogueStatusFilter) => {
    try {
      const u = new URL(window.location.href)
      u.searchParams.set('view', v)
      if (s === 'all') u.searchParams.delete('status')
      else u.searchParams.set('status', s)
      window.history.replaceState(window.history.state, '', u.pathname + u.search)
    } catch {
      /* ignore */
    }
  }

  const rows: Row[] = useMemo(() => {
    const nameOf = (names: Record<string, string>, fallback: string) => textIn(names, ui, d) || fallback
    if (view === 'items') {
      return lists.items.map((i) => {
        const name = nameOf(i.names, t('untitled'))
        const price = i.fromPrice !== null ? formatPrice(i.fromPrice, site.currency, ui) : ''
        const chips = i.categories.map((c) => catLabel.get(c) ?? c)
        return {
          kind: 'item',
          id: i.id,
          name,
          href: catalogueHref(projectSlug, 'item', i.id),
          thumb: i.thumb,
          showsMedia: true,
          status: i.status,
          details: [i.itemProfile ? tt(i.itemProfile) : null, price ? t('fromPrice', { price }) : null].filter(Boolean).join(' · '),
          chips,
          gaps: itemGaps(i),
          updatedAt: i.updatedAt,
          search: searchable(`${Object.values(i.names).join(' ')} ${chips.join(' ')}`),
          categories: i.categories,
        } as Row & { categories: string[] }
      })
    }
    if (view === 'collections') {
      return lists.collections.map((c) => ({
        kind: 'collection' as const,
        id: c.id,
        name: nameOf(c.names, t('untitled')),
        href: catalogueHref(projectSlug, 'collection', c.id),
        thumb: null,
        showsMedia: false,
        status: c.status,
        details: [t(`collectionType.${c.collectionType}`), t('sectionsCount', { count: c.sectionCount }), t('itemsCount', { count: c.itemCount })].join(' · '),
        chips: [],
        gaps: [],
        updatedAt: c.updatedAt,
        search: searchable(Object.values(c.names).join(' ')),
      }))
    }
    return lists.optionLists.map((o) => ({
      kind: 'optionList' as const,
      id: o.id,
      name: nameOf(o.names, t('untitled')),
      href: catalogueHref(projectSlug, 'optionList', o.id),
      thumb: null,
      showsMedia: false,
      status: o.status,
      details: [t('optionsCount', { count: o.optionCount }), t('usedBy', { count: o.usedBy })].join(' · '),
      chips: [],
      gaps: [],
      updatedAt: o.updatedAt,
      search: searchable(Object.values(o.names).join(' ')),
    }))
  }, [view, lists, ui, d, t, tt, site.currency, catLabel, projectSlug])

  const q = searchable(query.trim())
  const shown = rows.filter(
    (r) => inCatalogueStatus(r.status.status, status) && (!q || r.search.includes(q)) && (!category || (r as Row & { categories?: string[] }).categories?.includes(category))
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

  const menuFor = (row: Row): CardMenuItem[] => {
    const entries = lifecycleMenu(row.status.status, abilities)
    const items: CardMenuItem[] = [{ key: 'open', label: t('open'), onSelect: () => router.push(row.href), href: row.href }]
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

  const columns: DataTableColumn<Row>[] = [
    {
      key: 'name',
      header: t('columns.name'),
      width: 'min-w-64',
      render: (r) => (
        <div className="flex items-start gap-3">
          {r.showsMedia ? <CellImage src={r.thumb} alt="" /> : null}
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <CellText primary={r.name} secondary={r.details} href={r.href} />
            {r.chips.length ? <Chips items={r.chips} max={3} /> : null}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      width: 'w-56',
      render: (r) => (
        <div className="flex flex-col items-start gap-1.5">
          <LifecycleBadge status={r.status.status} changes={r.status.hasChanges} />
          <GapBadges gaps={r.gaps} />
        </div>
      ),
    },
    { key: 'updated', header: t('columns.updated'), width: 'w-36', render: (r) => <CellDate iso={r.updatedAt} /> },
    { key: 'menu', header: <span className="sr-only">{t('columns.actions')}</span>, width: 'w-14', render: (r) => <CardMenu variant="cell" label={t('menuFor', { name: r.name })} items={menuFor(r)} /> },
  ]

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
                <Link href={newHref} className={CAT_PRIMARY}>
                  {CAT_ICONS.plus}
                  <span className="hidden sm:inline">{newLabel}</span>
                  <span className="sr-only sm:hidden">{newLabel}</span>
                </Link>
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
                <Link href={newHref} className={CAT_PRIMARY}>
                  {CAT_ICONS.plus}
                  {newLabel}
                </Link>
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
            </FilterBar>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {t('count', { shown: shown.length, total })}
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
                    <DataTable rows={shown} columns={columns} rowKey={(r) => r.id} rowHref={(r) => r.href} label={title} minWidth="44rem" />
                  ) : (
                    <CardGrid label={title}>
                      {shown.map((r) => (
                        <CardGridItem key={r.id}>
                          <ContentCard
                            media={{ src: r.thumb }}
                            mediaContent={r.showsMedia ? undefined : <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-muted text-muted-foreground">{r.kind === 'collection' ? CAT_ICONS.menu : CAT_ICONS.listType}</span>}
                            title={r.name}
                            subtitle={r.details}
                            href={r.href}
                            overlay={<CardMenu variant="chip" label={t('menuFor', { name: r.name })} items={menuFor(r)} />}
                          >
                            {r.chips.length ? <Chips items={r.chips} max={3} /> : null}
                            <LifecycleBadge status={r.status.status} changes={r.status.hasChanges} />
                            <GapBadges gaps={r.gaps} />
                          </ContentCard>
                        </CardGridItem>
                      ))}
                    </CardGrid>
                  )}
                </div>
                {/* Phones: cards, top-aligned, the menu as a bottom sheet. */}
                <ul className="flex flex-col gap-3 md:hidden" aria-label={title}>
                  {shown.map((r) => (
                    <li key={r.id} className="flex items-start gap-1 rounded-xl border border-border bg-card py-2 pr-1 pl-3">
                      <Link href={r.href} className="flex min-w-0 flex-1 items-start gap-3 pt-1 pb-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                        {r.showsMedia ? <MediaFrame src={r.thumb} alt="" size={{ width: '4.5rem', height: '4.5rem' }} className="shrink-0 rounded-lg" /> : null}
                        <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
                          <span className="line-clamp-2 text-[0.9375rem] leading-6 font-semibold text-foreground">{r.name}</span>
                          {r.details ? <span className="text-sm leading-5 text-muted-foreground">{r.details}</span> : null}
                          <LifecycleBadge status={r.status.status} changes={r.status.hasChanges} />
                          <GapBadges gaps={r.gaps} />
                        </span>
                      </Link>
                      <CardMenu label={t('menuFor', { name: r.name })} items={menuFor(r)} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

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
