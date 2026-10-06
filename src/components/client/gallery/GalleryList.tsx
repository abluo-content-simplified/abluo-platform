'use client'

import { useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import type { GalleryListItem } from '@/lib/api/gallery-drafts'
import type { GalleryStatus } from '@/lib/api/gallery-status'
import { batchGalleriesAction } from '@/app/[locale]/(client)/[tenant]/galleries/actions'
import { mintGalleryPreviewAction } from '@/app/[locale]/(client)/[tenant]/galleries/preview-actions'
import { draftPreviewUrl } from '@/lib/client/preview-url'
import { ConfirmDialog } from '@/components/client/create/ConfirmDialog'
import { PHOTO_CARD_MAX, TagEditor } from '@/components/client/media/PhotoCard'
import { BottomSheet } from '@/components/client/ui/BottomSheet'
import { CardMenu, type CardMenuItem } from '@/components/client/ui/CardMenu'
import { FilterBar, FilterSearch, FilterSegmented, FilterSelect } from '@/components/client/ui/FilterBar'
import { idRange, SelectionBar } from '@/components/client/ui/SelectionBar'
import { Toast } from '@/components/client/ui/Toast'
import { useUndo } from '@/components/client/ui/use-undo'
import { GalleryStatusLines } from './GalleryStatusLines'

const LONG_PRESS_MS = 500
const LONG_PRESS_SLOP_PX = 10
const BATCH_MAX = 100

type Usage = 'all' | 'used' | 'unused'

/**
 * The project's galleries, laid out like the Posts list: page header, filter
 * bar (search, tag, where used), cards with cover, title, where it is shown /
 * what needs attention (GalleryStatusLines), tags, "Unpublished changes" and a
 * ⋯ menu (Edit, Preview, Delete: only when the gallery is not used anywhere).
 * Rows are top-aligned. "New gallery" opens the gallery wizard with no
 * document yet (lazy creation).
 *
 * Select several (same pattern as Posts): a checkbox per card on hover/focus
 * and shift-click on a computer; long-press or "Select" on a phone. The
 * floating bar has "Add tags" and "Delete". Delete only removes galleries
 * that are not used anywhere (owners); the others are reported as skipped.
 * The server checks every gallery on its own (≤ 100 at a time).
 */
export function GalleryList({
  projectSlug,
  galleries,
  statuses,
  canWrite,
  canDelete = false,
}: {
  projectSlug: string
  galleries: GalleryListItem[]
  /** Where each gallery is used and what needs attention, by gallery id. */
  statuses: Record<string, GalleryStatus>
  canWrite: boolean
  /** Owner with gallery write (the server re-checks). */
  canDelete?: boolean
}) {
  const t = useTranslations('clientDashboard.gallery.list')
  const ts = useTranslations('clientDashboard.gallery.select')
  const ui = useLocale()
  const router = useRouter()

  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [usage, setUsage] = useState<Usage>('all')
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [localTags, setLocalTags] = useState<Record<string, string[]>>({})
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null)
  const [tagSheet, setTagSheet] = useState<string[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const { toast, show } = useUndo()
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressStart = useRef<{ x: number; y: number } | null>(null)
  const pressed = useRef(false)
  const last = useRef<string | null>(null)

  const tagsOf = (g: GalleryListItem) => localTags[g.id] ?? g.tags
  const isUsed = (g: GalleryListItem) => {
    const s = statuses[g.id]
    return g.usedIn.length > 0 || (s ? s.usedOn.pages.length + s.usedOn.posts.published + s.usedOn.posts.draft > 0 : false)
  }
  const titleOf = (g: GalleryListItem) => g.title || g.internalName || t('untitled')
  const byId = useMemo(() => new Map(galleries.map((g) => [g.id, g])), [galleries])
  const allTags = useMemo(() => [...new Set(galleries.flatMap((g) => localTags[g.id] ?? g.tags))].sort(), [galleries, localTags])

  const needle = q.trim().toLowerCase()
  const shown = galleries.filter((g) => {
    if (hidden.has(g.id)) return false
    if (needle && !`${titleOf(g)} ${g.internalName} ${tagsOf(g).join(' ')}`.toLowerCase().includes(needle)) return false
    if (tag && !tagsOf(g).includes(tag)) return false
    if (usage === 'used' && !isUsed(g)) return false
    if (usage === 'unused' && isUsed(g)) return false
    return true
  })
  const order = shown.map((g) => g.id)
  const allShownSelected = shown.length > 0 && shown.every((g) => selected.has(g.id))
  const selectedIds = [...selected].filter((id) => !hidden.has(id))
  const filtering = Boolean(needle || tag || usage !== 'all')
  const clear = () => {
    setQ('')
    setTag('')
    setUsage('all')
  }

  // ── Selection ───────────────────────────────────────────────────────────────
  const exitSelect = () => {
    setSelecting(false)
    setSelected(new Set())
    last.current = null
  }
  const pick = (id: string, shift: boolean) => {
    setSelected((s) => {
      const n = new Set(s)
      if (shift && last.current && last.current !== id) {
        const on = !s.has(id)
        for (const x of idRange(order, last.current, id)) {
          if (on) n.add(x)
          else n.delete(x)
        }
      } else if (n.has(id)) n.delete(id)
      else n.add(id)
      return new Set([...n].slice(0, BATCH_MAX))
    })
    last.current = id
  }
  const startPress = (e: React.PointerEvent, id: string) => {
    if (!canWrite || selecting || e.pointerType === 'mouse') return
    pressed.current = false
    pressStart.current = { x: e.clientX, y: e.clientY }
    pressTimer.current = setTimeout(() => {
      pressed.current = true
      navigator.vibrate?.(10)
      setSelecting(true)
      setSelected(new Set([id]))
      last.current = id
    }, LONG_PRESS_MS)
  }
  const movePress = (e: React.PointerEvent) => {
    const s = pressStart.current
    if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > LONG_PRESS_SLOP_PX) endPress()
  }
  const endPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current)
    pressTimer.current = null
  }

  // ── Actions ─────────────────────────────────────────────────────────────────
  const preview = async (g: GalleryListItem) => {
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
            if (g) n[id] = [...new Set([...(l[id] ?? g.tags), ...addTags])].slice(0, PHOTO_CARD_MAX.tags)
          }
          return n
        })
      }
      router.refresh()
      return failed + skipped === 0
    } catch {
      show({ message: ts('failed'), tone: 'error' }, 7000)
      return false
    } finally {
      setBusy(false)
    }
  }

  const menuFor = (g: GalleryListItem): CardMenuItem[] => [
    { key: 'edit', label: t('card.edit'), onSelect: () => router.push(`/${projectSlug}/galleries/${g.id}`) },
    { key: 'preview', label: t('card.preview'), onSelect: () => void preview(g) },
    ...(canDelete && !isUsed(g) ? [{ key: 'delete', label: t('card.delete'), onSelect: () => setConfirmDelete([g.id]), destructive: true }] : []),
  ]

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-28 md:pb-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 text-[0.9375rem] leading-6 text-muted-foreground">{t('helper')}</p>
        </div>
        {canWrite ? (
          <Link
            href={`/${projectSlug}/galleries/new`}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-action px-4 text-[0.9375rem] font-semibold text-action-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t('new')}
          </Link>
        ) : null}
      </div>

      {galleries.length === 0 ? (
        <section className="flex flex-col items-start gap-2 rounded-2xl border border-dashed border-border p-6">
          <h2 className="text-[1.0625rem] font-semibold text-foreground">{t('emptyTitle')}</h2>
          <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('emptyBody')}</p>
        </section>
      ) : (
        <>
          {canWrite ? (
            <div className="flex min-h-11 items-start justify-between gap-3">
              {selecting ? (
                <>
                  <button
                    type="button"
                    onClick={exitSelect}
                    aria-label={ts('stop')}
                    className="grid size-11 shrink-0 place-items-center rounded-full border border-border text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {ICONS.x}
                  </button>
                  <p className="flex-1 pt-2.5 text-[0.9375rem] font-semibold" aria-live="polite">
                    {ts('count', { count: selectedIds.length })}
                  </p>
                  <button
                    type="button"
                    onClick={() => setSelected(allShownSelected ? new Set() : new Set(shown.slice(0, BATCH_MAX).map((g) => g.id)))}
                    className="inline-flex min-h-11 items-center px-2 text-[0.9375rem] font-semibold text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {allShownSelected ? ts('none') : ts('all')}
                  </button>
                </>
              ) : (
                <>
                  <span />
                  <button
                    type="button"
                    onClick={() => setSelecting(true)}
                    className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-[0.9375rem] font-semibold text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {ts('start')}
                  </button>
                </>
              )}
            </div>
          ) : null}

          <FilterBar label={t('filters.label')}>
            <FilterSearch value={q} onChange={setQ} placeholder={t('filters.searchPlaceholder')} label={t('filters.search')} />
            {allTags.length > 0 ? (
              <FilterSelect
                label={t('filters.tag')}
                value={tag}
                onChange={setTag}
                options={[{ value: '', label: t('filters.allTags') }, ...allTags.map((x) => ({ value: x, label: x }))]}
              />
            ) : null}
            <FilterSegmented
              label={t('filters.usage')}
              value={usage}
              onChange={(v) => setUsage(v as Usage)}
              options={[
                { value: 'all', label: t('filters.usageAll') },
                { value: 'used', label: t('filters.usageUsed') },
                { value: 'unused', label: t('filters.usageUnused') },
              ]}
            />
          </FilterBar>

          <div className="flex items-start justify-between gap-3 text-sm text-muted-foreground">
            <p aria-live="polite">{t('filters.showing', { shown: shown.length, total: galleries.length - hidden.size })}</p>
            {filtering ? (
              <button type="button" onClick={clear} className="inline-flex min-h-8 items-center font-medium text-foreground underline underline-offset-4">
                {t('filters.clear')}
              </button>
            ) : null}
          </div>

          {shown.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center">
              <p className="font-medium text-foreground">{t('filters.noMatch')}</p>
              <button type="button" onClick={clear} className="mt-3 inline-flex h-11 items-center rounded-xl border border-border px-4 text-[0.9375rem] font-medium text-foreground">
                {t('filters.clear')}
              </button>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {shown.map((g) => {
                const title = titleOf(g)
                const isSel = selected.has(g.id)
                const tags = tagsOf(g)
                const inner = (
                  <>
                    {g.coverThumb ? (
                      // eslint-disable-next-line @next/next/no-img-element -- Sanity CDN thumbnail, already sized
                      <img src={g.coverThumb} alt="" width={96} height={96} loading="lazy" className="size-24 shrink-0 rounded-lg bg-muted object-cover" />
                    ) : (
                      <span aria-hidden="true" className="flex size-24 shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-muted text-muted-foreground">
                        {ICONS.image}
                      </span>
                    )}
                    <span className="flex min-w-0 flex-1 flex-col items-start gap-1 pt-0.5">
                      <span className="line-clamp-2 block text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">{title}</span>
                      {statuses[g.id] ? (
                        <GalleryStatusLines status={statuses[g.id]} />
                      ) : (
                        <span className="text-[0.9375rem] leading-6 text-muted-foreground">{g.count > 0 ? t('count', { count: g.count }) : t('noCover')}</span>
                      )}
                      {tags.length || (g.hasDraft && g.isPublished) ? (
                        <span className="flex flex-wrap items-start gap-1.5">
                          {g.hasDraft && g.isPublished ? (
                            <span className="inline-flex h-6 items-center rounded-full bg-accent px-2.5 text-xs font-medium text-accent-foreground">{t('unpublished')}</span>
                          ) : null}
                          {tags.map((x) => (
                            <span key={x} className="inline-flex h-6 items-center rounded-full border border-border px-2.5 text-xs text-muted-foreground">
                              {x}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </>
                )
                return (
                  <li
                    key={g.id}
                    className={`group relative flex items-start gap-2 rounded-xl border bg-card p-3 ${isSel ? 'border-action ring-1 ring-action' : 'border-border'}`}
                    onPointerDown={(e) => startPress(e, g.id)}
                    onPointerMove={movePress}
                    onPointerUp={endPress}
                    onPointerLeave={endPress}
                    onPointerCancel={endPress}
                    onContextMenu={(e) => canWrite && pressed.current && e.preventDefault()}
                  >
                    {selecting ? (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isSel}
                        aria-label={ts('card', { title })}
                        onClick={(e) => pick(g.id, e.shiftKey)}
                        className="flex min-w-0 flex-1 items-start gap-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <Tick on={isSel} className="mt-9 md:hidden" round />
                        {inner}
                      </button>
                    ) : (
                      <Link
                        href={`/${projectSlug}/galleries/${g.id}`}
                        onClick={(e) => {
                          if (pressed.current) {
                            e.preventDefault()
                            pressed.current = false
                          }
                        }}
                        className="flex min-w-0 flex-1 items-start gap-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {inner}
                      </Link>
                    )}
                    {/* Computer: a checkbox on the cover, on hover or focus (always while selecting). */}
                    {canWrite ? (
                      selecting ? (
                        <span aria-hidden="true" className="pointer-events-none absolute top-5 left-5 hidden md:block">
                          <Tick on={isSel} />
                        </span>
                      ) : (
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={false}
                          aria-label={ts('card', { title })}
                          onClick={(e) => {
                            setSelecting(true)
                            setSelected(new Set([g.id]))
                            last.current = g.id
                            e.stopPropagation()
                          }}
                          className="absolute top-3 left-3 hidden size-11 place-items-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 md:grid"
                        >
                          <Tick on={false} />
                        </button>
                      )
                    ) : null}
                    {canWrite && !selecting ? (
                      <div className="-mt-1 -mr-1">
                        <CardMenu label={t('card.menu', { title })} items={menuFor(g)} />
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {selecting ? (
        <SelectionBar label={ts('toolbar')} count={ts('count', { count: selectedIds.length })}>
          <BarButton
            disabled={!selectedIds.length || busy}
            onPress={() => {
              setPicked([])
              setTagSheet(selectedIds)
            }}
            icon={ICONS.tag}
          >
            {ts('bar.addTags')}
          </BarButton>
          {canDelete ? (
            <BarButton disabled={!selectedIds.length || busy} onPress={() => setConfirmDelete(selectedIds)} icon={ICONS.trash} destructive>
              {ts('bar.delete')}
            </BarButton>
          ) : null}
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
            if (ok) exitSelect()
          }}
          className="mt-4 inline-flex h-12 items-center justify-center rounded-xl bg-action px-5 text-[0.9375rem] font-semibold text-action-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40"
        >
          {ts('tagsSheet.save')}
        </button>
      </BottomSheet>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={ts('confirm.title', { count: confirmDelete?.length ?? 0 })}
        body={ts('confirm.body', { count: confirmDelete?.length ?? 0, title: confirmDelete?.length === 1 ? titleOf(byId.get(confirmDelete[0])!) : '' })}
        confirmLabel={ts('confirm.confirm')}
        busy={busy}
        onConfirm={async () => {
          const ids = confirmDelete ?? []
          await runBatch('delete', ids)
          setConfirmDelete(null)
          exitSelect()
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </div>
  )
}

function Tick({ on, round, className = '' }: { on: boolean; round?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-6 shrink-0 place-items-center border-2 ${round ? 'rounded-full' : 'rounded-md'} ${
        on ? 'border-action bg-action text-action-foreground' : 'border-border bg-background'
      } ${className}`}
    >
      {on ? ICONS.tick : null}
    </span>
  )
}

function BarButton({
  children,
  icon,
  onPress,
  disabled,
  destructive,
}: {
  children: React.ReactNode
  icon: React.ReactNode
  onPress: () => void
  disabled?: boolean
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      className={`flex min-h-14 flex-col items-center justify-start gap-1 rounded-xl px-1 pt-2 pb-1.5 text-xs font-medium hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40 ${
        destructive ? 'text-destructive' : 'text-foreground'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

function svg(d: string, size = 20, width = 2) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const ICONS = {
  x: svg('M6 6l12 12M18 6L6 18'),
  tick: svg('M20 6 9 17l-5-5', 16, 2.4),
  image: svg('M3 3h18v18H3zM9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM21 15l-5-5L5 21', 28, 1.5),
  trash: svg('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'),
  tag: svg('M3 12V4h8l10 10-8 8L3 12zM7.5 8h.01'),
}
