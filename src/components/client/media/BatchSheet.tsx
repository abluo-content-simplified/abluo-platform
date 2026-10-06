'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { mediaApi, type MediaScope } from '@/components/client/media/media-api'
import { PHOTO_CARD_MAX, TagEditor, type CardChange } from '@/components/client/media/PhotoCard'

export type BatchMode = 'all' | 'rename' | 'tags'

/** Server limit per batch (PHOTO_LIMITS.batch). */
export const BATCH_MAX = 100

/**
 * "Name and tag all" (Tom, wave B) — one sheet for many photos: a base name
 * ("Summer party" → Summer party 1, 2, 3…) and/or tags added to each. Shown
 * after two or more photos are uploaded in one go (mode "all", skippable),
 * and from the Media page's selection bar ("rename" or "tags"). Names and
 * tags are not translated. The server checks every photo on its own.
 */
export function BatchSheet({
  projectSlug,
  scope,
  assetIds,
  mode,
  thumbs = [],
  tagSuggestions,
  onDone,
  onClose,
}: {
  projectSlug: string
  scope: MediaScope
  /** In order; the numbers follow it. At most BATCH_MAX. */
  assetIds: readonly string[]
  mode: BatchMode
  /** A few thumbnails to show which photos these are. */
  thumbs?: readonly string[]
  tagSuggestions?: readonly string[]
  /** Saved: the photos as they are now (only those the server accepted). */
  onDone: (changes: CardChange[], skipped: number) => void
  /** Skip / close without saving. */
  onClose: () => void
}) {
  const t = useTranslations('clientDashboard.photoBatch')
  const tc = useTranslations('clientDashboard.photoCard')
  const uid = useId()
  const [base, setBase] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [loaded, setLoaded] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstRef = useRef<HTMLInputElement>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    firstRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const count = Math.min(assetIds.length, BATCH_MAX)
  const name = base.trim().replace(/\s+/g, ' ')
  const showName = mode !== 'tags'
  const showTags = mode !== 'rename'
  const ready = (showName && name.length > 0) || (showTags && tags.length > 0)

  const loadSuggestions = () => {
    if (tagSuggestions || loaded) return
    setLoaded([])
    mediaApi(scope)
      .list({ projectSlug })
      .then((r) => {
        if (alive.current && r.ok) setLoaded(r.tags)
      })
      .catch(() => undefined)
  }

  const apply = async () => {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await mediaApi(scope).batch({
        projectSlug,
        assetIds: assetIds.slice(0, BATCH_MAX),
        ...(showName && name && { baseName: name }),
        ...(showTags && tags.length && { addTags: tags }),
      })
      if (!r.ok) {
        setError(t(`errors.${r.error === 'conflict' ? 'conflict' : 'generic'}`))
        return
      }
      const changes: CardChange[] = []
      let skipped = 0
      for (const x of r.results) {
        if (!x.ok) skipped += 1
        else changes.push({ assetId: x.assetId, rev: x.rev, ...(showName && name && { name: x.name }), ...(showTags && tags.length && { tags: x.tags }) })
      }
      onDone(changes, skipped)
    } catch {
      setError(t('errors.generic'))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const title = mode === 'rename' ? t('renameTitle', { count }) : mode === 'tags' ? t('tagsTitle', { count }) : t('allTitle', { count })

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay sm:items-center" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-2xl border border-border bg-background sm:rounded-2xl"
      >
        <div className="flex-1 overflow-y-auto px-4 pt-5 pb-4">
          <h2 id={`${uid}-title`} className="text-[1.375rem] leading-8 font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <p className="mt-2 text-[0.9375rem] leading-6 text-muted-foreground">{mode === 'all' ? t('allHelper') : t('helper')}</p>

          {thumbs.length > 0 && (
            <ul className="mt-4 flex gap-2 overflow-x-auto pb-1" aria-hidden="true">
              {thumbs.slice(0, 12).map((src, i) => (
                <li key={`${src}-${i}`} className="size-14 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element -- Sanity CDN thumbnail */}
                  <img src={src} alt="" width="56" height="56" className="size-full object-cover" />
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 flex flex-col gap-6">
            {showName ? (
              <div>
                <label htmlFor={`${uid}-base`} className="block text-[0.9375rem] font-medium text-foreground">
                  {t('baseName.label')}
                </label>
                <p id={`${uid}-base-help`} className="mt-1 text-sm leading-6 text-muted-foreground">
                  {name ? t('baseName.preview', { first: `${name} 1`, second: `${name} 2` }) : t('baseName.helper')}
                </p>
                <input
                  id={`${uid}-base`}
                  ref={firstRef}
                  type="text"
                  value={base}
                  maxLength={PHOTO_CARD_MAX.name - 4}
                  autoComplete="off"
                  placeholder={t('baseName.placeholder')}
                  aria-describedby={`${uid}-base-help`}
                  onChange={(e) => setBase(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void apply()
                    }
                  }}
                  className="mt-2 block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                />
              </div>
            ) : null}
            {showTags ? (
              <TagEditor
                id={`${uid}-tags`}
                tags={tags}
                suggestions={tagSuggestions ?? loaded ?? []}
                onFocus={loadSuggestions}
                labels={{
                  label: tc('tags.label'),
                  helper: t('tagsHelper'),
                  placeholder: tc('tags.placeholder'),
                  add: tc('tags.add'),
                  remove: (tag) => tc('tags.remove', { tag }),
                  suggested: tc('tags.suggested'),
                  full: tc('tags.full', { max: PHOTO_CARD_MAX.tags }),
                }}
                onChange={setTags}
              />
            ) : null}
          </div>
          {assetIds.length > BATCH_MAX ? <p className="mt-4 text-sm text-muted-foreground">{t('capped', { max: BATCH_MAX })}</p> : null}
          <p role={error ? 'alert' : undefined} className="mt-3 min-h-5 text-sm text-destructive">
            {error}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex min-h-11 items-center rounded-full px-4 text-[0.9375rem] font-medium text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
          >
            {mode === 'all' ? t('skip') : t('cancel')}
          </button>
          <button
            type="button"
            onClick={() => void apply()}
            disabled={!ready || busy}
            className="inline-flex min-h-11 items-center rounded-full bg-action px-5 text-[0.9375rem] font-semibold text-action-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
          >
            {busy ? t('saving') : t('apply', { count })}
          </button>
        </div>
      </div>
    </div>
  )
}
