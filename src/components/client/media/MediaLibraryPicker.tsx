'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { mediaApi, thumbOf, type MediaScope } from '@/components/client/media/media-api'
import type { AddedPhoto } from '@/components/client/media/AddPhotos'
import { Button, IconButton } from '@/components/app/ui/Button'
import { Chip } from '@/components/app/ui/Chip'
import { TileBadge, TileButton } from '@/components/app/ui/list/tile'
import { TextInput } from '@/components/app/ui/TextInput'
import type { FocalPoint } from '@/components/app/ui/FocalPointPicker'

type LibraryItem = { assetId: string; url: string; thumbUrl: string; name?: string; alt: Record<string, string>; focal: FocalPoint | null; tags?: string[] }

export type MediaLibraryPickerProps = {
  projectSlug: string
  scope: MediaScope
  defaultLocale: string
  /** Asset ids already in the gallery — hidden from the picker. */
  exclude: string[]
  /** How many more photos fit; undefined = no limit. */
  room?: number
  onClose: () => void
  /** The chosen photos, in the order they were tapped. */
  onAdd: (photos: AddedPhoto[]) => void
}

/**
 * Pick several photos from the Media Library: search (name, description,
 * title, caption — any language) and tag filter, newest first, photos already
 * in the gallery hidden, tap to toggle, and a sticky "Add N photos" button.
 */
export function MediaLibraryPicker({ projectSlug, scope, defaultLocale, exclude, room, onClose, onAdd }: MediaLibraryPickerProps) {
  const t = useTranslations('clientDashboard.media.picker')
  const titleId = useId()
  const searchId = useId()
  const [items, setItems] = useState<LibraryItem[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [picked, setPicked] = useState<LibraryItem[]>([])
  const closeRef = useRef<HTMLButtonElement>(null)
  const req = useRef(0)
  const hidden = useMemo(() => new Set(exclude), [exclude])

  const load = useCallback(
    async (from: string | null, search: string, tf: string[]) => {
      const n = ++req.current
      setState('loading')
      try {
        const r = await mediaApi(scope).list({ projectSlug, cursor: from, q: search || null, tags: tf.length ? tf : null })
        if (n !== req.current) return
        if (!r.ok) return setState('error')
        setItems((prev) => (from ? [...prev, ...r.items] : r.items))
        setTags(r.tags)
        setCursor(r.nextCursor)
        setState('ready')
      } catch {
        if (n === req.current) setState('error')
      }
    },
    [projectSlug, scope]
  )

  useEffect(() => {
    const id = setTimeout(() => setQ(query.trim()), 300)
    return () => clearTimeout(id)
  }, [query])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- (re)load when the filters change
    void load(null, q, tagFilter)
  }, [load, q, tagFilter])
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const visible = items.filter((i) => !hidden.has(i.assetId))
  const isPicked = (id: string) => picked.some((p) => p.assetId === id)
  const atLimit = room !== undefined && picked.length >= room
  const toggle = (item: LibraryItem) =>
    setPicked((p) => (p.some((x) => x.assetId === item.assetId) ? p.filter((x) => x.assetId !== item.assetId) : atLimit ? p : [...p, item]))

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="flex h-[92dvh] w-full max-w-3xl flex-col rounded-t-2xl border border-border bg-background sm:h-[85vh] sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2">
          <h2 id={titleId} className="text-lg font-semibold text-foreground">
            {t('title')}
          </h2>
          <IconButton ref={closeRef} onClick={onClose} aria-label={t('close')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </IconButton>
        </div>

        <div className="flex flex-col gap-3 border-b border-border-subtle px-4 py-3">
          <label htmlFor={searchId} className="sr-only">
            {t('search')}
          </label>
          <TextInput
            id={searchId}
            flush
            controlSize="md"
            type="search"
            value={query}
            maxLength={80}
            placeholder={t('searchPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
          />
          {tags.length > 0 && (
            <div role="group" aria-label={t('tags')} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {tags.map((tag) => {
                const on = tagFilter.includes(tag)
                return (
                  <Chip key={tag} selected={on} onClick={() => setTagFilter((f) => (on ? f.filter((x) => x !== tag) : f.length >= 10 ? f : [...f, tag]))}>
                    {tag}
                  </Chip>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {state === 'error' && <p className="text-sm text-destructive">{t('error')}</p>}
          {state === 'ready' && !visible.length && (
            <p className="text-sm text-muted-foreground">{q || tagFilter.length ? t('noResults') : items.length ? t('allInGallery') : t('empty')}</p>
          )}
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {visible.map((item, i) => {
              const on = isPicked(item.assetId)
              const name = item.alt[defaultLocale] || Object.values(item.alt)[0] || t('photoN', { n: i + 1 })
              return (
                <li key={item.assetId} className="relative">
                  <TileButton
                    aria-pressed={on}
                    disabled={!on && atLimit}
                    onClick={() => toggle(item)}
                    aria-label={t('pick', { name })}
                    framed
                    selected={on}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- Sanity CDN thumbnail */}
                    <img src={item.thumbUrl} alt="" width="240" height="240" loading="lazy" className="size-full object-cover" />
                  </TileButton>
                  {on && (
                    <TileBadge className="absolute top-1.5 left-1.5">{picked.findIndex((p) => p.assetId === item.assetId) + 1}</TileBadge>
                  )}
                </li>
              )
            })}
          </ul>
          {state === 'loading' && <p className="mt-3 text-sm text-muted-foreground">{t('loading')}</p>}
          {state === 'ready' && cursor && (
            <Button fullWidth className="mt-4" onClick={() => void load(cursor, q, tagFilter)}>
              {t('more')}
            </Button>
          )}
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border-subtle bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p className="text-sm text-muted-foreground">{atLimit ? t('full') : t('selected', { count: picked.length })}</p>
          <Button
            variant="primary"
            disabled={!picked.length}
            onClick={() =>
              onAdd(
                picked.map((p) => ({ assetId: p.assetId, url: p.url, thumbUrl: thumbOf(p.url), name: p.name ?? '', alt: p.alt, focal: p.focal, tags: p.tags ?? [] }))
              )
            }
          >
            {t('add', { count: picked.length })}
          </Button>
        </div>
      </div>
    </div>
  )
}
