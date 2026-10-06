'use client'

import { useCallback, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { PhotoCard, type CardChange, type CardPhoto } from '@/components/client/media/PhotoCard'
import { BATCH_MAX, BatchSheet, type BatchMode } from '@/components/client/media/BatchSheet'
import { listMediaLibraryAction } from '@/app/[locale]/(client)/[tenant]/media/actions'
import type { MediaLibraryItem, MediaUsage } from '@/lib/api/media-library'

type Site = { defaultLocale: string; locales: string[] }

export type MediaLibraryScreenProps = {
  projectSlug: string
  site: Site
}

/** Press and hold this long to start selecting (phones and tablets). */
const LONG_PRESS_MS = 500
/** A finger that moves this far is scrolling, not holding. */
const LONG_PRESS_SLOP_PX = 10

type ThumbSize = 'small' | 'medium' | 'large'
const SIZES: ThumbSize[] = ['small', 'medium', 'large']
const SIZE_KEY = 'abluo.media.thumbSize'
/** Columns per size (phone / sm / lg): small shows more photos, large fewer. */
const GRID: Record<ThumbSize, string> = {
  small: 'grid-cols-4 sm:grid-cols-6 lg:grid-cols-8',
  medium: 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-6',
  large: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
}
/** Two fingers moving this far apart (or together), relative to where they started, change the size by one step. */
const PINCH_STEP = 1.3

const toCard = (i: MediaLibraryItem): CardPhoto => ({
  assetId: i.assetId,
  rev: i.rev,
  url: i.url,
  name: i.name,
  alt: i.alt,
  caption: i.caption,
  tags: i.tags,
  focal: i.focal,
})

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
 * The Media screen (Tom, wave B): the whole Media Library with search (name,
 * description and caption, any language) and tag filters — a sticky "3 tags ·
 * Clear all" while tags are on. "No description" marks photos still to
 * describe. Tap a photo for the one photo card plus "Used in". Select several
 * (press and hold, or "Select"): round ticks, × to stop, and a floating bar
 * with "N selected" · Add tags · Rename · Clear (≤ 100 at a time; the server
 * checks each photo). "Add photos" opens the media wizard. Still no delete.
 */
export function MediaLibraryScreen({ projectSlug, site }: MediaLibraryScreenProps) {
  const t = useTranslations('clientDashboard.media')
  const d = site.defaultLocale
  const searchId = useId()

  // ── Library ─────────────────────────────────────────────────────────────────
  const [items, setItems] = useState<MediaLibraryItem[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const req = useRef(0)

  const load = useCallback(
    async (from: string | null, search: string, tf: string[]) => {
      const n = ++req.current
      setState('loading')
      try {
        const r = await listMediaLibraryAction({ projectSlug, cursor: from, q: search || null, tags: tf.length ? tf : null })
        if (n !== req.current) return
        if (!r.ok) return setState('error')
        setItems((prev) => (from ? [...prev, ...r.items.filter((i) => !prev.some((p) => p.assetId === i.assetId))] : r.items))
        setTags(r.tags)
        setCursor(r.nextCursor)
        setState('ready')
      } catch {
        if (n === req.current) setState('error')
      }
    },
    [projectSlug]
  )
  useEffect(() => {
    const id = setTimeout(() => setQ(query.trim()), 300)
    return () => clearTimeout(id)
  }, [query])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- (re)load when the filters change
    void load(null, q, tagFilter)
  }, [load, q, tagFilter])

  // ── Thumbnail size: switch + pinch (touch), remembered in this browser ───────
  const [size, setSizeState] = useState<ThumbSize>('medium')
  useEffect(() => {
    try {
      const v = localStorage.getItem(SIZE_KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore the saved choice after hydration
      if (v === 'small' || v === 'medium' || v === 'large') setSizeState(v)
    } catch {
      // Storage unavailable: the default size is fine.
    }
  }, [])
  const sizeRef = useRef(size)
  const setSize = useCallback((next: ThumbSize) => {
    sizeRef.current = next
    setSizeState(next)
    try {
      localStorage.setItem(SIZE_KEY, next)
    } catch {
      // Not remembered; still applied.
    }
  }, [])
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinchBase = useRef<number | null>(null)
  const dist = () => {
    const [a, b] = [...touches.current.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }
  const pinch = {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType !== 'touch') return
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.current.size === 2) {
        pinchBase.current = dist() || null
        cancelPress()
      }
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (!touches.current.has(e.pointerId)) return
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const base = pinchBase.current
      if (touches.current.size !== 2 || !base) return
      const ratio = dist() / base
      const at = SIZES.indexOf(sizeRef.current)
      // Pinch out = larger thumbnails.
      const next = ratio > PINCH_STEP ? at + 1 : ratio < 1 / PINCH_STEP ? at - 1 : at
      if (next !== at && next >= 0 && next < SIZES.length) setSize(SIZES[next])
      if (next !== at) pinchBase.current = dist() || null
    },
    onPointerUp: (e: ReactPointerEvent) => {
      touches.current.delete(e.pointerId)
      if (touches.current.size < 2) pinchBase.current = null
    },
    onPointerCancel: (e: ReactPointerEvent) => {
      touches.current.delete(e.pointerId)
      if (touches.current.size < 2) pinchBase.current = null
    },
  }

  // ── Edit one photo ──────────────────────────────────────────────────────────
  const [openId, setOpenId] = useState<string | null>(null)
  const saving = useRef<Promise<unknown>>(Promise.resolve())
  const onPhotoChange = useCallback((c: CardChange) => setItems((prev) => prev.map((i) => (i.assetId === c.assetId ? merge(i, c) : i))), [])
  const onSaving = useCallback((job: Promise<unknown>) => {
    saving.current = job
  }, [])
  const open = items.find((i) => i.assetId === openId) ?? null

  // ── Select several ──────────────────────────────────────────────────────────
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [batch, setBatch] = useState<Exclude<BatchMode, 'all'> | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const press = useRef<{ id: string; x: number; y: number; timer: ReturnType<typeof setTimeout>; fired: boolean } | null>(null)
  useEffect(() => {
    const ref = press
    return () => {
      if (ref.current) clearTimeout(ref.current.timer)
    }
  }, [])
  // The "Saved on N photos" note goes away by itself.
  useEffect(() => {
    if (!message || selecting) return
    const id = setTimeout(() => setMessage(null), 4000)
    return () => clearTimeout(id)
  }, [message, selecting])

  const toggle = (id: string) => {
    setMessage(null)
    if (selected.includes(id)) return setSelected(selected.filter((x) => x !== id))
    if (selected.length >= BATCH_MAX) return setMessage(t('select.limit', { max: BATCH_MAX }))
    setSelected([...selected, id])
  }
  const startSelecting = (first?: string) => {
    setSelecting(true)
    setMessage(null)
    setSelected(first ? [first] : [])
  }
  const stopSelecting = () => {
    setSelecting(false)
    setSelected([])
    setBatch(null)
  }
  useEffect(() => {
    if (!selecting || batch) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setSelecting(false)
      setSelected([])
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selecting, batch])

  const cancelPress = () => {
    if (press.current && !press.current.fired) {
      clearTimeout(press.current.timer)
      press.current = null
    }
  }
  const pressHandlers = (id: string) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      if (selecting || e.pointerType === 'mouse') return
      const timer = setTimeout(() => {
        if (!press.current) return
        press.current.fired = true
        navigator.vibrate?.(10)
        startSelecting(id)
      }, LONG_PRESS_MS)
      press.current = { id, x: e.clientX, y: e.clientY, timer, fired: false }
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const p = press.current
      if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP_PX) cancelPress()
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
    onPointerLeave: cancelPress,
    onContextMenu: (e: React.MouseEvent) => {
      if (press.current) e.preventDefault()
    },
    onClick: () => {
      // The click that ends a long press only starts the selection.
      if (press.current?.fired) {
        press.current = null
        return
      }
      if (selecting) toggle(id)
      else setOpenId(id)
    },
  })

  /** Selected photos in grid order (the numbers of "Rename" follow it). */
  const ordered = items.filter((i) => selected.includes(i.assetId))

  const tagLine = tagFilter.length > 0
  const nameOf = (item: MediaLibraryItem, i: number) => item.name?.trim() || item.alt[d] || t('library.photoN', { n: i + 1 })

  return (
    <div className={`mx-auto flex max-w-4xl flex-col gap-8 ${selecting ? 'pb-48 md:pb-28' : 'pb-28 md:pb-8'}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl leading-8 font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 text-[0.9375rem] leading-6 text-muted-foreground">{t('helper')}</p>
        </div>
        <Link
          href={`/${projectSlug}/media/add`}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-action px-4 text-[0.9375rem] font-semibold text-action-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {ICONS.plus}
          {t('addTitle')}
        </Link>
      </div>

      <section aria-labelledby="media-library-title" className="flex flex-col gap-4">
        <div className="flex min-h-11 items-start justify-between gap-3">
          {selecting ? (
            <>
              <p id="media-library-title" className="pt-2.5 text-[1.0625rem] font-semibold text-foreground" aria-live="polite">
                {t('select.count', { count: selected.length })}
              </p>
              <button
                type="button"
                onClick={stopSelecting}
                aria-label={t('select.stop')}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {ICONS.x}
              </button>
            </>
          ) : (
            <>
              <h2 id="media-library-title" className="pt-2.5 text-[1.0625rem] font-semibold text-foreground">
                {t('library.title')}
              </h2>
              <div className="flex items-start gap-2">
              <SizeSwitch value={size} onChange={setSize} label={t('size.label')} names={{ small: t('size.small'), medium: t('size.medium'), large: t('size.large') }} />
              {items.length > 0 ? (
                <button
                  type="button"
                  onClick={() => startSelecting()}
                  className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-border bg-background px-4 text-[0.9375rem] font-medium text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {t('select.start')}
                </button>
              ) : null}
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <label htmlFor={searchId} className="sr-only">
            {t('library.search')}
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            maxLength={80}
            placeholder={t('library.searchPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
            className="block min-h-11 w-full rounded-full border border-border bg-background px-4 text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
          {tags.length > 0 && (
            <div role="group" aria-label={t('library.tags')} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {[...tagFilter.filter((f) => !tags.includes(f)), ...tags].map((tag) => {
                const on = tagFilter.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTagFilter((f) => (on ? f.filter((x) => x !== tag) : f.length >= 10 ? f : [...f, tag]))}
                    className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-medium text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                      on ? 'border-ring bg-selected-tint' : 'border-border bg-background hover:bg-hover'
                    }`}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Stays in view while scrolling: which tags filter the grid, and the way out. */}
        {tagLine ? (
          <div className="sticky top-14 z-20 -mx-1 flex items-center justify-between gap-3 rounded-full border border-border bg-background/95 px-4 py-1 shadow-sm backdrop-blur md:top-2">
            <p className="min-w-0 truncate text-sm font-medium text-foreground" title={tagFilter.join(', ')}>
              {t('library.tagSummary', { count: tagFilter.length })}
              <span className="text-muted-foreground"> · {tagFilter.join(', ')}</span>
            </p>
            <button
              type="button"
              onClick={() => setTagFilter([])}
              className="inline-flex min-h-11 shrink-0 items-center rounded-full px-2 text-sm font-medium text-foreground underline underline-offset-4 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t('library.clearAll')}
            </button>
          </div>
        ) : null}

        {state === 'error' && <p className="text-sm text-destructive">{t('library.error')}</p>}
        {state === 'ready' && items.length === 0 && (
          <p className="text-sm text-muted-foreground">{q || tagFilter.length ? t('library.noResults') : t('library.empty')}</p>
        )}
        {!selecting && items.length > 1 ? <p className="-mt-2 text-xs text-muted-foreground">{t('select.hint')}</p> : null}
        <ul className={`grid touch-pan-y items-start gap-2 ${GRID[size]}`} {...pinch}>
          {items.map((item, i) => {
            const needsAlt = !(item.alt[d] ?? '').trim()
            const name = nameOf(item, i)
            const on = selected.includes(item.assetId)
            return (
              <li
                key={item.assetId}
                className={`relative aspect-square overflow-hidden rounded-xl border bg-muted ${on ? 'border-ring ring-2 ring-ring' : 'border-border'}`}
              >
                <button
                  type="button"
                  {...pressHandlers(item.assetId)}
                  aria-label={selecting ? t('select.photo', { name }) : t('library.edit', { name })}
                  aria-pressed={selecting ? on : undefined}
                  className="block size-full touch-manipulation select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- Sanity CDN thumbnail */}
                  <img
                    src={item.thumbUrl}
                    alt=""
                    width="240"
                    height="240"
                    loading="lazy"
                    draggable={false}
                    className={`size-full object-cover [-webkit-touch-callout:none] transition-transform ${on ? 'scale-[0.94] rounded-lg' : ''}`}
                  />
                </button>
                {selecting ? (
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute top-1.5 left-1.5 flex size-6 items-center justify-center rounded-full border-2 ${
                      on ? 'border-action bg-action text-action-foreground' : 'border-background bg-background/60'
                    }`}
                  >
                    {on ? ICONS.tick : null}
                  </span>
                ) : null}
                <span className="pointer-events-none absolute right-1.5 bottom-1.5 left-1.5 flex flex-col items-start gap-1">
                  <span className="max-w-full truncate rounded-full bg-background px-2 py-0.5 text-xs leading-5 text-foreground">
                    {t('library.usage', { count: item.usedIn.length })}
                  </span>
                  {needsAlt && size !== 'small' ? (
                    <span className="max-w-full truncate rounded-full bg-background px-2 py-0.5 text-xs leading-5 text-muted-foreground">{t('library.needsDescription')}</span>
                  ) : null}
                </span>
              </li>
            )
          })}
        </ul>
        {state === 'loading' && <p className="text-sm text-muted-foreground">{t('library.loading')}</p>}
        {state === 'ready' && cursor && (
          <button
            type="button"
            onClick={() => void load(cursor, q, tagFilter)}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-border bg-background text-[0.9375rem] font-medium text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t('library.more')}
          </button>
        )}
      </section>

      {/* The floating selection bar: above the phone's bottom navigation, beside the sidebar on a computer. */}
      {selecting ? (
        <div className="fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 px-4 md:bottom-6 md:left-56">
          <div
            role="toolbar"
            aria-label={t('select.toolbar')}
            className="mx-auto flex max-w-xl flex-col gap-2 rounded-2xl border border-border bg-background p-2 shadow-lg"
          >
            {message ? (
              <p role="status" className="px-2 pt-1 text-sm text-muted-foreground">
                {message}
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate px-2 text-[0.9375rem] font-semibold text-foreground">{t('select.count', { count: selected.length })}</p>
              <BarButton disabled={!selected.length} onPress={() => setBatch('tags')}>
                {t('select.addTags')}
              </BarButton>
              <BarButton disabled={!selected.length} onPress={() => setBatch('rename')}>
                {t('select.rename')}
              </BarButton>
              <BarButton disabled={!selected.length} onPress={() => setSelected([])} quiet>
                {t('select.clear')}
              </BarButton>
            </div>
          </div>
        </div>
      ) : message ? (
        <p role="status" className="fixed inset-x-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-md rounded-full bg-foreground px-4 py-2 text-center text-sm text-background md:bottom-6 md:left-56">
          {message}
        </p>
      ) : null}

      {batch && ordered.length ? (
        <BatchSheet
          projectSlug={projectSlug}
          scope="media"
          mode={batch}
          assetIds={ordered.map((i) => i.assetId)}
          thumbs={ordered.map((i) => i.thumbUrl)}
          tagSuggestions={tags}
          onClose={() => setBatch(null)}
          onDone={(changes, skipped) => {
            const by = new Map(changes.map((c) => [c.assetId, c]))
            setItems((prev) => prev.map((i) => (by.has(i.assetId) ? merge(i, by.get(i.assetId)!) : i)))
            setBatch(null)
            setSelecting(false)
            setSelected([])
            setMessage(
              skipped ? `${t('select.saved', { count: changes.length })} · ${t('select.skipped', { count: skipped })}` : t('select.saved', { count: changes.length })
            )
          }}
        />
      ) : null}

      {open && !selecting ? (
        <PhotoSheet projectSlug={projectSlug} site={site} item={open} tagSuggestions={tags} onChange={onPhotoChange} onSaving={onSaving} onClose={() => setOpenId(null)} />
      ) : null}
    </div>
  )
}

/** Small / Medium / Large thumbnails: a 44px segmented control with icons. */
function SizeSwitch({ value, onChange, label, names }: { value: ThumbSize; onChange: (v: ThumbSize) => void; label: string; names: Record<ThumbSize, string> }) {
  const icon = (n: number) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {n === 3 ? (
        // many small squares
        [3, 10, 17].flatMap((x) => [3, 10, 17].map((y) => <rect key={`${x}${y}`} x={x} y={y} width="4" height="4" rx="1" />))
      ) : n === 2 ? (
        [3, 13].flatMap((x) => [3, 13].map((y) => <rect key={`${x}${y}`} x={x} y={y} width="8" height="8" rx="1.5" />))
      ) : (
        <rect x="3" y="3" width="18" height="18" rx="2.5" />
      )}
    </svg>
  )
  return (
    <div role="radiogroup" aria-label={label} className="flex h-11 items-stretch gap-1 rounded-xl border border-border bg-background p-1">
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          aria-label={names[s]}
          title={names[s]}
          onClick={() => onChange(s)}
          className={`grid w-10 place-items-center rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
            value === s ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {icon(s === 'small' ? 3 : s === 'medium' ? 2 : 1)}
        </button>
      ))}
    </div>
  )
}

function BarButton({ children, onPress, disabled, quiet }: { children: React.ReactNode; onPress: () => void; disabled?: boolean; quiet?: boolean }) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      className={`inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-[0.9375rem] font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50 ${
        quiet ? 'text-muted-foreground enabled:hover:bg-hover' : 'border border-border bg-background text-foreground enabled:hover:bg-hover'
      }`}
    >
      {children}
    </button>
  )
}

