'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { BATCH_MAX, BatchSheet, type BatchMode } from '@/components/client/media/BatchSheet'
import type { CardChange } from '@/components/client/media/PhotoCard'
import { BarButton } from '@/components/app/ui/BarButton'
import type { CardMenuItem } from '@/components/app/ui/CardMenu'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar, type ListDateValue, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { idRange, SelectionBar } from '@/components/app/ui/SelectionBar'
import { Toast } from '@/components/app/ui/Toast'
import { ViewSwitch } from '@/components/app/ui/ViewSwitch'
import { SelectAll } from '@/components/app/ui/list/ContentCard'
import { useUndo } from '@/components/app/ui/use-undo'
import { useViewPreference } from '@/components/app/ui/use-view-preference'
import { deleteFromLibrary, listLibrary, type MediaLibraryScope } from '@/components/client/media/media-api'
import type { MediaLibraryItem } from '@/lib/api/media-library'
import { fillMediaLink, type MediaLinks } from '@/lib/client/media-links'
import {
  activeMediaFilterCount,
  applyMediaFilters,
  DEFAULT_MEDIA_FILTERS,
  isDefaultMediaFilters,
  localeFor,
  mediaName,
  mediaTags,
  nextMediaSort,
  type MediaDescriptionFilter,
  type LocaleOf,
  type MediaFilters,
  type MediaUsageFilter,
} from '@/lib/client/media-filter'
import { MediaGrid, SizeSwitch, THUMB_SIZES, type ThumbSize } from './MediaGrid'
import { MEDIA_ICONS, PhotoSheet } from './MediaPhotoSheet'
import { MediaTable } from './MediaTable'

type Site = { defaultLocale: string; locales: string[] }
type View = 'grid' | 'list'

export type MediaLibraryScreenProps = {
  /**
   * The project shown. null = several projects at once (admin "All
   * projects"): each photo then carries its own project and site languages,
   * "Add photos" is disabled and selecting (tags / rename) is off.
   */
  projectSlug: string | null
  /** The project's languages (with `projectSlug: null`, only a fallback). */
  site: Site
  /** Which server actions read and save: the client's Media Library (default) or the admin's. */
  scope?: MediaLibraryScope
  /** Where "Add photos" and "Used in" go (CLIENT_MEDIA_LINKS / ADMIN_MEDIA_LINKS). */
  links: MediaLinks
  /** Extra filters, first in the toolbar (the admin's project picker). */
  toolbarFilters?: ListToolbarFilter[]
  /** Label photos with their project: the table column header (lists across projects). */
  projectLabel?: string
  /** Shown on the disabled "Add photos" button when no single project is chosen. */
  addDisabledHint?: string
  /** Delete unused photos ("Deleted · Undo") — admin only; the client has no delete yet. */
  remove?: { label: string; deleted: string; undo: string; failed: string }
}

const VIEW_KEY = 'abluo.media.view'
const VIEWS = ['grid', 'list'] as const
const SIZE_KEY = 'abluo.media.thumbSize'
/** Safety stop for the page-by-page load (the server scans at most 1000 photos). */
const MAX_PAGES = 60

/** A change from the card or a batch, onto the screen's copy of the photo. */
function merge(i: MediaLibraryItem, c: CardChange): MediaLibraryItem {
  return {
    ...i,
    ...(c.rev !== undefined && { rev: c.rev }),
    ...(c.name !== undefined && { name: c.name }),
    ...(c.alt && { alt: c.alt }),
    ...(c.caption && { caption: c.caption }),
    ...(c.focal !== undefined && { focal: c.focal }),
    ...(c.tags && { tags: c.tags }),
  }
}

/**
 * The Media screen — built on the shared list pattern (PageShell from the
 * page, PageHeader, ListToolbar, DataTable, SelectionBar, Toast), like Posts
 * and People.
 *
 * The whole library loads page by page (newest first; the first page shows at
 * once) and every filter runs in the browser (media-filter.ts): search over
 * name, file name, description, caption and tags · one tag · used / not used
 * · description missing · the uploaded date. One toolbar for both views.
 *
 * Views (computers, remembered per browser, default Grid): Grid — the photo
 * tiles, Small / Medium / Large, filling the width; List — a sortable table.
 * Phones always show the grid. Click a photo or a row for the photo panel
 * (description, focus point, tags, where it is used).
 *
 * Selecting: the table's checkboxes, or in the grid "Select" / press and
 * hold, then tap. The selection bar offers Add tags · Rename · Clear (≤ 100
 * at a time; the server checks each photo). No delete for clients; the
 * admin (ADR-030) passes `remove` to delete unused photos, and can list every
 * project at once (`projectSlug: null`).
 * The page itself is gated to people who may manage media (page.tsx); every
 * server action re-checks.
 */
