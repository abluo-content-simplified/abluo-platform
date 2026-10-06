'use client'

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { StepProps } from '@/components/client/create/types'
import {
  listProjectMediaAction,
  setPostCoverAction,
  uploadPostImageAction,
  type MediaActionError,
} from '@/app/[locale]/(client)/[tenant]/posts/media-actions'
import { formatBytes, planUpload } from '@/lib/client/upload-plan'

/** Matches `POST_MEDIA_LIMITS` in src/lib/api/post-media.ts (not imported: server-only module). */
const ALT_MAX = 200
const MAX_BYTES = 15 * 1024 * 1024
const SEARCH_MAX = 80
const ACCEPT = 'image/jpeg,image/png,image/webp'
/** Description / focal point autosave delay. */
const SAVE_DEBOUNCE_MS = 800

export type FocalPoint = { x: number; y: number }
export type CoverValue = { assetId: string; url: string; alt: Record<string, string>; focal?: FocalPoint | null }

export type CoverStepProps = StepProps & {
  /**
   * Set by the shell when "Next" was pressed while the cover has no
   * description in the default language (`coverNeedsAlt` from
   * `@/lib/client/cover-alt`). Shows `alt.neededToContinue` on the field and
   * focuses it.
   */
  altNeeded?: boolean
  /**
   * Local-only snapshot update, called on every description / focal change
   * (before the debounced write lands) so the shell's Next gating sees what
   * the person did. Must NOT queue autosave (`cover` is not an autosave path).
   */
  onCoverChange?: (cover: CoverValue | null) => void
  /** Legacy wiring — used only when `flush` / `onServerWrite` are not passed. */
  getRev?: () => string | null | Promise<string | null>
  onRevChange?: (newRev: string) => void
}

type Phase = 'idle' | 'preparing' | 'uploading' | 'saving'
type Notice = { kind: 'error' | 'status'; text: string } | null
type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed'
type LibraryItem = { assetId: string; url: string; thumbUrl: string; alt: Record<string, string>; focal: FocalPoint | null }

// ── Phone or computer: capability, not user agent ───────────────────────────

const COARSE = '(pointer: coarse)'
function subscribeDevice(onChange: () => void) {
  const m = window.matchMedia(COARSE)
  m.addEventListener('change', onChange)
  return () => m.removeEventListener('change', onChange)
}
function isTouchDevice() {
  return window.matchMedia(COARSE).matches && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
}
/** null during SSR / hydration, then true (phone/tablet) or false (computer). */
function useTouchDevice(): boolean | null {
  return useSyncExternalStore<boolean | null>(subscribeDevice, isTouchDevice, () => null)
}

/**
 * Create flow · step 6 "Add a cover image" (ADR-025). Choosing a photo —
 * uploaded (TinyPNG-optimised server-side, filed in the Media Library) or
 * picked from the library — makes it the cover at once. The description and
 * the focal point autosave as the person works. Skip / Next (and the "needs a
 * description" gate) live in the shell.
 */
