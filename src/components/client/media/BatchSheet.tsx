'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { FieldLabel } from '@/components/app/ui/FieldLabel'
import { TextInput } from '@/components/app/ui/TextInput'
import { mediaApi, type MediaScope } from '@/components/client/media/media-api'
import type { TagCount } from '@/lib/tags/internal-tags'
import { PHOTO_CARD_MAX, TagEditor, type CardChange } from '@/components/client/media/PhotoCard'

export type BatchMode = 'all' | 'rename' | 'tags' | 'describe'

/** Server limit per batch (PHOTO_LIMITS.batch). */
export const BATCH_MAX = 100

/**
 * "Name and tag all" (Tom, wave B) — one sheet for many photos: a base name
 * ("Summer party" → Summer party 1, 2, 3…) and/or tags added to each. Shown
 * after two or more photos are uploaded in one go (mode "all", skippable),
 * and from the Media page's selection bar ("rename", "tags" or "describe").
 * Names and tags are not translated. "describe" (Tom, 2026-10-22) writes one
 * description per site language onto every photo, replacing what each had —
 * the sheet says how many already had one. The server checks every photo.
 */
export function BatchSheet({
  projectSlug,
  scope,
  assetIds,
  mode,
  thumbs = [],
  tagSuggestions,
  tagCounts,
  site,
  described = 0,
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
  /** The same with usage counts (most-used chips); wins over `tagSuggestions`. */
  tagCounts?: readonly TagCount[]
  /** "describe": the site's languages (main one first, required). */
  site?: { defaultLocale: string; locales: readonly string[] }
  /** "describe": how many of these photos already have a description (it will be replaced). */
  described?: number
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
  const [alt, setAlt] = useState<Record<string, string>>({})
  const viewerLocale = useLocale()
  const [loaded, setLoaded] = useState<{ names: string[]; counts: TagCount[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstRef = useRef<HTMLInputElement>(null)
  const altRef = useRef<HTMLInputElement>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    ;(mode === 'describe' ? altRef : firstRef).current?.focus()
  }, [mode])

  const count = Math.min(assetIds.length, BATCH_MAX)
  const name = base.trim().replace(/\s+/g, ' ')
  const describing = mode === 'describe'
  const showName = mode === 'all' || mode === 'rename'
  const showTags = mode === 'all' || mode === 'tags'
  const mainLocale = site?.defaultLocale ?? ''
  const otherLocales = (site?.locales ?? []).filter((l) => l !== mainLocale)
  const altOut = Object.fromEntries(
    Object.entries(alt)
      .map(([l, v]) => [l, v.trim().replace(/\s+/g, ' ')] as const)
      .filter(([, v]) => v.length > 0)
  )
  const ready = describing ? Boolean(mainLocale && altOut[mainLocale]) : (showName && name.length > 0) || (showTags && tags.length > 0)
  const languageName = (code: string) => {
    try {
      return new Intl.DisplayNames([viewerLocale], { type: 'language' }).of(code) ?? code
    } catch {
      return code
    }
  }

  const loadSuggestions = () => {
    if (tagSuggestions || tagCounts || loaded) return
    setLoaded({ names: [], counts: [] })
    mediaApi(scope)
      .list({ projectSlug })
      .then((r) => {
        if (alive.current && r.ok) setLoaded({ names: r.tags, counts: r.tagCounts ?? [] })
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
        ...(describing && { alt: altOut }),
      })
      if (!r.ok) {
        setError(t(`errors.${r.error === 'conflict' ? 'conflict' : 'generic'}`))
        return
      }
      const changes: CardChange[] = []
      let skipped = 0
      for (const x of r.results) {
        if (!x.ok) skipped += 1
        else
          changes.push({
            assetId: x.assetId,
            rev: x.rev,
            ...(showName && name && { name: x.name }),
            ...(showTags && tags.length && { tags: x.tags }),
            ...(describing && { alt: x.alt ?? altOut }),
          })
      }
      onDone(changes, skipped)
    } catch {
      setError(t('errors.generic'))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const title =
    mode === 'rename'
      ? t('renameTitle', { count })
      : mode === 'tags'
        ? t('tagsTitle', { count })
        : describing
          ? t('describeTitle', { count })
          : t('allTitle', { count })
  const helper = mode === 'all' ? t('allHelper') : describing ? t('describe.helper') : t('helper')

  return (
    <BottomSheet open title={title} onClose={() => !busy && onClose()} size="md">
      <div className="flex max-h-[75dvh] flex-col">
        <div className="flex-1 overflow-y-auto pb-4">
          <p className="mt-2 text-[0.9375rem] leading-6 text-muted-foreground">{helper}</p>

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
                <FieldLabel
                  htmlFor={`${uid}-base`}
                  hintId={`${uid}-base-help`}
                  hint={name ? t('baseName.preview', { first: `${name} 1`, second: `${name} 2` }) : t('baseName.helper')}
                >
                  {t('baseName.label')}
                </FieldLabel>
                <TextInput
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
                />
              </div>
            ) : null}
            {describing && mainLocale ? (
              <div className="flex flex-col gap-4">
                {[mainLocale, ...otherLocales].map((l, i) => (
                  <div key={l}>
                    <FieldLabel htmlFor={`${uid}-alt-${l}`}>
                      {i === 0 ? t('describe.label') : t('describe.inLanguage', { language: languageName(l) })}
                      {i === 0 && otherLocales.length > 0 ? <span className="text-muted-foreground"> · {languageName(l)}</span> : null}
                    </FieldLabel>
                    <TextInput
                      id={`${uid}-alt-${l}`}
                      ref={i === 0 ? altRef : undefined}
                      type="text"
                      value={alt[l] ?? ''}
                      maxLength={PHOTO_CARD_MAX.alt}
                      autoComplete="off"
                      placeholder={i === 0 ? t('describe.placeholder') : undefined}
                      onChange={(e) => setAlt((prev) => ({ ...prev, [l]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void apply()
                        }
                      }}
                    />
                    {i === 0 && otherLocales.length > 0 ? <p className="mt-2 text-sm text-muted-foreground">{t('describe.otherHelper')}</p> : null}
                  </div>
                ))}
                {described > 0 ? <p className="text-sm text-muted-foreground">{t('describe.replaces', { count: described, total: count })}</p> : null}
              </div>
            ) : null}
            {showTags ? (
              <TagEditor
                id={`${uid}-tags`}
                tags={tags}
                suggestions={tagSuggestions ?? loaded?.names ?? []}
                counts={tagCounts ?? loaded?.counts}
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

        <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-3">
          <Button variant="quiet" onClick={onClose} disabled={busy}>
            {mode === 'all' ? t('skip') : t('cancel')}
          </Button>
          <Button variant="primary" onClick={() => void apply()} disabled={!ready || busy}>
            {busy ? t('saving') : t('apply', { count })}
          </Button>
        </div>
      </div>
    </BottomSheet>
  )
}