export function MediaLibraryScreen({
  projectSlug,
  site,
  scope = 'media',
  links,
  toolbarFilters,
  projectLabel,
  addDisabledHint,
  remove,
}: MediaLibraryScreenProps) {
  const t = useTranslations('clientDashboard.media')
  const tr = useTranslations('app.ui.dateRange')
  const d = site.defaultLocale
  const several = projectSlug === null
  /** A photo's project and languages: its own when the list spans projects. */
  const slugOf = useCallback((i: MediaLibraryItem) => i.project?.slug ?? projectSlug ?? '', [projectSlug])
  const siteOf = useCallback((i: MediaLibraryItem): Site => i.project?.site ?? site, [site])
  const localeOf: LocaleOf<MediaLibraryItem> = useMemo(() => (several ? (i: MediaLibraryItem) => siteOf(i).defaultLocale : d), [several, siteOf, d])

  // ── Library: every page, newest first ──────────────────────────────────────
  const [items, setItems] = useState<MediaLibraryItem[]>([])
  const [state, setState] = useState<'loading' | 'more' | 'ready' | 'error'>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      let cursor: string | null = null
      let acc: MediaLibraryItem[] = []
      try {
        for (let page = 0; page < MAX_PAGES; page++) {
          const r = await listLibrary(scope, { projectSlug, cursor })
          if (cancelled) return
          if (!r.ok) return setState(acc.length ? 'ready' : 'error')
          const seen = new Set(acc.map((i) => i.assetId))
          acc = [...acc, ...r.items.filter((i) => !seen.has(i.assetId))]
          setItems(acc)
          cursor = r.nextCursor
          setState(cursor ? 'more' : 'ready')
          if (!cursor) return
        }
        setState('ready')
      } catch {
        if (!cancelled) setState(acc.length ? 'ready' : 'error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectSlug, scope, reloadKey])

  // ── View + tile size, remembered per browser ───────────────────────────────
  const [view, chooseView] = useViewPreference<View>(VIEW_KEY, VIEWS, 'grid')
  const [size, setSize] = useViewPreference<ThumbSize>(SIZE_KEY, THUMB_SIZES, 'medium')

  // ── Filters ────────────────────────────────────────────────────────────────
  const [filters, setFilters] = useState<MediaFilters>(DEFAULT_MEDIA_FILTERS)
  const update = (patch: Partial<MediaFilters>) => setFilters((f) => ({ ...f, ...patch }))
  const reset = () => setFilters((f) => ({ ...DEFAULT_MEDIA_FILTERS, sort: f.sort }))
  const shown = useMemo(() => applyMediaFilters(items, filters, localeOf), [items, filters, localeOf])
  const tags = useMemo(() => mediaTags(items), [items])
  const isDefault = isDefaultMediaFilters(filters)

  const position = useMemo(() => new Map(items.map((i, n) => [i.assetId, n + 1])), [items])
  const nameOf = useCallback(
    (item: MediaLibraryItem) => mediaName(item, localeFor(localeOf, item)) || t('library.photoN', { n: position.get(item.assetId) ?? 1 }),
    [localeOf, position, t]
  )

  // ── Edit one photo ─────────────────────────────────────────────────────────
  const [openId, setOpenId] = useState<string | null>(null)
  const saving = useRef<Promise<unknown>>(Promise.resolve())
  const onPhotoChange = useCallback((c: CardChange) => setItems((prev) => prev.map((i) => (i.assetId === c.assetId ? merge(i, c) : i))), [])
  const onSaving = useCallback((job: Promise<unknown>) => {
    saving.current = job
  }, [])
  const open = items.find((i) => i.assetId === openId) ?? null
  // Stable, so the panel keeps its focus while more photos load in the background.
  const closeSheet = useCallback(() => setOpenId(null), [])

  // ── Selection (both views) ─────────────────────────────────────────────────
  const { toast, show, schedule } = useUndo()
  /** Selecting (tags / rename) works within one project. */
  const canSelect = !several
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lastPicked, setLastPicked] = useState<string | null>(null)
  const [batch, setBatch] = useState<{ mode: Exclude<BatchMode, 'all'>; ids: string[] } | null>(null)
  const selectedIds = shown.filter((i) => selected.has(i.assetId)).map((i) => i.assetId)
  const allState: 'none' | 'some' | 'all' = selectedIds.length === 0 ? 'none' : selectedIds.length === Math.min(shown.length, BATCH_MAX) ? 'all' : 'some'
  const ticking = selecting || selectedIds.length > 0

  const limit = () => show({ message: t('select.limit', { max: BATCH_MAX }), tone: 'status' })
  /** Tick one photo; with Shift, everything between the last tick and this one gets the same state. */
  const toggle = (id: string, checked: boolean, shift: boolean) => {
    const order = shown.map((i) => i.assetId)
    const ids = shift && lastPicked && lastPicked !== id ? idRange(order, lastPicked, id) : [id]
    const next = new Set(selected)
    let capped = false
    for (const x of ids) {
      if (!checked) next.delete(x)
      else if (next.size < BATCH_MAX) next.add(x)
      else capped = true
    }
    if (capped) limit()
    setSelected(next)
    setLastPicked(id)
  }
  const toggleAll = (checked: boolean) => {
    if (checked && shown.length > BATCH_MAX) limit()
    setSelected(checked ? new Set(shown.slice(0, BATCH_MAX).map((i) => i.assetId)) : new Set())
    setLastPicked(null)
  }
  const startSelecting = (first?: string) => {
    setSelecting(true)
    setSelected(first ? new Set([first]) : new Set())
    setLastPicked(first ?? null)
  }
  const stopSelecting = useCallback(() => {
    setSelecting(false)
    setSelected(new Set())
    setLastPicked(null)
    setBatch(null)
  }, [])
  useEffect(() => {
    if (!ticking || batch || open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && stopSelecting()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [ticking, batch, open, stopSelecting])

  // ── Delete (admin only): the photo goes at once, the server call waits for Undo ──
  const canRemove = (item: MediaLibraryItem) => Boolean(remove) && item.usedIn.length === 0
  const removePhoto = (item: MediaLibraryItem) => {
    if (!remove) return
    setOpenId(null)
    const at = Math.max(0, items.findIndex((i) => i.assetId === item.assetId))
    setItems((prev) => prev.filter((i) => i.assetId !== item.assetId))
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(item.assetId)
      return next
    })
    schedule({
      id: item.assetId,
      message: remove.deleted,
      undoLabel: remove.undo,
      failMessage: remove.failed,
      run: async () => (await deleteFromLibrary(scope, { projectSlug: slugOf(item), assetId: item.assetId })).ok,
      restore: () => setItems((prev) => (prev.some((i) => i.assetId === item.assetId) ? prev : [...prev.slice(0, at), item, ...prev.slice(at)])),
    })
  }

  const menuFor = (item: MediaLibraryItem): CardMenuItem[] => [
    { key: 'edit', label: t('menu.edit'), onSelect: () => setOpenId(item.assetId) },
    ...(canSelect
      ? [
          { key: 'tags', label: t('menu.addTags'), onSelect: () => setBatch({ mode: 'tags', ids: [item.assetId] }) },
          { key: 'rename', label: t('menu.rename'), onSelect: () => setBatch({ mode: 'rename', ids: [item.assetId] }) },
        ]
      : []),
    { key: 'original', label: t('menu.original'), onSelect: () => window.open(item.url, '_blank', 'noopener,noreferrer') },
    ...(remove && canRemove(item) ? [{ key: 'delete', label: remove.label, onSelect: () => removePhoto(item) }] : []),
  ]
  /** Batch photos in the order shown (the numbers of "Rename" follow it). */
  const byId = useMemo(() => new Map(items.map((i) => [i.assetId, i])), [items])
  const batchItems = batch ? batch.ids.map((id) => byId.get(id)).filter((i): i is MediaLibraryItem => Boolean(i)) : []

  // ── Toolbar ────────────────────────────────────────────────────────────────
  const selects: ListToolbarFilter[] = [...(toolbarFilters ?? [])]
  if (tags.length || filters.tag) {
    selects.push({
      key: 'tag',
      label: t('filters.tag'),
      value: filters.tag,
      options: [{ value: '', label: t('filters.tagAll') }, ...[...new Set([...(filters.tag ? [filters.tag] : []), ...tags])].map((tag) => ({ value: tag, label: tag }))],
      onChange: (tag) => update({ tag }),
    })
  }
  selects.push(
    {
      key: 'usage',
      label: t('filters.usage'),
      value: filters.usage,
      options: (['all', 'used', 'unused'] as const).map((v) => ({ value: v, label: t(`filters.usage_${v}`) })),
      onChange: (v) => update({ usage: v as MediaUsageFilter }),
    },
    {
      key: 'description',
      label: t('filters.description'),
      value: filters.description,
      options: (['all', 'missing'] as const).map((v) => ({ value: v, label: t(`filters.description_${v}`) })),
      onChange: (v) => update({ description: v as MediaDescriptionFilter }),
    }
  )
  const dateValue: ListDateValue = { field: 'uploaded', preset: filters.from || filters.range === 'all' ? null : filters.range, from: filters.from, to: filters.to }
  const onDate = (v: ListDateValue) =>
    update(v.from ? { from: v.from, to: v.to, range: 'all' } : { from: null, to: null, range: v.preset ?? 'all' })
  const chips: FilterChip[] = []
  if (filters.tag) chips.push({ id: 'tag', label: filters.tag })
  if (filters.usage !== 'all') chips.push({ id: 'usage', label: t(`filters.usage_${filters.usage}`) })
  if (filters.description !== 'all') chips.push({ id: 'description', label: t(`filters.description_${filters.description}`) })
  if (filters.from) chips.push({ id: 'date', label: t('filters.dateChip', { range: `${filters.from} – ${filters.to || filters.from}` }) })
  else if (filters.range !== 'all') chips.push({ id: 'date', label: t('filters.dateChip', { range: tr(`inline.${filters.range}`) }) })
  const removeChip = (id: string) =>
    update(
      id === 'tag'
        ? { tag: '' }
        : id === 'usage'
          ? { usage: 'all' }
          : id === 'description'
            ? { description: 'all' }
            : { range: 'all', from: null, to: null }
    )

  const summary =
    state === 'loading'
      ? t('library.loading')
      : `${t('filters.showing', { shown: shown.length, total: items.length })}${state === 'more' ? ` · ${t('filters.loadingMore')}` : ''}`

  const addHref = fillMediaLink(links.add, { project: projectSlug })

  /** Grid controls on line C: tile size, and Select / Select all. */
  const gridExtra = (
    <span className={`items-center gap-3 ${view === 'grid' ? 'flex' : 'flex md:hidden'}`}>
      <SizeSwitch
        className="flex"
        value={size}
        onChange={setSize}
        label={t('size.label')}
        names={{ small: t('size.small'), medium: t('size.medium'), large: t('size.large') }}
      />
      {shown.length > 0 && canSelect ? (
        ticking ? (
          <SelectAll label={t('select.all')} ariaLabel={t('columns.selectAll')} state={allState} onChange={toggleAll} />
        ) : (
          <button
            type="button"
            onClick={() => startSelecting()}
            className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-border bg-background px-4 text-[0.9375rem] font-medium text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t('select.start')}
          </button>
        )
      ) : null}
    </span>
  )

  const grid = (
    <MediaGrid
      items={shown}
      defaultLocale={localeOf}
      size={size}
      onSize={setSize}
      selecting={ticking}
      selected={selected}
      nameOf={nameOf}
      onOpen={(i) => setOpenId(i.assetId)}
      onToggle={toggle}
      onStartSelecting={canSelect ? startSelecting : () => undefined}
      showProject={several}
    />
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('title')}
        actions={
          <>
            <ViewSwitch
              label={t('view.label')}
              value={view}
              onChange={chooseView}
              options={[
                { value: 'grid', label: t('view.grid'), icon: MEDIA_ICONS.grid },
                { value: 'list', label: t('view.list'), icon: MEDIA_ICONS.list },
              ]}
            />
            {addHref ? (
              <Link
                href={addHref}
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-action px-4 text-[0.9375rem] font-semibold text-action-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                {MEDIA_ICONS.plus}
                {t('addTitle')}
              </Link>
            ) : links.add ? (
              <button
                type="button"
                disabled
                title={addDisabledHint}
                className="inline-flex h-11 shrink-0 cursor-not-allowed items-center gap-2 rounded-xl bg-action px-4 text-[0.9375rem] font-semibold text-action-foreground opacity-50"
              >
                {MEDIA_ICONS.plus}
                {t('addTitle')}
                {addDisabledHint ? <span className="sr-only">{` · ${addDisabledHint}`}</span> : null}
              </button>
            ) : null}
          </>
        }
      />

      <ListToolbar
        label={t('filters.filters')}
        search={{ value: filters.q, onChange: (q) => update({ q }), label: t('filters.search'), placeholder: t('filters.searchPlaceholder') }}
        filters={selects}
        date={{
          noun: t('filters.noun'),
          label: t('filters.date'),
          fieldLabel: t('filters.dateField'),
          fields: [{ value: 'uploaded', label: t('filters.uploaded') }],
          value: dateValue,
          onChange: onDate,
        }}
        summary={summary}
        summaryExtra={items.length ? gridExtra : null}
        clear={{ label: t('filters.clear'), onClear: reset, visible: !isDefault }}
        sheet={{ activeCount: activeMediaFilterCount(filters), resultCount: shown.length, chips, onRemoveChip: removeChip }}
      />

      {state === 'error' ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-10">
          <p className="font-medium text-foreground">{t('library.error')}</p>
          <button
            type="button"
            onClick={() => {
              setState('loading')
              setReloadKey((k) => k + 1)
            }}
            className="mt-3 inline-flex h-11 items-center rounded-xl border border-border px-4 text-sm font-medium text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t('library.retry')}
          </button>
        </div>
      ) : state !== 'loading' && shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-10">
          <p className="font-medium text-foreground">{items.length ? t('filters.noMatch') : t('library.empty')}</p>
          {items.length && !isDefault ? (
            <button
              type="button"
              onClick={reset}
              className="mt-3 inline-flex h-11 items-center rounded-xl border border-border px-4 text-sm font-medium text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t('filters.clear')}
            </button>
          ) : null}
        </div>
      ) : view === 'grid' ? (
        grid
      ) : (
        <>
          {/* Computers */}
          <div className="hidden md:block">
            <MediaTable
              items={shown}
              defaultLocale={localeOf}
              nameOf={nameOf}
              selected={selected}
              onToggle={toggle}
              allState={allState}
              onToggleAll={toggleAll}
              sort={filters.sort}
              onSort={(c) => update({ sort: nextMediaSort(c, filters.sort) })}
              onOpen={(i) => setOpenId(i.assetId)}
              menuFor={menuFor}
              selectable={canSelect}
              projectColumn={several ? projectLabel : undefined}
            />
          </div>
          {/* Phones: always the grid */}
          <div className="md:hidden">{grid}</div>
        </>
      )}

      {ticking ? (
        <SelectionBar label={t('select.toolbar')} count={t('select.count', { count: selectedIds.length })}>
          <BarButton disabled={!selectedIds.length} onPress={() => setBatch({ mode: 'tags', ids: selectedIds })} icon={MEDIA_ICONS.tag}>
            {t('select.addTags')}
          </BarButton>
          <BarButton disabled={!selectedIds.length} onPress={() => setBatch({ mode: 'rename', ids: selectedIds })} icon={MEDIA_ICONS.rename}>
            {t('select.rename')}
          </BarButton>
          <BarButton onPress={stopSelecting} icon={MEDIA_ICONS.x}>
            {t('select.clear')}
          </BarButton>
        </SelectionBar>
      ) : null}

      {batch && batchItems.length && projectSlug !== null ? (
        <BatchSheet
          projectSlug={projectSlug}
          scope={scope}
          mode={batch.mode}
          assetIds={batchItems.map((i) => i.assetId)}
          thumbs={batchItems.map((i) => i.thumbUrl)}
          tagSuggestions={tags}
          onClose={() => setBatch(null)}
          onDone={(changes, skipped) => {
            const by = new Map(changes.map((c) => [c.assetId, c]))
            setItems((prev) => prev.map((i) => (by.has(i.assetId) ? merge(i, by.get(i.assetId)!) : i)))
            stopSelecting()
            show(
              {
                message: skipped
                  ? `${t('select.saved', { count: changes.length })} · ${t('select.skipped', { count: skipped })}`
                  : t('select.saved', { count: changes.length }),
                tone: 'status',
              },
              4000
            )
          }}
        />
      ) : null}

      {open ? (
        <PhotoSheet
          projectSlug={slugOf(open)}
          scope={scope}
          links={links}
          site={siteOf(open)}
          item={open}
          tagSuggestions={several ? mediaTags(items.filter((i) => slugOf(i) === slugOf(open))) : tags}
          onChange={onPhotoChange}
          onSaving={onSaving}
          onClose={closeSheet}
          remove={remove && canRemove(open) ? { label: remove.label, onPress: () => removePhoto(open) } : null}
        />
      ) : null}

      <Toast message={toast?.message ?? null} tone={toast?.tone} action={toast?.undo ? remove?.undo : undefined} onAction={toast?.undo} />
    </div>
  )
}
