'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { FocalPointPicker, type FocalPoint } from '@/components/client/media/FocalPointPicker'
import { languageName } from '@/components/client/create/StepHeading'
import { mediaApi, type MediaScope } from '@/components/client/media/media-api'

/** Limits mirror PHOTO_LIMITS (server module, not importable here). */
export const PHOTO_CARD_MAX = { name: 120, alt: 200, caption: 300, tags: 10, tag: 40 } as const
const SAVE_DEBOUNCE_MS = 800

type Texts = Record<string, string>
type Field = 'name' | 'alt' | 'caption' | 'focal' | 'tags'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed'

/** One photo as the card edits it (a Media Library asset). */
export type CardPhoto = {
  assetId: string
  /** The asset revision ('' = not known yet; the save then goes unguarded). */
  rev: string
  url: string
  /** Not translated. '' = no name yet (camera file names start empty). */
  name?: string
  alt: Texts
  caption?: Texts
  tags?: string[]
  focal: FocalPoint | null
  missing?: boolean
}

export type CardChange = { assetId: string; rev?: string; name?: string; alt?: Texts; caption?: Texts; tags?: string[]; focal?: FocalPoint | null }

/** A language still to do on this photo: no description, or the main caption not carried over. */
export function photoLanguageMissing(photo: Pick<CardPhoto, 'alt' | 'caption'>, locale: string, defaultLocale: string): boolean {
  if (!photo.alt?.[locale]?.trim()) return true
  return Boolean(photo.caption?.[defaultLocale]?.trim()) && !photo.caption?.[locale]?.trim()
}

/**
 * The one photo card (Tom, wave B) — the gallery's and the media wizard's
 * describe steps and the Media page's edit sheet all show this:
 *   language tabs (multilingual sites; a dot = still to do) ·
 *   Name (not translated) · focus point + Description · Tags (not translated) ·
 *   Caption (optional).
 * On another language's tab the main language's text sits read-only above
 * each field, like the blog's Languages step. Nothing here is required:
 * descriptions can come later.
 *
 * Saved on the Media Library asset (debounced, revision-chained, flushed when
 * the card goes away). `onChange` reports each edit at once and each save
 * (with the new revision); `onSaving` hands over every save in flight.
 */