/** One photo: the photo card plus "Used in …". Full screen on a phone, a panel on a computer. */
function PhotoSheet({
  projectSlug,
  site,
  item,
  tagSuggestions,
  onChange,
  onSaving,
  onClose,
}: {
  projectSlug: string
  site: Site
  item: MediaLibraryItem
  tagSuggestions: readonly string[]
  onChange: (c: CardChange) => void
  onSaving: (job: Promise<unknown>) => void
  onClose: () => void
}) {
  const t = useTranslations('clientDashboard.media')
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  // The card is mounted once per photo: it keeps its own copy while open.
  const [photo] = useState(() => toCard(item))

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-overlay" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col bg-background sm:max-w-[32rem] sm:border-l sm:border-border"
      >
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          <h2 id={titleId} className="flex-1 truncate px-1 text-lg font-semibold text-foreground">
            {item.name?.trim() || t('sheet.title')}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('sheet.close')}
            className="inline-flex size-11 items-center justify-center rounded-full text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {ICONS.x}
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <PhotoCard
            key={photo.assetId}
            projectSlug={projectSlug}
            scope="media"
            site={{ defaultLocale: site.defaultLocale, languages: site.locales }}
            photo={photo}
            tagSuggestions={tagSuggestions}
            onChange={onChange}
            onSaving={onSaving}
          />
          <UsedIn usedIn={item.usedIn} projectSlug={projectSlug} />
        </div>
      </div>
    </div>
  )
}

