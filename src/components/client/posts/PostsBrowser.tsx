'use client'

import { useMemo, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from 'next/navigation'
import { getPathname, useRouter as useAppRouter } from '@/i18n/navigation'
import { batchPostsAction, setPostFeaturedAction } from '@/app/[locale]/(client)/[tenant]/posts/lifecycle-actions'
import { mintDraftPreviewAction } from '@/app/[locale]/(client)/[tenant]/posts/preview-actions'
import { draftPreviewUrl } from '@/lib/client/preview-url'
import { ConfirmDialog } from '@/components/client/create/ConfirmDialog'
import type { CardMenuItem } from '@/components/client/ui/CardMenu'
import { BottomSheet } from '@/components/client/ui/BottomSheet'
import { idRange, SelectionBar } from '@/components/client/ui/SelectionBar'
import { PageHeader } from '@/components/client/ui/PageHeader'
import { ViewSwitch } from '@/components/client/ui/ViewSwitch'
import { SelectAll } from '@/components/client/ui/list/ContentCard'
import { Toast } from '@/components/client/ui/Toast'
import { useUndo } from '@/components/client/ui/use-undo'
import { useViewPreference } from '@/components/client/ui/use-view-preference'
import {
  activeFilterCount,
  applyFilters,
  DEFAULT_FILTERS,
  filtersToParams,
  isDefaultFilters,
  nextSort,
  parseFilters,
  statusCounts,
  type PostFilters,
  type SortColumn,
} from '@/lib/client/posts-filter'
import { ICONS, NewPostLink, StarGlyph } from './post-bits'
import { PostsFilters } from './PostsFilters'
import { PostsTable } from './PostsTable'
import { PostCardsGrid, PostPhoneList } from './PostCards'
import { BarButton, CategorySheet, EndDateSheet, SheetItem } from './PostSheets'
import type { BrowserPost } from './types'

export type { BrowserPost } from './types'

type BatchOp = 'offline' | 'online' | 'delete' | 'endDate' | 'categories' | 'featured'
type BatchExtra = { expiresAt?: string | null; categories?: string[]; featured?: boolean }
type Sheet = null | { kind: 'endDate'; ids: string[] } | { kind: 'categories'; ids: string[] } | { kind: 'more' }
type View = 'list' | 'cards'

const VIEW_KEY = 'abluo.posts.view'
const VIEWS = ['list', 'cards'] as const

/**
 * The Posts list — the reference pattern for every client list page.
 *
 * Computers (md+): a table by default (select · image · title · categories ·
 * status · featured · languages · updated · published · ends · ⋯) with sortable
 * headers, or a cards grid (List / Cards switch, remembered per browser).
 * Phones: cards with a square checkbox on the left. Filters run in the browser
 * on the loaded list (posts-filter.ts) and live in the URL.
 *
 * Selecting is only ever through the checkboxes (shift-click selects a range).
 * As soon as one post is selected the selection bar floats up: on computers
 * Take offline, Set end date, Featured, Not featured, Change category, Delete,
 * Clear; on phones the main three plus "More". Batch actions run per post on
 * the server (runPostBatch) and end in one toast. The featured star in the
 * table / desktop cards opens a small confirm popover; on phone cards it is
 * display-only.
 */
export function PostsBrowser({
  title,
  posts,
  languages,
  categories,
  initialQuery,
  projectSlug,
  canEdit = false,
  canDeleteLive = false,
}: {
  title: string
  /** The page's query string at request time (server-provided, no Suspense needed). */
  initialQuery: string
  posts: BrowserPost[]
  /** Site languages (two or more), or empty on single-language sites. */
  languages: string[]
  categories: { value: string; label: string }[]
  projectSlug?: string
  /** blog.post.write: menus, selection, featured and batch actions. */
  canEdit?: boolean
  /** Owner with blog.post.delete: may delete live posts (the server re-checks). */
  canDeleteLive?: boolean
}) {
  const t = useTranslations('clientDashboard.posts')
  const tc = useTranslations('clientDashboard.posts.card')
  const router = useRouter()
  const appRouter = useAppRouter()
  const pathname = usePathname()
  const locale = useLocale()
  const [, startTransition] = useTransition()

  // ── View (List / Cards), remembered per browser ────────────────────────────
  const [view, chooseView] = useViewPreference<View>(VIEW_KEY, VIEWS, 'list')

  // ── Filters (in the URL) ───────────────────────────────────────────────────
  const [filters, setFilters] = useState<PostFilters>(() => parseFilters(new URLSearchParams(initialQuery)))
  const update = (patch: Partial<PostFilters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    const qs = filtersToParams(next).toString()
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }
  const reset = () => update({ ...DEFAULT_FILTERS, sort: filters.sort })

  // Optimistic featured flags until the refreshed list arrives (then dropped).
  const [featuredNow, setFeaturedNow] = useState<Map<string, boolean>>(new Map())
  const [seenPosts, setSeenPosts] = useState(posts)
  if (seenPosts !== posts) {
    setSeenPosts(posts)
    setFeaturedNow(new Map())
  }
  const rows = useMemo(
    () => posts.map((p) => (featuredNow.has(p._id) ? { ...p, featured: featuredNow.get(p._id)! } : p)),
    [posts, featuredNow]
  )
  const visible = useMemo(() => applyFilters(rows, filters), [rows, filters])
  const counts = useMemo(() => statusCounts(rows, filters), [rows, filters])
  const active = activeFilterCount(filters)
  const isDefault = isDefaultFilters(filters)
  const usedCategories = categories.filter((c) => posts.some((p) => p.categoryKeys.includes(c.value)))
  const multilingual = languages.length > 1

  // ── Selection ──────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lastPicked, setLastPicked] = useState<string | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const shown = visible.filter((p) => !hidden.has(p._id))
  const selectedIds = shown.filter((p) => selected.has(p._id)).map((p) => p._id)
  const allState: 'none' | 'some' | 'all' =
    selectedIds.length === 0 ? 'none' : selectedIds.length === shown.length ? 'all' : 'some'

  /** Tick one post; with Shift, everything between the last tick and this one gets the same state. */
  const toggle = (id: string, checked: boolean, shift: boolean) => {
    const order = shown.map((p) => p._id)
    setSelected((s) => {
      const n = new Set(s)
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
    setSelected(checked ? new Set(shown.map((p) => p._id)) : new Set())
    setLastPicked(null)
  }
  const clearSelection = () => {
    setSelected(new Set())
    setLastPicked(null)
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  const [sheet, setSheet] = useState<Sheet>(null)
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const { toast, show, schedule } = useUndo()
  const byId = useMemo(() => new Map(rows.map((p) => [p._id, p])), [rows])
  const titleOf = (id: string) => byId.get(id)?.title ?? id

  async function runBatch(op: BatchOp, ids: string[], extra: BatchExtra = {}) {
    if (!projectSlug || !ids.length || busy) return false
    setBusy(true)
    try {
      const r = await batchPostsAction({ projectSlug, ids: ids.slice(0, 100), op, ...extra })
      if (!r.ok) {
        show({ message: tc('batch.failedAll'), tone: 'error' })
        return false
      }
      const ok = r.results.filter((x) => x.ok)
      const failed = r.results.filter((x) => !x.ok).map((x) => titleOf(x.id))
      if (op === 'featured' && ok.length) {
        setFeaturedNow((m) => {
          const n = new Map(m)
          ok.forEach((x) => n.set(x.id, extra.featured === true))
          return n
        })
      }
      const done = ok.length ? tc(`batch.done.${op}`, { count: ok.length }) : ''
      const fail = failed.length ? tc('batch.someFailed', { count: failed.length, titles: failed.slice(0, 3).join(', ') }) : ''
      show({ message: [done, fail].filter(Boolean).join(' '), tone: failed.length && !ok.length ? 'error' : 'status' }, 7000)
      if (ok.length) appRouter.refresh()
      return failed.length === 0
    } catch {
      show({ message: tc('batch.failedAll'), tone: 'error' })
      return false
    } finally {
      setBusy(false)
    }
  }

  /** One post's star, after the popover's confirm button. */
  const setFeatured = async (post: BrowserPost, next: boolean): Promise<boolean> => {
    if (!projectSlug) return false
    try {
      const r = await setPostFeaturedAction({ projectSlug, id: post._id, featured: next })
      if (!r.ok) throw new Error(r.error)
      setFeaturedNow((m) => new Map(m).set(post._id, next))
      show({ message: next ? t('featured.marked') : t('featured.removed'), tone: 'status' })
      appRouter.refresh()
      return true
    } catch {
      show({ message: tc('batch.failedAll'), tone: 'error' })
      return false
    }
  }

  /** Delete: drafts go behind "Deleted · Undo"; anything live asks first. */
  const askDelete = (ids: string[]) => {
    if (ids.some((id) => byId.get(id)?.hasLive)) return setConfirmDelete(ids)
    setHidden((h) => new Set([...h, ...ids]))
    clearSelection()
    schedule({
      id: ids.join(','),
      message: tc('deleted', { count: ids.length }),
      undoLabel: tc('undo'),
      failMessage: tc('batch.failedAll'),
      restore: () =>
        setHidden((h) => {
          const n = new Set(h)
          ids.forEach((id) => n.delete(id))
          return n
        }),
      run: async () => {
        const r = await batchPostsAction({ projectSlug: projectSlug ?? '', ids, op: 'delete' })
        if (r.ok) appRouter.refresh()
        return r.ok && r.results.every((x) => x.ok)
      },
    })
  }

  const preview = async (post: BrowserPost) => {
    if (!projectSlug) return
    const tab = window.open('about:blank', '_blank')
    if (tab) tab.opener = null
    try {
      const r = await mintDraftPreviewAction({ projectSlug, id: post._id })
      if (!r.ok) throw new Error(r.error)
      const url = draftPreviewUrl({ origin: r.origin, locale: post.previewLocale || 'en', projectSlug: r.projectSlug, id: post._id, token: r.token })
      if (tab) tab.location.href = url
      else window.location.assign(url)
    } catch {
      tab?.close()
      show({ message: tc('previewFailed'), tone: 'error' })
    }
  }

  const open = (post: BrowserPost, newTab: boolean) => {
    if (!post.href) return
    if (newTab) window.open(getPathname({ href: post.href, locale }), '_blank', 'noopener')
    else appRouter.push(post.href)
  }

  const menuFor = (post: BrowserPost): CardMenuItem[] => {
    const items: CardMenuItem[] = []
    if (post.href) items.push({ key: 'edit', label: tc('edit'), onSelect: () => appRouter.push(post.href!) })
    if (post.hasDraft) items.push({ key: 'preview', label: tc('preview'), onSelect: () => void preview(post) })
    if (post.liveUrl) items.push({ key: 'view', label: tc('view'), onSelect: () => window.open(post.liveUrl!, '_blank', 'noopener,noreferrer') })
    items.push({
      key: 'featured',
      label: post.featured ? t('featured.remove') : t('featured.mark'),
      onSelect: () => void setFeatured(post, !post.featured),
    })
    if (post.hasLive && post.status === 'offline') items.push({ key: 'online', label: tc('online'), onSelect: () => void runBatch('online', [post._id]) })
    if (post.hasLive && post.status !== 'offline') items.push({ key: 'offline', label: tc('offline'), onSelect: () => void runBatch('offline', [post._id]) })
    if (post.hasLive) items.push({ key: 'endDate', label: tc('endDate'), onSelect: () => setSheet({ kind: 'endDate', ids: [post._id] }) })
    if (!post.hasLive || canDeleteLive) items.push({ key: 'delete', label: tc('delete'), onSelect: () => askDelete([post._id]), destructive: true })
    return items
  }

  const onSort = (column: SortColumn) => update({ sort: nextSort(column, filters.sort) })
  const selectedPosts = selectedIds.map((id) => byId.get(id)).filter((p): p is BrowserPost => Boolean(p))
  const liveSelected = selectedPosts.filter((p) => p.hasLive)
  /** Every selected live post is offline: offer "Put back online" in the bar instead. */
  const allOffline = liveSelected.length > 0 && liveSelected.every((p) => p.status === 'offline')
  const none = !selectedIds.length || busy
  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        actions={
          <>
            <ViewSwitch
              label={t('view.label')}
              value={view}
              onChange={chooseView}
              options={[
                { value: 'list', label: t('view.list'), icon: ICONS.list },
                { value: 'cards', label: t('view.cards'), icon: ICONS.cards },
              ]}
            />
            {canEdit && projectSlug ? <NewPostLink href={`/${projectSlug}/posts/write/new`} label={t('newPost')} /> : null}
          </>
        }
      />

      <PostsFilters
        filters={filters}
        update={update}
        reset={reset}
        isDefault={isDefault}
        categories={usedCategories}
        multilingual={multilingual}
        counts={counts}
        resultCount={shown.length}
        total={posts.length}
        activeCount={active}
        showSortOnDesktop={view === 'cards'}
        summaryExtra={
          view === 'cards' && canEdit && shown.length > 0 ? (
            <span className="hidden md:inline-flex">
              <SelectAll label={t('select.all')} ariaLabel={t('columns.selectAll')} state={allState} onChange={toggleAll} />
            </span>
          ) : null
        }
      />

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-10">
          <p className="font-medium text-foreground">{t('filters.noMatch')}</p>
          {/* On the page-load filters ("updated, last 7 days") clearing changes nothing: widen to any date instead. */}
          <button
            type="button"
            onClick={isDefault ? () => update({ range: 'all' }) : reset}
            className="mt-3 inline-flex h-11 items-center rounded-xl border border-border px-4 text-sm font-medium text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {isDefault ? t('filters.anyDate') : t('filters.clear')}
          </button>
        </div>
      ) : (
        <>
          {/* Computers */}
          <div className="hidden md:block">
            {view === 'list' ? (
              <PostsTable
                posts={shown}
                multilingual={multilingual}
                canEdit={canEdit}
                selected={selected}
                onToggle={toggle}
                allState={allState}
                onToggleAll={toggleAll}
                sort={filters.sort}
                onSort={onSort}
                onOpen={open}
                menuFor={menuFor}
                onFeatured={setFeatured}
              />
            ) : (
              <PostCardsGrid
                posts={shown}
                canEdit={canEdit}
                selected={selected}
                onToggle={toggle}
                onOpen={open}
                menuFor={menuFor}
                onFeatured={setFeatured}
              />
            )}
          </div>
          {/* Phones */}
          <div className="md:hidden">
            <PostPhoneList posts={shown} canEdit={canEdit} selected={selected} onToggle={toggle} onOpen={open} menuFor={menuFor} />
          </div>
        </>
      )}

      {canEdit && selectedIds.length > 0 ? (
        <SelectionBar label={t('select.toolbar')} count={tc('selected', { count: selectedIds.length })}>
          {/* Phones: the main three + More */}
          <BarButton className="md:hidden" disabled={none} onPress={() => void runBatch('offline', selectedIds)} icon={ICONS.offline}>
            {tc('bar.offline')}
          </BarButton>
          <BarButton className="md:hidden" disabled={none} onPress={() => setSheet({ kind: 'endDate', ids: selectedIds })} icon={ICONS.calendar}>
            {tc('bar.endDate')}
          </BarButton>
          <BarButton className="md:hidden" disabled={none} onPress={() => askDelete(selectedIds)} icon={ICONS.trash} destructive>
            {tc('bar.delete')}
          </BarButton>
          <BarButton className="md:hidden" disabled={busy} onPress={() => setSheet({ kind: 'more' })} icon={ICONS.more}>
            {tc('bar.more')}
          </BarButton>
          {/* Computers: everything in the bar */}
          {allOffline ? (
            <BarButton className="hidden md:flex" disabled={none} onPress={() => void runBatch('online', selectedIds)} icon={ICONS.online}>
              {tc('more.online')}
            </BarButton>
          ) : (
            <BarButton className="hidden md:flex" disabled={none} onPress={() => void runBatch('offline', selectedIds)} icon={ICONS.offline}>
              {tc('bar.offline')}
            </BarButton>
          )}
          <BarButton className="hidden md:flex" disabled={none} onPress={() => setSheet({ kind: 'endDate', ids: selectedIds })} icon={ICONS.calendar}>
            {tc('bar.endDate')}
          </BarButton>
          <BarButton className="hidden md:flex" disabled={none} onPress={() => void runBatch('featured', selectedIds, { featured: true })} icon={<StarGlyph on />}>
            {tc('bar.featured')}
          </BarButton>
          <BarButton className="hidden md:flex" disabled={none} onPress={() => void runBatch('featured', selectedIds, { featured: false })} icon={<StarGlyph on={false} />}>
            {tc('bar.notFeatured')}
          </BarButton>
          <BarButton
            className="hidden md:flex"
            disabled={none || categories.length === 0}
            onPress={() => setSheet({ kind: 'categories', ids: selectedIds })}
            icon={ICONS.tag}
          >
            {tc('bar.categories')}
          </BarButton>
          <BarButton className="hidden md:flex" disabled={none} onPress={() => askDelete(selectedIds)} icon={ICONS.trash} destructive>
            {tc('bar.delete')}
          </BarButton>
          <BarButton className="hidden md:flex" onPress={clearSelection} icon={ICONS.x}>
            {tc('bar.clear')}
          </BarButton>
        </SelectionBar>
      ) : null}

      <BottomSheet open={sheet?.kind === 'more'} title={tc('more.title')} onClose={() => setSheet(null)}>
        <SheetItem disabled={none} onPress={() => { setSheet(null); void runBatch('online', selectedIds) }}>
          {tc('more.online')}
        </SheetItem>
        <SheetItem disabled={none} onPress={() => { setSheet(null); void runBatch('featured', selectedIds, { featured: true }) }}>
          {tc('more.featured')}
        </SheetItem>
        <SheetItem disabled={none} onPress={() => { setSheet(null); void runBatch('featured', selectedIds, { featured: false }) }}>
          {tc('more.notFeatured')}
        </SheetItem>
        <SheetItem disabled={none || categories.length === 0} onPress={() => setSheet({ kind: 'categories', ids: selectedIds })}>
          {tc('more.categories')}
        </SheetItem>
        <SheetItem disabled={none} onPress={() => { setSheet(null); void runBatch('endDate', selectedIds, { expiresAt: null }) }}>
          {tc('more.removeEndDate')}
        </SheetItem>
        <SheetItem onPress={() => { setSheet(null); clearSelection() }}>{tc('more.clear')}</SheetItem>
      </BottomSheet>

      <EndDateSheet
        open={sheet?.kind === 'endDate'}
        busy={busy}
        onClose={() => setSheet(null)}
        onSave={async (iso) => {
          const ids = sheet?.kind === 'endDate' ? sheet.ids : []
          if (await runBatch('endDate', ids, { expiresAt: iso })) setSheet(null)
        }}
        onRemove={
          sheet?.kind === 'endDate' && sheet.ids.some((id) => byId.get(id)?.expiresAt)
            ? async () => {
                const ids = sheet.ids
                if (await runBatch('endDate', ids, { expiresAt: null })) setSheet(null)
              }
            : undefined
        }
      />

      <CategorySheet
        open={sheet?.kind === 'categories'}
        busy={busy}
        categories={categories}
        onClose={() => setSheet(null)}
        onSave={async (keys) => {
          const ids = sheet?.kind === 'categories' ? sheet.ids : []
          if (await runBatch('categories', ids, { categories: keys })) setSheet(null)
        }}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title={tc('confirmDelete.title', { count: confirmDelete?.length ?? 0 })}
        body={tc('confirmDelete.body', { count: confirmDelete?.length ?? 0, title: confirmDelete?.length === 1 ? titleOf(confirmDelete[0]) : '' })}
        confirmLabel={tc('confirmDelete.confirm')}
        busy={busy}
        onConfirm={async () => {
          const ids = confirmDelete ?? []
          await runBatch('delete', ids)
          setConfirmDelete(null)
          clearSelection()
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      <Toast message={toast?.message ?? null} tone={toast?.tone} action={toast?.undo ? tc('undo') : undefined} onAction={toast?.undo} />
    </div>
  )
}