export function PhotoCard({
  projectSlug,
  scope,
  site,
  photo,
  onChange,
  onSaving,
  tagSuggestions,
  autoFocus = false,
}: {
  projectSlug: string
  scope: MediaScope
  /** Site languages; `languages` includes the main one. */
  site: { defaultLocale: string; languages: readonly string[] }
  photo: CardPhoto
  onChange: (change: CardChange) => void
  onSaving: (job: Promise<unknown>) => void
  /** This site's tags, when the caller already has them (else fetched on first use). */
  tagSuggestions?: readonly string[]
  /** Focus the name when the card opens. */
  autoFocus?: boolean
}) {
  const t = useTranslations('clientDashboard.photoCard')
  const ui = useLocale()
  const uid = useId()
  const dl = site.defaultLocale
  const languages = [dl, ...site.languages.filter((l) => l !== dl)]
  const multilingual = languages.length > 1

  const [lang, setLang] = useState(dl)
  const [name, setName] = useState(photo.name ?? '')
  const [alt, setAlt] = useState<Texts>(photo.alt)
  const [caption, setCaption] = useState<Texts>(photo.caption ?? {})
  const [focal, setFocal] = useState<FocalPoint | null>(photo.focal)
  const [tags, setTags] = useState<string[]>(photo.tags ?? [])
  const [loaded, setLoaded] = useState<string[] | null>(null)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  // Latest values + dirty fields for the debounced, serialized save.
  const latest = useRef({ name, alt, caption, focal, tags })
  useEffect(() => {
    latest.current = { name, alt, caption, focal, tags }
  }, [name, alt, caption, focal, tags])
  const dirty = useRef(new Set<Field>())
  const rev = useRef(photo.rev)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const saveNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (!dirty.current.size) return
    const fields = new Set(dirty.current)
    dirty.current.clear()
    if (alive.current) setStatus('saving')
    const job = async () => {
      const v = latest.current
      const r = await mediaApi(scope).update({
        projectSlug,
        assetId: photo.assetId,
        rev: rev.current || undefined,
        ...(fields.has('name') && { name: v.name.trim().replace(/\s+/g, ' ') }),
        ...(fields.has('alt') && { alt: cleanTexts(v.alt, PHOTO_CARD_MAX.alt) }),
        ...(fields.has('caption') && { caption: cleanTexts(v.caption, PHOTO_CARD_MAX.caption) }),
        ...(fields.has('focal') && v.focal && { focal: v.focal }),
        ...(fields.has('tags') && { tags: v.tags }),
      })
      if (!r.ok) {
        for (const f of fields) dirty.current.add(f) // try again with the next change
        if (alive.current) {
          setStatus('failed')
          setError(t(`errors.${['conflict', 'not_found', 'invalid_value'].includes(r.error) ? r.error : 'generic'}`))
        }
        return
      }
      rev.current = r.rev
      // Newer typing is still queued: keep the caller's copy of it, adopt only the revision.
      onChange(
        dirty.current.size
          ? { assetId: photo.assetId, rev: r.rev }
          : { assetId: photo.assetId, rev: r.rev, name: r.photo.name, alt: r.photo.alt, caption: r.photo.caption, focal: r.photo.focal, tags: r.photo.tags }
      )
      if (alive.current) {
        setError(null)
        setStatus(dirty.current.size ? 'saving' : 'saved')
      }
    }
    queue.current = queue.current.then(job, job).catch(() => alive.current && setStatus('failed'))
    onSaving(queue.current)
  }, [projectSlug, photo.assetId, onChange, onSaving, t, scope])

  const schedule = (field: Field) => {
    dirty.current.add(field)
    setStatus('saving')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(saveNow, SAVE_DEBOUNCE_MS)
  }

  // Leaving the photo (next photo, Back, Close) never loses typing.
  const saveRef = useRef(saveNow)
  useEffect(() => {
    saveRef.current = saveNow
  }, [saveNow])
  useEffect(() => () => saveRef.current(), [])

  const blur = () => timer.current && saveNow()

  const changeName = (value: string) => {
    setName(value)
    onChange({ assetId: photo.assetId, name: value })
    schedule('name')
  }
  const changeText = (field: 'alt' | 'caption', value: string) => {
    const current = field === 'alt' ? alt : caption
    const next = { ...current, [lang]: value }
    if (field === 'alt') setAlt(next)
    else setCaption(next)
    onChange({ assetId: photo.assetId, [field]: next })
    schedule(field)
  }
  const changeTags = (next: string[]) => {
    setTags(next)
    onChange({ assetId: photo.assetId, tags: next })
    schedule('tags')
  }
  const changeFocal = (p: FocalPoint) => {
    setFocal(p)
    onChange({ assetId: photo.assetId, focal: p })
    schedule('focal')
  }

  /** This site's tags only, fetched once when the tag box is first used. */
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

  const onMain = lang === dl
  const statusText = status === 'idle' ? '' : t(`status.${status}`)
  const lname = (l: string) => languageName(l, ui)
  const focalLabels = {
    title: t('focal.title'),
    helper: t('focal.helper'),
    keys: t('focal.keys'),
    label: t('focal.label'),
    valueText: (x: number, y: number) => t('focal.valueText', { x, y }),
    previews: t('focal.previews'),
    preview: { wide: t('focal.preview.wide'), card: t('focal.preview.card'), square: t('focal.preview.square'), tall: t('focal.preview.tall') },
  }
  const inLang = (label: string) => (multilingual ? `${label} · ${lname(lang)}` : label)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        {multilingual ? (
          <div role="tablist" aria-label={t('languages')} className="inline-flex rounded-full border border-border bg-muted p-1">
            {languages.map((l) => {
              const on = l === lang
              const missing = photoLanguageMissing({ alt, caption }, l, dl)
              return (
                <button
                  key={l}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls={`${uid}-panel`}
                  aria-label={missing ? t('languageMissing', { language: lname(l) }) : lname(l)}
                  onClick={() => {
                    blur()
                    setLang(l)
                  }}
                  className={`relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-3 text-sm font-semibold tracking-wide uppercase focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                    on ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {l}
                  {missing ? <span aria-hidden="true" className="absolute top-2 right-1.5 size-1.5 rounded-full bg-action" /> : null}
                </button>
              )
            })}
          </div>
        ) : (
          <span />
        )}
        <p role="status" aria-live="polite" className={`min-h-5 pt-3 text-right text-sm ${status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>
          {statusText}
        </p>
      </div>
      {error ? (
        <p role="alert" className="rounded-xl bg-muted p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div id={`${uid}-panel`} role={multilingual ? 'tabpanel' : undefined} className="flex flex-col gap-6">
        {/* Name — the same in every language. */}
        <div>
          <label htmlFor={`${uid}-name`} className="block text-[0.9375rem] font-medium text-foreground">
            {t('name.label')}
          </label>
          <p id={`${uid}-name-help`} className="mt-1 text-sm leading-6 text-muted-foreground">
            {multilingual ? t('name.helperShared') : t('name.helper')}
          </p>
          <input
            id={`${uid}-name`}
            type="text"
            value={name}
            maxLength={PHOTO_CARD_MAX.name}
            autoFocus={autoFocus}
            autoComplete="off"
            placeholder={t('name.placeholder')}
            aria-describedby={`${uid}-name-help`}
            onChange={(e) => changeName(e.target.value)}
            onBlur={blur}
            className="mt-2 block min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        </div>

        {/* Focus point, then the description (as in the blog's CoverStep). */}
        {photo.url && !photo.missing ? (
          <FocalPointPicker url={photo.url} alt={alt[dl] ?? name} point={focal} compact onChange={changeFocal} onCommit={blur} labels={focalLabels} />
        ) : (
          <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">{t('missing')}</p>
        )}

        <TextField
          id={`${uid}-alt-${lang}`}
          label={inLang(t('alt.label'))}
          helper={onMain ? t('alt.helper') : undefined}
          source={onMain ? null : { label: t('source', { language: lname(dl) }), lang: dl, text: alt[dl]?.trim() || t('sourceEmpty') }}
          value={alt[lang] ?? ''}
          max={PHOTO_CARD_MAX.alt}
          rows={2}
          lang={lang}
          placeholder={t('alt.placeholder')}
          onChange={(v) => changeText('alt', v)}
          onBlur={blur}
          countLabel={(n) => t('count', { count: n, max: PHOTO_CARD_MAX.alt })}
        />

        {/* Tags — the same in every language. */}
        <TagEditor
          id={`${uid}-tags`}
          tags={tags}
          suggestions={tagSuggestions ?? loaded ?? []}
          onFocus={loadSuggestions}
          labels={{
            label: t('tags.label'),
            helper: t('tags.helper'),
            placeholder: t('tags.placeholder'),
            add: t('tags.add'),
            remove: (tag) => t('tags.remove', { tag }),
            suggested: t('tags.suggested'),
            full: t('tags.full', { max: PHOTO_CARD_MAX.tags }),
          }}
          onChange={changeTags}
        />

        <TextField
          id={`${uid}-caption-${lang}`}
          label={inLang(t('caption.label'))}
          helper={onMain ? t('caption.helper') : undefined}
          source={
            onMain || !caption[dl]?.trim() ? null : { label: t('source', { language: lname(dl) }), lang: dl, text: caption[dl] }
          }
          value={caption[lang] ?? ''}
          max={PHOTO_CARD_MAX.caption}
          rows={2}
          lang={lang}
          onChange={(v) => changeText('caption', v)}
          onBlur={blur}
          countLabel={(n) => t('count', { count: n, max: PHOTO_CARD_MAX.caption })}
        />
      </div>
    </div>
  )
}

/** Normalises one tag the way the server does (cleanTags). */
export function normaliseTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, PHOTO_CARD_MAX.tag)
}

/**
 * Tags as removable chips and a box that adds as you type (Enter or comma),
 * with suggestions from this site's own tags, filtered by what is typed.
 */
export function TagEditor({
  id,
  tags,
  suggestions,
  labels,
  onChange,
  onFocus,
}: {
  id: string
  tags: string[]
  suggestions: readonly string[]
  labels: { label: string; helper: string; placeholder: string; add: string; remove: (tag: string) => string; suggested: string; full: string }
  onChange: (tags: string[]) => void
  onFocus?: () => void
}) {
  const [draft, setDraft] = useState('')
  const full = tags.length >= PHOTO_CARD_MAX.tags
  const add = (raw: string) => {
    const tag = normaliseTag(raw)
    if (!tag || tags.includes(tag) || full) return
    onChange([...tags, tag])
    setDraft('')
  }
  const q = normaliseTag(draft)
  const offered = q ? suggestions.filter((s) => !tags.includes(s) && s.includes(q)).slice(0, 6) : []
  return (
    <div>
      <label htmlFor={id} className="block text-[0.9375rem] font-medium text-foreground">
        {labels.label}
      </label>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{labels.helper}</p>
      {tags.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                onClick={() => onChange(tags.filter((x) => x !== tag))}
                aria-label={labels.remove(tag)}
                className="inline-flex min-h-11 items-center gap-1 rounded-full border border-ring bg-selected-tint px-3 text-sm font-medium text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {tag}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M7 7l10 10M17 7L7 17" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex gap-2">
        <input
          id={id}
          type="text"
          value={draft}
          maxLength={PHOTO_CARD_MAX.tag}
          disabled={full}
          autoComplete="off"
          enterKeyHint="done"
          placeholder={full ? labels.full : labels.placeholder}
          onFocus={onFocus}
          onChange={(e) => {
            const v = e.target.value
            // Typing a comma adds what came before it (phones have no reliable Enter).
            if (v.includes(',')) {
              const parts = v.split(',')
              const rest = parts.pop() ?? ''
              const next = [...tags]
              for (const p of parts) {
                const tag = normaliseTag(p)
                if (tag && !next.includes(tag) && next.length < PHOTO_CARD_MAX.tags) next.push(tag)
              }
              if (next.length !== tags.length) onChange(next)
              setDraft(rest)
              return
            }
            setDraft(v)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(draft)
            }
          }}
          className="block min-h-11 w-full rounded-full border border-border bg-background px-4 text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => add(draft)}
          disabled={full || !draft.trim()}
          className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-border bg-background px-4 text-[0.9375rem] font-medium text-foreground enabled:hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
        >
          {labels.add}
        </button>
      </div>
      {offered.length > 0 && !full && (
        <div className="mt-2">
          <p className="text-xs text-muted-foreground">{labels.suggested}</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {offered.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => add(s)}
                  className="inline-flex min-h-11 items-center rounded-full border border-border bg-background px-3 text-sm text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  + {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function TextField({
  id,
  label,
  helper,
  source,
  value,
  max,
  rows = 1,
  lang,
  placeholder,
  onChange,
  onBlur,
  countLabel,
}: {
  id: string
  label: string
  helper?: string
  /** Another language's tab: the main language's text, read-only, above the field. */
  source?: { label: string; lang: string; text: string } | null
  value: string
  max: number
  rows?: number
  lang?: string
  placeholder?: string
  onChange: (v: string) => void
  onBlur?: () => void
  countLabel: (n: number) => string
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-[0.9375rem] font-medium text-foreground">
        {label}
      </label>
      {helper ? (
        <p id={`${id}-help`} className="mt-1 text-sm leading-6 text-muted-foreground">
          {helper}
        </p>
      ) : null}
      {source ? (
        <div id={`${id}-src`} className="mt-2 rounded-xl bg-muted px-4 py-3">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{source.label}</p>
          <p lang={source.lang} className="mt-1 text-[0.9375rem] leading-6 break-words text-foreground">
            {source.text}
          </p>
        </div>
      ) : null}
      <textarea
        id={id}
        rows={rows}
        lang={lang}
        value={value}
        maxLength={max}
        placeholder={placeholder}
        aria-describedby={[helper && `${id}-help`, source && `${id}-src`].filter(Boolean).join(' ') || undefined}
        onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
        onChange={(e) => onChange(e.target.value.replace(/\n/g, ' '))}
        onBlur={onBlur}
        className="mt-2 block min-h-11 w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-base leading-6 text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
      <div className="mt-1 flex items-start justify-end gap-3 text-xs">
        <span className="text-muted-foreground" aria-hidden="true">
          {countLabel(value.length)}
        </span>
      </div>
    </div>
  )
}

function cleanTexts(texts: Texts, max: number): Texts {
  const out: Texts = {}
  for (const [l, v] of Object.entries(texts)) {
    const text = (v ?? '').trim().replace(/\s+/g, ' ')
    if (text) out[l] = text.slice(0, max)
  }
  return out
}