export function CoverStep(props: CoverStepProps) {
  const { draft, site, altNeeded, flush, onServerWrite, onCoverChange, getRev, onRevChange } = props
  const t = useTranslations('clientDashboard.create.cover')
  const viewerLocale = useLocale()
  const uid = useId()
  const touch = useTouchDevice()
  const defaultLocale = site.defaultLocale
  const otherLocales = site.languages.filter((l) => l !== defaultLocale)

  const initial = (draft.cover as CoverValue | null | undefined) ?? null
  const [cover, setCover] = useState<CoverValue | null>(initial)
  const [alt, setAlt] = useState<Record<string, string>>(initial?.alt ?? {})
  const [focal, setFocal] = useState<FocalPoint | null>(initial?.focal ?? null)
  const [showOthers, setShowOthers] = useState(() => otherLocales.some((l) => initial?.alt?.[l]))
  const [phase, setPhase] = useState<Phase>('idle')
  const [notice, setNotice] = useState<Notice>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [lastEdited, setLastEdited] = useState<'alt' | 'focal'>('alt')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [dragging, setDragging] = useState(false)

  // Latest values for queued / debounced writes (they run after re-renders).
  const coverRef = useRef(cover)
  const altRef = useRef(alt)
  const focalRef = useRef(focal)
  const dirtyRef = useRef({ alt: false, focal: false })
  const revRef = useRef(draft.rev)
  useEffect(() => {
    revRef.current = draft.rev
  }, [draft.rev])
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragDepth = useRef(0)

  const cameraRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLInputElement>(null)
  const altFieldRef = useRef<HTMLTextAreaElement>(null)

  const busy = phase !== 'idle'
  const showNeeded = !!altNeeded && !!cover && !(alt[defaultLocale] ?? '').trim()

  useEffect(() => {
    if (showNeeded) altFieldRef.current?.focus()
  }, [showNeeded])

  const errorText = useCallback(
    (code: MediaActionError | 'heic' | 'generic') => {
      const known = ['unsupported_type', 'heic', 'too_large', 'conflict', 'forbidden', 'not_found', 'rate_limited']
      return t(`errors.${known.includes(code) ? code : 'generic'}`)
    },
    [t]
  )

  /** Runs cover writes one after another so each uses the previous one's rev. */
  const enqueue = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const run = queueRef.current.then(job, job)
    queueRef.current = run.catch(() => undefined)
    return run
  }, [])

  const currentRev = useCallback(async (): Promise<string | null> => {
    if (flush) return flush()
    if (getRev) return getRev()
    return revRef.current
  }, [flush, getRev])

  const report = useCallback(
    (rev: string, next: CoverValue | null) => {
      revRef.current = rev
      if (onServerWrite) onServerWrite({ rev, cover: next })
      else {
        onRevChange?.(rev)
        onCoverChange?.(next)
      }
    },
    [onServerWrite, onRevChange, onCoverChange]
  )

  /**
   * Writes the cover (or removes it). `focalValue` undefined = keep the
   * Media Library asset's focal point. Returns the saved cover, or undefined on failure.
   */
  const writeCover = useCallback(
    (target: { assetId: string; url: string } | null, altValue: Record<string, string>, focalValue?: FocalPoint) =>
      enqueue(async (): Promise<CoverValue | null | undefined> => {
        const rev = await currentRev()
        if (!rev) {
          setNotice({ kind: 'error', text: errorText('generic') })
          return undefined
        }
        try {
          const r = target
            ? await setPostCoverAction({
                projectSlug: site.projectSlug,
                id: draft.id,
                rev,
                assetId: target.assetId,
                alt: altValue,
                ...(focalValue && { focal: focalValue }),
              })
            : await setPostCoverAction({ projectSlug: site.projectSlug, id: draft.id, rev, remove: true })
          if (!r.ok) {
            setNotice({ kind: 'error', text: errorText(r.error) })
            return undefined
          }
          const next = target ? (r.cover ?? { ...target, alt: altValue, focal: focalValue ?? null }) : null
          report(r.rev, next)
          return next
        } catch {
          setNotice({ kind: 'error', text: errorText('generic') })
          return undefined
        }
      }),
    [enqueue, currentRev, site.projectSlug, draft.id, errorText, report]
  )

  /** Makes a photo the cover right away. */
  const applyCover = async (target: { assetId: string; url: string }, startAlt: Record<string, string>, message?: string) => {
    cancelPendingSave()
    setPhase('saving')
    const saved = await writeCover(target, startAlt)
    setPhase('idle')
    if (saved === undefined) return
    coverRef.current = saved
    altRef.current = saved?.alt ?? {}
    focalRef.current = saved?.focal ?? null
    setCover(saved)
    setAlt(saved?.alt ?? {})
    setFocal(saved?.focal ?? null)
    setSaveStatus('idle')
    setNotice({ kind: 'status', text: message ?? t('saved') })
    requestAnimationFrame(() => altFieldRef.current?.focus())
  }

  const handleFile = async (file: File | undefined) => {
    if (!file || busy) return
    setNotice(null)
    if (isHeic(file) && !(await canDecode(file))) return setNotice({ kind: 'error', text: errorText('heic') })
    if (file.size > MAX_BYTES * 3) return setNotice({ kind: 'error', text: errorText('too_large') })

    setPhase('preparing')
    const prepared = await prepareImage(file)
    if (!prepared || prepared.size > MAX_BYTES) {
      setPhase('idle')
      const code = !prepared ? (isHeic(file) ? 'heic' : 'unsupported_type') : 'too_large'
      return setNotice({ kind: 'error', text: errorText(code) })
    }

    setPhase('uploading')
    const form = new FormData()
    form.set('projectSlug', site.projectSlug)
    form.set('file', prepared)
    let uploaded: { assetId: string; url: string } | null = null
    let message: string | undefined
    try {
      const r = await uploadPostImageAction(form)
      if (!r.ok) setNotice({ kind: 'error', text: errorText(r.error) })
      else {
        uploaded = { assetId: r.assetId, url: r.url }
        // "Before" is the photo the person chose, even if the browser had to resize it.
        message = r.optimized
          ? t('optimised', { before: formatBytes(file.size, viewerLocale), after: formatBytes(r.bytesAfter, viewerLocale) })
          : t('notOptimised')
      }
    } catch {
      // A body over the server-action limit, or the network, lands here.
      setNotice({ kind: 'error', text: errorText('generic') })
    }
    setPhase('idle')
    if (uploaded) await applyCover(uploaded, {}, message)
  }

  const choose = (item: LibraryItem) => {
    setLibraryOpen(false)
    setNotice(null)
    // The library asset's own description (site languages only) is the starting
    // point; its focal point comes along on the server ("set once").
    const start = Object.fromEntries(
      site.languages.filter((l) => item.alt[l]?.trim()).map((l) => [l, item.alt[l].trim().slice(0, ALT_MAX)])
    )
    void applyCover({ assetId: item.assetId, url: item.url }, start)
  }

  const remove = async () => {
    setNotice(null)
    cancelPendingSave()
    setPhase('saving')
    const saved = await writeCover(null, {})
    setPhase('idle')
    if (saved === undefined) return
    coverRef.current = null
    altRef.current = {}
    focalRef.current = null
    setCover(null)
    setAlt({})
    setFocal(null)
    setSaveStatus('idle')
    setNotice({ kind: 'status', text: t('removed') })
  }

  // ── Autosave of description + focal point ─────────────────────────────────

  function cancelPendingSave() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = null
    dirtyRef.current = { alt: false, focal: false }
  }

  const saveNow = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = null
    const target = coverRef.current
    const dirty = dirtyRef.current
    if (!target || (!dirty.alt && !dirty.focal)) return
    dirtyRef.current = { alt: false, focal: false }
    const clean = cleanAlt(altRef.current)
    const point = dirty.focal ? (focalRef.current ?? undefined) : undefined
    setSaveStatus('saving')
    void writeCover({ assetId: target.assetId, url: target.url }, clean, point).then((saved) => {
      if (saved === undefined) {
        // Try again with the next change.
        dirtyRef.current = { alt: dirtyRef.current.alt || dirty.alt, focal: dirtyRef.current.focal || dirty.focal }
        return setSaveStatus('failed')
      }
      if (saved && coverRef.current?.assetId === saved.assetId) {
        coverRef.current = { ...coverRef.current, alt: saved.alt, focal: saved.focal ?? coverRef.current.focal }
      }
      const more = dirtyRef.current.alt || dirtyRef.current.focal
      setSaveStatus(more ? 'saving' : 'saved')
    })
  }, [writeCover])

  const schedule = (what: 'alt' | 'focal') => {
    dirtyRef.current = { ...dirtyRef.current, [what]: true }
    setLastEdited(what)
    setSaveStatus('saving')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(saveNow, SAVE_DEBOUNCE_MS)
  }

  const changeAlt = (locale: string, value: string) => {
    const next = { ...altRef.current, [locale]: value }
    altRef.current = next
    setAlt(next)
    const target = coverRef.current
    if (!target) return
    // Local snapshot at once (Next gating), server write after a pause.
    onCoverChange?.({ ...target, alt: cleanAlt(next), focal: focalRef.current })
    schedule('alt')
  }

  const changeFocal = (point: FocalPoint) => {
    focalRef.current = point
    setFocal(point)
    const target = coverRef.current
    if (!target) return
    onCoverChange?.({ ...target, alt: cleanAlt(altRef.current), focal: point })
    schedule('focal')
  }

  // Leaving the step never loses work: a pending save is sent now.
  const saveNowRef = useRef(saveNow)
  useEffect(() => {
    saveNowRef.current = saveNow
  }, [saveNow])
  useEffect(
    () => () => {
      if (debounceRef.current) saveNowRef.current()
    },
    []
  )

  // ── Drag and drop (computers) ─────────────────────────────────────────────

  const canDrop = touch === false && !busy
  const dragProps = canDrop
    ? {
        onDragEnter: (e: DragEvent) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          dragDepth.current += 1
          setDragging(true)
        },
        onDragOver: (e: DragEvent) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        },
        onDragLeave: () => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (!dragDepth.current) setDragging(false)
        },
        onDrop: (e: DragEvent) => {
          e.preventDefault()
          dragDepth.current = 0
          setDragging(false)
          void handleFile(e.dataTransfer.files?.[0])
        },
      }
    : {}

  const languageName = (code: string) => {
    try {
      return new Intl.DisplayNames([viewerLocale], { type: 'language' }).of(code) ?? code
    } catch {
      return code
    }
  }

  const onPicked = (input: HTMLInputElement) => {
    void handleFile(input.files?.[0])
    input.value = ''
  }

  const statusText = saveStatus === 'idle' ? '' : t(`altStatus.${saveStatus}`)

  return (
    <section
      aria-labelledby="cover-step-title"
      className={`relative -m-2 flex flex-col rounded-3xl p-2 transition-colors ${dragging ? 'bg-selected-tint ring-2 ring-ring' : ''}`}
      {...dragProps}
    >
      <h1 id="cover-step-title" className="text-[1.875rem] leading-9 font-semibold tracking-tight text-foreground">
        {t('title')}
      </h1>
      <p className="mt-3 text-[1.0625rem] leading-7 text-muted-foreground">{t('helper')}</p>

      <input ref={cameraRef} type="file" accept={ACCEPT} capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => onPicked(e.target)} />
      <input ref={pickerRef} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => onPicked(e.target)} />

      {dragging && (
        <p className="pointer-events-none mt-4 text-center text-[0.9375rem] font-medium text-foreground" aria-live="polite">
          {t('dropHere')}
        </p>
      )}

      {!cover ? (
        <>
          <div role="group" aria-label={t('choices.label')} className="mt-8 grid grid-cols-2 gap-3">
            {touch === null ? (
              <>
                <div className="invisible min-h-28" aria-hidden="true" />
                <div className="invisible min-h-28" aria-hidden="true" />
              </>
            ) : touch ? (
              <>
                <Choice icon={ICONS.camera} onPress={() => cameraRef.current?.click()} disabled={busy}>
                  {t('choices.camera')}
                </Choice>
                <Choice icon={ICONS.phone} onPress={() => pickerRef.current?.click()} disabled={busy}>
                  {t('choices.phone')}
                </Choice>
              </>
            ) : (
              <Choice icon={ICONS.upload} onPress={() => pickerRef.current?.click()} disabled={busy} wide hint={t('choices.computerHint')}>
                {t('choices.computer')}
              </Choice>
            )}
            <Choice icon={ICONS.library} onPress={() => setLibraryOpen(true)} disabled={busy}>
              {t('choices.library')}
            </Choice>
            <Choice icon={ICONS.sparkle} highlight disabled badge={t('choices.soon')}>
              {t('choices.ai')}
            </Choice>
          </div>
          <p className="mt-4 flex gap-2 text-sm leading-6 text-muted-foreground">
            <span className="mt-0.5 shrink-0">{ICONS.leaf}</span>
            {t('note')}
          </p>
        </>
      ) : (
        <div className="mt-8">
          <FocalPicker
            url={cover.url}
            alt={cleanAlt(alt)[defaultLocale] ?? ''}
            point={focal}
            onChange={changeFocal}
            onCommit={() => debounceRef.current && saveNow()}
            status={lastEdited === 'focal' ? statusText : ''}
            statusError={saveStatus === 'failed'}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill onPress={() => pickerRef.current?.click()} disabled={busy} icon={ICONS.swap}>
              {t('change')}
            </Pill>
            <Pill onPress={() => setLibraryOpen(true)} disabled={busy} icon={ICONS.library}>
              {t('choices.library')}
            </Pill>
            <Pill onPress={remove} disabled={busy} icon={ICONS.trash}>
              {t('remove')}
            </Pill>
          </div>

          <div className="mt-6">
            <label htmlFor={`${uid}-alt`} className="block text-[0.9375rem] font-medium text-foreground">
              {t('alt.label')}
              {otherLocales.length > 0 && <span className="text-muted-foreground"> · {languageName(defaultLocale)}</span>}
            </label>
            <p id={`${uid}-alt-help`} className="mt-1 text-sm leading-6 text-muted-foreground">
              {t('alt.helper')}
            </p>
            <AltField
              id={`${uid}-alt`}
              ref={altFieldRef}
              value={alt[defaultLocale] ?? ''}
              placeholder={t('alt.placeholder')}
              describedBy={`${uid}-alt-help${showNeeded ? ` ${uid}-alt-err` : ''}`}
              invalid={showNeeded}
              countLabel={(n) => t('alt.count', { count: n, max: ALT_MAX })}
              status={lastEdited === 'alt' ? statusText : ''}
              statusError={saveStatus === 'failed'}
              onChange={(v) => changeAlt(defaultLocale, v)}
              onBlur={() => debounceRef.current && saveNow()}
            />
            {showNeeded && (
              <p id={`${uid}-alt-err`} className="mt-1 text-sm text-destructive">
                {t('alt.neededToContinue')}
              </p>
            )}
          </div>

          {otherLocales.length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                aria-expanded={showOthers}
                aria-controls={`${uid}-others`}
                onClick={() => setShowOthers((s) => !s)}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-[0.9375rem] font-medium text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className={`transition-transform ${showOthers ? 'rotate-90' : ''}`}>{ICONS.chevron}</span>
                {t('alt.otherLanguages')}
              </button>
              {showOthers && (
                <div id={`${uid}-others`} className="mt-2 space-y-4">
                  <p className="text-sm text-muted-foreground">{t('alt.otherHelper')}</p>
                  {otherLocales.map((l) => (
                    <div key={l}>
                      <label htmlFor={`${uid}-alt-${l}`} className="block text-sm font-medium text-foreground">
                        {t('alt.inLanguage', { language: languageName(l) })}
                      </label>
                      <AltField
                        id={`${uid}-alt-${l}`}
                        value={alt[l] ?? ''}
                        countLabel={(n) => t('alt.count', { count: n, max: ALT_MAX })}
                        onChange={(v) => changeAlt(l, v)}
                        onBlur={() => debounceRef.current && saveNow()}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <p
        role={notice?.kind === 'error' ? 'alert' : 'status'}
        aria-live="polite"
        className={`mt-3 min-h-5 text-sm ${notice?.kind === 'error' ? 'text-destructive' : notice ? 'text-success' : 'text-muted-foreground'}`}
      >
        {phase === 'preparing'
          ? t('preparing')
          : phase === 'uploading'
            ? t('uploading')
            : phase === 'saving'
              ? t('saving')
              : notice?.text}
      </p>
      {(phase === 'preparing' || phase === 'uploading') && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className={`h-full animate-pulse rounded-full bg-action transition-all ${phase === 'uploading' ? 'w-2/3' : 'w-1/4'}`} />
        </div>
      )}

      {libraryOpen && <LibrarySheet projectSlug={site.projectSlug} onClose={() => setLibraryOpen(false)} onChoose={choose} />}
    </section>
  )
}

// ── Focal point picker ──────────────────────────────────────────────────────

const PREVIEWS = [
  { key: 'wide', className: 'aspect-video' },
  { key: 'card', className: 'aspect-[4/3]' },
  { key: 'square', className: 'aspect-square' },
  { key: 'tall', className: 'aspect-[9/16]' },
] as const

/**
 * The cover with a draggable focal dot (ADR-022 §4a: the point is stored as
 * the Media Library asset's hotspot and every crop keeps it in view). Click
 * or tap to place, drag to move, arrow keys move 1% (10% with Shift). Below,
 * live crops at the shapes the website uses — object-fit: cover with
 * object-position from the point, exactly like `focalObjectPosition`.
 */
function FocalPicker({
  url,
  alt,
  point,
  onChange,
  onCommit,
  status,
  statusError,
}: {
  url: string
  alt: string
  point: FocalPoint | null
  onChange: (p: FocalPoint) => void
  onCommit: () => void
  status: string
  statusError: boolean
}) {
  const t = useTranslations('clientDashboard.create.cover')
  const helpId = useId()
  const frameRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const shown = point ?? { x: 0.5, y: 0.5 }
  const pct = (n: number) => Math.round(n * 100)
  const position = `${pct(shown.x)}% ${pct(shown.y)}%`

  const fromPointer = (e: ReactPointerEvent) => {
    const box = frameRef.current?.getBoundingClientRect()
    if (!box || !box.width || !box.height) return
    onChange(roundPoint({ x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height }))
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = moves[e.key]
    if (e.key === 'Home') {
      e.preventDefault()
      return onChange({ x: 0.5, y: 0.5 })
    }
    if (!move) return
    e.preventDefault()
    onChange(roundPoint({ x: shown.x + move[0], y: shown.y + move[1] }))
  }

  return (
    <div>
      <p className="text-[0.9375rem] font-medium text-foreground">{t('focal.title')}</p>
      <p id={helpId} className="mt-1 mb-3 text-sm leading-6 text-muted-foreground">
        {t('focal.helper')} <span className="sr-only">{t('focal.keys')}</span>
      </p>
      <div
        ref={frameRef}
        className="relative cursor-crosshair touch-none overflow-hidden rounded-2xl border border-border bg-muted select-none"
        onPointerDown={(e) => {
          draggingRef.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          fromPointer(e)
        }}
        onPointerMove={(e) => draggingRef.current && fromPointer(e)}
        onPointerUp={() => {
          draggingRef.current = false
          onCommit()
        }}
        onPointerCancel={() => {
          draggingRef.current = false
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Sanity CDN URL, sized by the CDN */}
        <img src={`${url}?w=1200&auto=format`} alt={alt} width="1200" height="800" draggable={false} className="block h-auto w-full" />
        <div
          role="slider"
          tabIndex={0}
          aria-label={t('focal.label')}
          aria-describedby={helpId}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct(shown.x)}
          aria-valuetext={t('focal.valueText', { x: pct(shown.x), y: pct(shown.y) })}
          onKeyDown={onKeyDown}
          onBlur={onCommit}
          className="absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%` }}
        >
          <span
            className={`block size-6 rounded-full border-[3px] border-background bg-action shadow-md ${point ? '' : 'opacity-70'}`}
            aria-hidden="true"
          />
        </div>
      </div>
      <p role="status" className={`mt-1 min-h-4 text-xs ${statusError ? 'text-destructive' : 'text-muted-foreground'}`}>
        {status}
      </p>

      <p className="mt-2 text-sm font-medium text-foreground">{t('focal.previews')}</p>
      <ul className="mt-2 flex items-end gap-3 overflow-x-auto pb-1">
        {PREVIEWS.map((p) => (
          <li key={p.key} className="shrink-0">
            <div className={`h-20 overflow-hidden rounded-lg border border-border bg-muted ${p.className}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- Sanity CDN thumbnail */}
              <img
                src={`${url}?w=480&auto=format`}
                alt=""
                width="160"
                height="90"
                draggable={false}
                className="size-full object-cover"
                style={{ objectPosition: position }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t(`focal.preview.${p.key}`)}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function roundPoint(p: FocalPoint): FocalPoint {
  const c = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000
  return { x: c(p.x), y: c(p.y) }
}

// ── Media library sheet ─────────────────────────────────────────────────────

function LibrarySheet({
  projectSlug,
  onClose,
  onChoose,
}: {
  projectSlug: string
  onClose: () => void
  onChoose: (item: LibraryItem) => void
}) {
  const t = useTranslations('clientDashboard.create.cover')
  const titleId = useId()
  const searchId = useId()
  const [items, setItems] = useState<LibraryItem[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const closeRef = useRef<HTMLButtonElement>(null)
  const requestRef = useRef(0)

  const load = useCallback(
    async (from: string | null, q: string, tagFilter: string[]) => {
      const request = ++requestRef.current
      setState('loading')
      try {
        const r = await listProjectMediaAction({ projectSlug, cursor: from, q: q || null, tags: tagFilter.length ? tagFilter : null })
        if (request !== requestRef.current) return
        if (!r.ok) return setState('error')
        setItems((prev) => (from ? [...prev, ...r.items] : r.items))
        setTags(r.tags)
        setCursor(r.nextCursor)
        setState('ready')
      } catch {
        if (request === requestRef.current) setState('error')
      }
    },
    [projectSlug]
  )

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(id)
  }, [query])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- (re)load when the filters change
    void load(null, debouncedQuery, selected)
  }, [load, debouncedQuery, selected])

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const filtered = !!debouncedQuery || selected.length > 0
  const toggleTag = (tag: string) =>
    setSelected((s) => (s.includes(tag) ? s.filter((x) => x !== tag) : s.length >= 10 ? s : [...s, tag]))

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-t-2xl border border-border bg-background sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2">
          <h2 id={titleId} className="text-lg font-semibold text-foreground">
            {t('library.title')}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('library.close')}
            className="inline-flex size-11 items-center justify-center rounded-full text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {ICONS.close}
          </button>
        </div>

        <div className="space-y-3 border-b border-border-subtle px-4 py-3">
          <label htmlFor={searchId} className="sr-only">
            {t('library.searchLabel')}
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">{ICONS.search}</span>
            <input
              id={searchId}
              type="search"
              value={query}
              maxLength={SEARCH_MAX}
              placeholder={t('library.searchPlaceholder')}
              onChange={(e) => setQuery(e.target.value)}
              className="block min-h-11 w-full rounded-full border border-border bg-background pr-3 pl-10 text-[1rem] text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
          </div>
          {tags.length > 0 && (
            <div role="group" aria-label={t('library.tagsLabel')} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {tags.map((tag) => {
                const on = selected.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleTag(tag)}
                    className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                      on ? 'border-ring bg-selected-tint text-foreground' : 'border-border bg-background text-foreground hover:bg-hover'
                    }`}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="overflow-y-auto p-4">
          {state === 'error' && <p className="text-sm text-destructive">{t('errors.generic')}</p>}
          {state === 'ready' && items.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{filtered ? t('library.noResults') : t('library.empty')}</p>
              {filtered && (
                <Pill
                  onPress={() => {
                    setQuery('')
                    setDebouncedQuery('')
                    setSelected([])
                  }}
                  icon={ICONS.close}
                >
                  {t('library.clear')}
                </Pill>
              )}
            </div>
          )}
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {items.map((item, i) => {
              const description = Object.values(item.alt)[0]
              return (
                <li key={item.assetId}>
                  <button
                    type="button"
                    onClick={() => onChoose(item)}
                    aria-label={`${t('library.choose', { number: i + 1 })} — ${description ?? t('library.untitled')}`}
                    className="block aspect-square w-full overflow-hidden rounded-xl border border-border bg-muted hover:ring-2 hover:ring-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- Sanity CDN thumbnail */}
                    <img src={item.thumbUrl} alt="" width="240" height="240" loading="lazy" className="size-full object-cover" />
                  </button>
                </li>
              )
            })}
          </ul>
          {state === 'loading' && <p className="mt-3 text-sm text-muted-foreground">{t('library.loading')}</p>}
          {state === 'ready' && cursor && (
            <button
              type="button"
              onClick={() => void load(cursor, debouncedQuery, selected)}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-border bg-background text-[0.9375rem] font-medium text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t('library.more')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function AltField({
  id,
  ref,
  value,
  placeholder,
  describedBy,
  invalid,
  countLabel,
  status,
  statusError,
  onChange,
  onBlur,
}: {
  id: string
  ref?: React.Ref<HTMLTextAreaElement>
  value: string
  placeholder?: string
  describedBy?: string
  invalid?: boolean
  countLabel: (n: number) => string
  status?: string
  statusError?: boolean
  onChange: (value: string) => void
  onBlur?: () => void
}) {
  return (
    <div className="mt-2">
      <textarea
        id={id}
        ref={ref}
        rows={2}
        value={value}
        maxLength={ALT_MAX}
        placeholder={placeholder}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value.replace(/\n/g, ' '))}
        onBlur={onBlur}
        className={`block min-h-11 w-full resize-none rounded-xl border bg-background px-3 py-2.5 text-[1rem] leading-6 text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
          invalid ? 'border-destructive' : 'border-border'
        }`}
      />
      <div className="mt-1 flex justify-between gap-3 text-xs">
        <span role="status" className={statusError ? 'text-destructive' : 'text-muted-foreground'}>
          {status}
        </span>
        <span className="text-muted-foreground" aria-hidden="true">
          {countLabel(value.length)}
        </span>
      </div>
    </div>
  )
}

function Choice({
  children,
  icon,
  onPress,
  disabled,
  highlight,
  badge,
  hint,
  wide,
}: {
  children: ReactNode
  icon: ReactNode
  onPress?: () => void
  disabled?: boolean
  highlight?: boolean
  badge?: string
  hint?: string
  wide?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      className={`flex min-h-28 flex-col items-start justify-between gap-3 rounded-2xl border p-4 text-left text-[0.9375rem] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed ${
        wide ? 'col-span-2 border-dashed' : ''
      } ${
        highlight
          ? 'border-transparent bg-accent text-accent-foreground disabled:opacity-80'
          : 'border-border bg-background text-foreground enabled:hover:bg-hover disabled:opacity-60'
      }`}
    >
      <span className="flex w-full items-start justify-between gap-2">
        {icon}
        {badge && <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">{badge}</span>}
      </span>
      <span>
        {children}
        {hint && <span className="mt-0.5 block text-sm font-normal text-muted-foreground">{hint}</span>}
      </span>
    </button>
  )
}

function Pill({ children, icon, onPress, disabled }: { children: ReactNode; icon: ReactNode; onPress: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-background px-4 text-[0.9375rem] font-medium text-foreground transition-colors enabled:hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
    >
      {icon}
      {children}
    </button>
  )
}

function svg(d: string, size = 18) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const ICONS = {
  camera: svg('M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 24),
  phone: svg('M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2', 24),
  upload: svg('M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3', 24),
  library: svg('M4 4h16v16H4zM4 15l4-4 4 4 3-3 5 5M15 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 24),
  sparkle: svg('M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z', 24),
  leaf: svg('M5 19c0-8 5-13 14-14-1 9-6 14-14 14zM5 19l7-7', 16),
  swap: svg('M4 7h13l-3-3M20 17H7l3 3'),
  trash: svg('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'),
  chevron: svg('M9 6l6 6-6 6', 16),
  close: svg('M6 6l12 12M18 6L6 18', 20),
  search: svg('M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4', 18),
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function cleanAlt(alt: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [l, v] of Object.entries(alt)) {
    const text = (v ?? '').trim().replace(/\s+/g, ' ')
    if (text) out[l] = text.slice(0, ALT_MAX)
  }
  return out
}

function hasFiles(e: DragEvent) {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}

function isHeic(file: File) {
  return /^image\/hei[cf]/.test(file.type) || /\.hei[cf]$/i.test(file.name)
}

async function canDecode(file: File): Promise<boolean> {
  if (typeof createImageBitmap !== 'function') return false
  try {
    const bmp = await createImageBitmap(file)
    bmp.close()
    return true
  } catch {
    return false
  }
}

/**
 * Prepares a photo for upload. Most photos go as they are, so TinyPNG on the
 * server compresses the ORIGINAL; the browser only re-encodes (high quality)
 * when the file would not fit the 4 MB upload limit, is longer than 2560px,
 * or is in a format the server doesn't take (see `planUpload`). Returns null
 * when the browser cannot read the image at all.
 */
async function prepareImage(file: File): Promise<File | null> {
  const supported = ACCEPT.split(',').includes(file.type)
  let bitmap: ImageBitmap | null = null
  if (typeof createImageBitmap === 'function') {
    try {
      bitmap = await createImageBitmap(file)
    } catch {
      bitmap = null
    }
  }
  try {
    const plan = planUpload({ size: file.size, type: file.type, width: bitmap?.width, height: bitmap?.height })
    if (plan.action === 'send') return file
    if (!bitmap || typeof document === 'undefined') return supported ? file : null

    const name = `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`
    let last: Blob | null = null
    for (const attempt of plan.attempts) {
      const scale = Math.min(1, attempt.maxEdge / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      const g = canvas.getContext('2d')
      if (!g) break
      // JPEG has no transparency: paint a light base under PNG/WebP cut-outs.
      g.fillStyle = 'white'
      g.fillRect(0, 0, canvas.width, canvas.height)
      g.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      last = await new Promise<Blob | null>((res) => canvas.toBlob(res, attempt.type, attempt.quality))
      if (last && planUpload({ size: last.size, type: attempt.type }).action === 'send') {
        return new File([last], name, { type: attempt.type })
      }
    }
    return last ? new File([last], name, { type: 'image/jpeg' }) : supported ? file : null
  } finally {
    bitmap?.close()
  }
}