function UsedIn({ usedIn, projectSlug }: { usedIn: MediaUsage[]; projectSlug: string }) {
  const t = useTranslations('clientDashboard.media.usedIn')
  return (
    <section aria-labelledby="media-used-in" className="flex flex-col gap-2 border-t border-border-subtle pt-4">
      <h3 id="media-used-in" className="text-[0.9375rem] font-semibold text-foreground">
        {t('title')}
      </h3>
      {usedIn.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {usedIn.map((u) => (
            <li key={`${u.kind}-${u.id}`} className="flex items-start gap-2 text-sm text-foreground">
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t(`kind.${u.kind}`)}</span>
              {u.kind === 'gallery' ? (
                <Link href={`/${projectSlug}/galleries/${u.id}`} className="underline underline-offset-4">
                  {u.title || t('untitled')}
                </Link>
              ) : u.kind === 'post' ? (
                <Link href={`/${projectSlug}/posts`} className="underline underline-offset-4">
                  {u.title || t('untitled')}
                </Link>
              ) : (
                <span>{u.title || t('untitled')}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function svg(d: string, size = 20) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const ICONS = {
  x: svg('M6 6l12 12M18 6L6 18'),
  plus: svg('M12 5v14M5 12h14', 18),
  tick: svg('M5 12l5 5L20 7', 14),
}
