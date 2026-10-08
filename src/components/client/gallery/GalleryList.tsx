'use client'

import { useMemo, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from 'next/navigation'
import { getPathname, Link, useRouter as useAppRouter } from '@/i18n/navigation'
import type { GalleryListItem } from '@/lib/api/gallery-drafts'
import type { GalleryStatus } from '@/lib/api/gallery-status'
import { batchGalleriesAction } from '@/app/[locale]/(client)/[tenant]/galleries/actions'
import { mintGalleryPreviewAction } from '@/app/[locale]/(client)/[tenant]/galleries/preview-actions'
import { draftPreviewUrl } from '@/lib/client/preview-url'
import {
  activeGalleryFilterCount,
  applyGalleryFilters,
  DEFAULT_GALLERY_FILTERS,
  galleryFiltersToParams,
  galleryState,
  galleryStateCounts,
  isDefaultGalleryFilters,
  nextGallerySort,
  parseGalleryFilters,
  type GalleryFilters,
  type GallerySortColumn,
} from '@/lib/client/galleries-filter'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { PHOTO_CARD_MAX, TagEditor } from '@/components/client/media/PhotoCard'
import { BarButton } from '@/components/app/ui/BarButton'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import type { CardMenuItem } from '@/components/app/ui/CardMenu'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { idRange, SelectionBar } from '@/components/app/ui/SelectionBar'
import { SelectAll } from '@/components/app/ui/list/ContentCard'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { useViewPreference } from '@/components/app/ui/use-view-preference'
import { ViewSwitch } from '@/components/app/ui/ViewSwitch'
import { GalleriesFilters } from './GalleriesFilters'
import { GalleriesTable } from './GalleriesTable'
import { GalleryCardsGrid, GalleryPhoneList } from './GalleryCards'
import { GALLERY_ICONS, useGalleryPlaces, type GalleryRow } from './gallery-bits'
import { EmptyState } from '@/components/app/ui/EmptyState'

const BATCH_MAX = 100
const VIEW_KEY = 'abluo.galleries.view'
const VIEWS = ['grid', 'list'] as const
type View = (typeof VIEWS)[number]

/**
 * The Galleries list — the Posts pattern for galleries. Rendered inside the
 * page's PageShell.
 *
 * Computers (md+): a grid of cards by default (each with a ThumbStrip of its
 * photos, the main image leading) or a table (Grid / List switch, remembered
 * per browser). Phones: cards with a checkbox on the left. Filters run in the
 * browser on the loaded list (galleries-filter.ts) and live in the URL.
 *
 * Selecting is through the checkboxes (shift-click selects a range); the
 * floating bar has Add tags, Delete (owners: canDelete) and Clear. Delete only
 * removes galleries not used anywhere; the others are reported as skipped. The
 * server checks every gallery on its own (≤ 100 at a time). Without
 * gallery.gallery.write the list is read-only: no checkboxes, menus or links.
 */
export function GalleryList({
  projectSlug,
  galleries,
  statuses,
  canWrite,
  canDelete = false,
  initialQuery = '',
}: {
  projectSlug: string
  galleries: GalleryListItem[]
  /** Where each gallery is used and what needs attention, by gallery id. */
  statuses: Record<string, GalleryStatus>
  canWrite: boolean
  /** Owner with gallery delete (the server re-checks). */
  canDelete?: boolean
  /** The page's query string at request time. */
  initialQuery?: string
}) {
  const t = useTranslations('clientDashboard.gallery.list')
  const ts = useTranslations('clientDashboard.gallery.select')
  const ui = useLocale()
  const router = useRouter()
  const appRouter = useAppRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()
  const placesOf = useGalleryPlaces()

  const [view, chooseView] = useViewPreference<View>(VIEW_KEY, VIEWS, 'grid')

  // ── Filters (in the URL) ───────────────────────────────────────────────────
  const [filters, setFilters] = useState<GalleryFilters>(() => parseGalleryFilters(new URLSearchParams(initialQuery)))
  const update = (patch: Partial<GalleryFilters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    const qs = galleryFiltersToParams(next).toString()
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }
  const reset = () => update({ ...DEFAULT_GALLERY_FILTERS, sort: filters.sort })

  // ── Rows ───────────────────────────────────────────────────────────────────
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [localTags, setLocalTags] = useState<Record<string, string[]>>({})
  const rows: GalleryRow[] = useMemo(
    () =>
      galleries
        .filter((g) => !hidden.has(g.id))
        .map((g) => {
          const places = placesOf(g, statuses[g.id])
          return {
            id: g.id,
            title: g.title || g.internalName || t('untitled'),
            internalName: g.internalName,
            tags: localTags[g.id] ?? g.tags,
            state: galleryState(g),
            used: places.length > 0,
            count: g.count,
            updatedAt: g.updatedAt,
            createdAt: g.createdAt,
            thumbs: g.thumbs.length ? g.thumbs : g.coverThumb ? [g.coverThumb] : [],
            places,
            // The gallery's page needs write permission (it is where it is edited).
            href: canWrite ? `/${projectSlug}/galleries/${g.id}` : null,
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- placesOf/t are stable per locale
    [galleries, hidden, localTags, statuses, canWrite, projectSlug]
  )
  const shown = useMemo(() => applyGalleryFilters(rows, filters), [rows, filters])
  const counts = useMemo(() => galleryStateCounts(rows, filters), [rows, filters])
  const allTags = useMemo(() => [...new Set(rows.flatMap((g) => g.tags))].sort(), [rows])
  const byId = useMemo(() => new Map(rows.map((g) => [g.id, g])), [rows])
  const isDefault = isDefaultGalleryFilters(filters)

  // ── Selection ──────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lastPicked, setLastPicked] = useState<string | null>(null)
  const selectedIds = shown.filter((g) => selected.has(g.id)).map((g) => g.id)
  const allState: 'none' | 'some' | 'all' = selectedIds.length === 0 ? 'none' : selectedIds.length === shown.length ? 'all' : 'some'
  const toggle = (id: string, checked: boolean, shift: boolean) => {
    const order = shown.map((g) => g.id)
    setSelected((s) => {
      const n = new Set(s)
      const ids = shift && lastPicked && lastPicked !== id ? idRange(order, lastPicked, id) : [id]
      for (const x of ids) {
        if (checked) n.add(x)
        else n.delete(x)
      }
      return new Set([...n].slice(0, BATCH_MAX))
    })
    setLastPicked(id)
  }
  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(shown.slice(0, BATCH_MAX).map((g) => g.id)) : new Set())
    setLastPicked(null)
  }
  const clearSelection = () => {
    setSelected(new Set())
    setLastPicked(null)
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null)
  const [tagSheet, setTagSheet] = useState<string[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const { toast, show } = useUndo()

  const preview = async (g: GalleryRow) => {
    const tab = window.open('about:blank', '_blank')
    if (tab) tab.opener = null
    try {
      const r = await mintGalleryPreviewAction({ projectSlug, id: g.id })
      if (!r.ok) throw new Error(r.error)
      const url = draftPreviewUrl({ origin: r.origin, locale: ui, projectSlug: r.projectSlug, id: g.id, token: r.token, kind: 'gallery' })
      if (tab) tab.location.href = url
      else window.location.assign(url)
    } catch {
      tab?.close()
      show({ message: t('card.previewFailed'), tone: 'error' })
    }
  }

  async function runBatch(op: 'delete' | 'tags', ids: string[], addTags?: string[]) {
    if (!ids.length || busy) return false
    setBusy(true)
    try {
      const r = await batchGalleriesAction({ projectSlug, ids: ids.slice(0, BATCH_MAX), op, addTags })
      if (!r.ok) {
        show({ message: ts('failed'), tone: 'error' }, 7000)
        return false
      }
      const ok = r.results.filter((x) => x.ok).map((x) => x.id)
      const skipped = r.results.filter((x) => !x.ok && x.code === 'in_use').length
      const failed = r.results.filter((x) => !x.ok && x.code !== 'in_use').length
      const parts = [
        ok.length ? ts(op === 'delete' ? 'done.delete' : 'done.tags', { count: ok.length }) : '',
        skipped ? ts('skippedInUse', { count: skipped }) : '',
        failed ? ts('someFailed', { count: failed }) : '',
      ].filter(Boolean)
      show({ message: parts.join(' '), tone: ok.length === 0 ? 'error' : 'status' }, 8000)
      if (op === 'delete') setHidden((h) => new Set([...h, ...ok]))
      else if (addTags) {
        setLocalTags((l) => {
          const n = { ...l }
          for (const id of ok) {
            const g = byId.get(id)
            if (g) n[id] = [...new Set([...g.tags, ...addTags])].slice(0, PHOTO_CARD_MAX.tags)
          }
          return n
        })
      }
      appRouter.refresh()
      return failed + skipped === 0
    } catch {
      show({ message: ts('failed'), tone: 'error' }, 7000)
      return false
    } finally {
      setBusy(false)
    }
  }

  const open = (g: GalleryRow, newTab: boolean) => {
    if (!g.href) return
    if (newTab) window.open(getPathname({ href: g.href, locale: ui }), '_blank', 'noopener')
    else appRouter.push(g.href)
  }

  const menuFor = (g: GalleryRow): CardMenuItem[] => [
    { key: 'open', label: t('card.open'), onSelect: () => appRouter.push(`/${projectSlug}/galleries/${g.id}`) },
    { key: 'edit', label: t('card.edit'), onSelect: () => appRouter.push(`/${projectSlug}/galleries/${g.id}/edit`) },
    { key: 'preview', label: t('card.preview'), onSelect: () => void preview(g) },
    ...(canDelete && !g.used ? [{ key: 'delete', label: t('card.delete'), onSelect: () => setConfirmDelete([g.id]), destructive: true }] : []),
  ]

  const none = !selectedIds.length || busy
  const header = (
    <PageHeader
      title={t('title')}
      actions={
        <>
          {galleries.length > 0 ? (
            <ViewSwitch
              label={t('view.label')}
              value={view}
              onChange={chooseView}
              options={[
                { value: 'grid', label: t('view.grid'), icon: GALLERY_ICONS.grid },
                { value: 'list', label: t('view.list'), icon: GALLERY_ICONS.list },
              ]}
            />
          ) : null}
          {canWrite ? (
            <Link
              href={`/${projectSlug}/galleries/new`}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-action px-4 text-[0.9375rem] font-semibold text-action-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              {GALLERY_ICONS.plus}
              {t('new')}
            </Link>
          ) : null}
        </>
      }
    />
  )

  if (galleries.length === 0) {
    return (
      <div className="space-y-4">
        {header}
        <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {header}

      <GalleriesFilters
        filters={filters}
        update={update}
        reset={reset}
        isDefault={isDefault}
        tags={allTags}
        counts={counts}
        resultCount={shown.length}
        total={rows.length}
        activeCount={activeGalleryFilterCount(filters)}
        showSortOnDesktop={view === 'grid'}
        summaryExtra={
          view === 'grid' && canWrite && shown.length > 0 ? (
            <span className="hidden md:inline-flex">
              <SelectAll label={ts('selectAll')} ariaLabel={t('columns.selectAll')} state={allState} onChange={toggleAll} />
            </span>
          ) : null
        }
      />

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-10">
          <p className="font-medium text-foreground">{t('filters.noMatch')}</p>
          <button
            type="button"
            onClick={reset}
            className="mt-3 inline-flex h-11 items-center rounded-xl border border-border px-4 text-sm font-medium text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t('filters.clear')}
          </button>
        </div>
      ) : (
        <>
          {/* Computers */}
          <div className="hidden md:block">
            {view === 'list' ? (
              <GalleriesTable
                rows={shown}
                canWrite={canWrite}
                selected={selected}
                onToggle={toggle}
                allState={allState}
                onToggleAll={toggleAll}
                sort={filters.sort}
                onSort={(column: GallerySortColumn) => update({ sort: nextGallerySort(column, filters.sort) })}
                onOpen={open}
                menuFor={menuFor}
              />
            ) : (
              <GalleryCardsGrid rows={shown} canWrite={canWrite} selected={selected} onToggle={toggle} onOpen={open} menuFor={menuFor} />
            )}
          </div>
          {/* Phones */}
          <div className="md:hidden">
            <GalleryPhoneList rows={shown} canWrite={canWrite} selected={selected} onToggle={toggle} onOpen={open} menuFor={menuFor} />
          </div>
        </>
      )}

      {canWrite && selectedIds.length > 0 ? (
        <SelectionBar label={ts('toolbar')} count={ts('count', { count: selectedIds.length })}>
          <BarButton
            disabled={none}
            onPress={() => {
              setPicked([])
              setTagSheet(selectedIds)
            }}
            icon={GALLERY_ICONS.tag}
          >
            {ts('bar.addTags')}
          </BarButton>
          {canDelete ? (
            <BarButton disabled={none} onPress={() => setConfirmDelete(selectedIds)} icon={GALLERY_ICONS.trash} destructive>
              {ts('bar.delete')}
            </BarButton>
          ) : null}
          <BarButton onPress={clearSelection} icon={GALLERY_ICONS.x}>
            {ts('bar.clear')}
          </BarButton>
        </SelectionBar>
      ) : null}

      <BottomSheet open={tagSheet !== null} title={ts('tagsSheet.title')} onClose={() => setTagSheet(null)}>
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{ts('tagsSheet.helper')}</p>
        <div className="mt-4">
          <TagEditor
            id="gallery-batch-tags"
            tags={picked}
            suggestions={allTags}
            labels={{
              label: t('tags.label'),
              helper: t('tags.helper'),
              placeholder: t('tags.placeholder'),
              add: t('tags.add'),
              remove: (x) => t('tags.remove', { tag: x }),
              suggested: t('tags.suggested'),
              full: t('tags.full', { max: PHOTO_CARD_MAX.tags }),
            }}
            onChange={setPicked}
          />
        </div>
        <button
          type="button"
          disabled={!picked.length || busy}
          onClick={async () => {
            const ids = tagSheet ?? []
            const ok = await runBatch('tags', ids, picked)
            setTagSheet(null)
            if (ok) clearSelection()
          }}
          className="mt-4 inline-flex h-12 items-center justify-center rounded-xl bg-action px-5 text-[0.9375rem] font-semibold text-action-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40"
        >
          {ts('tagsSheet.save')}
        </button>
      </BottomSheet>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={ts('confirm.title', { count: confirmDelete?.length ?? 0 })}
        body={ts('confirm.body', { count: confirmDelete?.length ?? 0, title: confirmDelete?.length === 1 ? (byId.get(confirmDelete[0])?.title ?? '') : '' })}
        confirmLabel={ts('confirm.confirm')}
        busy={busy}
        onConfirm={async () => {
          const ids = confirmDelete ?? []
          await runBatch('delete', ids)
          setConfirmDelete(null)
          clearSelection()
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </div>
  )
}
