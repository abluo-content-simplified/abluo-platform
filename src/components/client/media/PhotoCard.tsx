'use client'

import { normaliseInternalTag, type TagCount } from '@/lib/tags/internal-tags'
import { addTags, editorCounts, editorOffers } from '@/lib/tags/tag-editor-model'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Chip } from '@/components/app/ui/Chip'
import { FieldLabel } from '@/components/app/ui/FieldLabel'
import { Notice } from '@/components/app/ui/Notice'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { TextArea, TextInput } from '@/components/app/ui/TextInput'
import { FocalPointPicker, type FocalPoint } from '@/components/app/ui/FocalPointPicker'
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
  tagCounts,
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
  /** The same with how many photos use each (most-used chips, ranking); wins over `tagSuggestions`. */
  tagCounts?: readonly TagCount[]
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
  const [loaded, setLoaded] = useState<{ names: string[]; counts: TagCount[] } | null>(null)
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
    if (tagSuggestions || tagCounts || loaded) return
    setLoaded({ names: [], counts: [] })
    mediaApi(scope)
      .list({ projectSlug })
      .then((r) => {
        if (alive.current && r.ok) setLoaded({ names: r.tags, counts: r.tagCounts ?? [] })
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
          <SegmentedControl
            label={t('languages')}
            appearance="soft"
            value={lang}
            onChange={(l) => {
              blur()
              setLang(l)
            }}
            options={languages.map((l) => {
              const missing = photoLanguageMissing({ alt, caption }, l, dl)
              return {
                value: l,
                label: (
                  <>
                    <span className="sr-only">{missing ? t('languageMissing', { language: lname(l) }) : lname(l)}</span>
                    <span aria-hidden="true" className="relative inline-block font-semibold tracking-wide uppercase">
                      {l}
                      {missing ? <span className="absolute -top-1 -right-2 size-1.5 rounded-full bg-action" /> : null}
                    </span>
                  </>
                ),
              }
            })}
          />
        ) : (
          <span />
        )}
        <p role="status" aria-live="polite" className={`min-h-5 pt-3 text-right text-sm ${status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>
          {statusText}
        </p>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div id={`${uid}-panel`} className="flex flex-col gap-6">
        {/* Name — the same in every language. */}
        <div>
          <FieldLabel htmlFor={`${uid}-name`} hintId={`${uid}-name-help`} hint={multilingual ? t('name.helperShared') : t('name.helper')}>
            {t('name.label')}
          </FieldLabel>
          <TextInput
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
          suggestions={tagSuggestions ?? loaded?.names ?? []}
          counts={tagCounts ?? loaded?.counts}
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

/** Normalises one tag the way the server does (cleanTags): the internal-tag rule (lib/tag-text). */
export function normaliseTag(raw: string): string {
  return normaliseInternalTag(raw)
}

/**
 * Tags as removable chips and a box that adds as you type (Enter or comma).
 * Under it: the most used tags of this list while the box is empty (tap to
 * add), and matching tags while typing (accents and case ignored, tags that
 * start with the text first). Typing a tag that already exists in another
 * case or spelling with accents uses the existing one. `counts` (tag →
 * number of items) ranks them; without it `suggestions` is used in order.
 */
export function TagEditor({
  id,
  tags,
  suggestions,
  counts,
  labels,
  onChange,
  onFocus,
}: {
  id: string
  tags: string[]
  suggestions: readonly string[]
  counts?: readonly TagCount[]
  labels: { label: string; helper: string; placeholder: string; add: string; remove: (tag: string) => string; suggested: string; full: string }
  onChange: (tags: string[]) => void
  onFocus?: () => void
}) {
  const [draft, setDraft] = useState('')
  const full = tags.length >= PHOTO_CARD_MAX.tags
  const known = editorCounts(counts, suggestions)
  const add = (raw: string) => {
    const next = addTags(tags, [raw], known, PHOTO_CARD_MAX.tags)
    if (next !== tags) onChange(next)
    if (normaliseTag(raw)) setDraft('')
  }
  const offered = editorOffers(tags, known, draft, PHOTO_CARD_MAX.tags)
  return (
    <div>
      <FieldLabel htmlFor={id} hint={labels.helper}>
        {labels.label}
      </FieldLabel>
      {tags.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li key={tag}>
              <Chip selected removable aria-label={labels.remove(tag)} onClick={() => onChange(tags.filter((x) => x !== tag))}>
                {tag}
              </Chip>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex gap-2">
        <TextInput
          id={id}
          flush
          controlSize="md"
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
              const next = addTags(tags, parts, known, PHOTO_CARD_MAX.tags)
              if (next !== tags) onChange(next)
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
        />
        <Chip onClick={() => add(draft)} disabled={full || !draft.trim()}>
          {labels.add}
        </Chip>
      </div>
      {offered.length > 0 && !full && (
        <div className="mt-2">
          <p className="text-xs text-muted-foreground">{labels.suggested}</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {offered.map((s) => (
              <li key={s}>
                <Chip onClick={() => add(s)}>+ {s}</Chip>
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
      <FieldLabel htmlFor={id} hintId={`${id}-help`} hint={helper}>
        {label}
      </FieldLabel>
      {source ? (
        <div id={`${id}-src`} className="mt-2 rounded-xl bg-muted px-4 py-3">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{source.label}</p>
          <p lang={source.lang} className="mt-1 text-[0.9375rem] leading-6 break-words text-foreground">
            {source.text}
          </p>
        </div>
      ) : null}
      <TextArea
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
