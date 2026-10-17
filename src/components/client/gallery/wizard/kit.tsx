'use client'

/**
 * Pieces of the blog wizard (v1.0.45) copied for the gallery and media
 * wizards, so those copy the blog wizard's look exactly without touching the
 * blog's step files: TitleFields (with labels/limits), the languages Choice,
 * the overview's "…" menu and state badge, the preview frame (PreviewPane)
 * and the done screen. Markup is the blog's; keep them in step with it.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { StepHeading, languageName } from '@/components/client/create/StepHeading'
import type { SectionState } from '@/lib/client/wizard-steps'
import type { DraftPreviewLink } from '@/lib/api/post-preview'
import { Button, ButtonLink } from '@/components/app/ui/Button'
import { buttonClass } from '@/components/app/ui/button-styles'
import { CardMenu } from '@/components/app/ui/CardMenu'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { Skeleton } from '@/components/app/ui/Skeleton'
import { TextArea } from '@/components/app/ui/TextInput'
import { Pill } from '@/components/app/ui/list/cells'

// ── TitleFields (blog TitleStep) ─────────────────────────────────────────────

function Remaining({ value, max, id }: { value: string; max: number; id: string }) {
  const t = useTranslations('clientDashboard.create.titleStep')
  const left = max - value.length
  return (
    <p id={id} aria-live="polite" className="mt-2 min-h-5 text-sm text-muted-foreground">
      {left <= Math.max(20, Math.round(max * 0.2)) ? t('remaining', { count: Math.max(0, left) }) : ''}
    </p>
  )
}

function Source({ id, label, lang, text }: { id: string; label: string; lang: string; text: string }) {
  return (
    <div id={id} className="mt-2 rounded-xl bg-muted px-4 py-3">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p lang={lang} className="mt-1 text-[1.0625rem] leading-7 break-words text-foreground">
        {text}
      </p>
    </div>
  )
}

/** Title + second line (a gallery's description), the blog TitleStep's fields. */
export function NameFields({
  idPrefix,
  title,
  description,
  onTitle,
  onDescription,
  labels,
  placeholders,
  max,
  autoFocus,
  lang,
  source,
}: {
  idPrefix: string
  title: string
  description: string
  onTitle: (v: string) => void
  onDescription: (v: string) => void
  labels: { title: string; description: string }
  placeholders: { title: string; description: string }
  max: { title: number; description: number }
  autoFocus?: boolean
  lang?: string
  source?: {
    label: string
    lang: string
    title: string
    description: string
    empty: string
  }
}) {
  return (
    <div className="mt-8 flex flex-col gap-6">
      <div>
        <label htmlFor={`${idPrefix}-title`} className="text-[0.9375rem] font-medium text-foreground">
          {labels.title}
        </label>
        {source ? <Source id={`${idPrefix}-title-src`} label={source.label} lang={source.lang} text={source.title || source.empty} /> : null}
        <TextArea
          id={`${idPrefix}-title`}
          lang={lang}
          rows={2}
          value={title}
          maxLength={max.title}
          autoFocus={autoFocus}
          required
          aria-describedby={source ? `${idPrefix}-title-src ${idPrefix}-title-left` : `${idPrefix}-title-left`}
          placeholder={placeholders.title}
          data-enter-next=""
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          onChange={(e) => onTitle(e.target.value.replace(/\n/g, ' '))}
          textSize="title"
          className="overflow-x-hidden"
        />
        <Remaining id={`${idPrefix}-title-left`} value={title} max={max.title} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-description`} className="text-[0.9375rem] font-medium text-foreground">
          {labels.description}
        </label>
        {source && source.description ? (
          <Source id={`${idPrefix}-description-src`} label={source.label} lang={source.lang} text={source.description} />
        ) : null}
        {/* Wraps long words inside the field — no horizontal scrollbar on phones. */}
        <TextArea
          id={`${idPrefix}-description`}
          lang={lang}
          rows={2}
          value={description}
          maxLength={max.description}
          aria-describedby={source?.description ? `${idPrefix}-description-src ${idPrefix}-description-left` : `${idPrefix}-description-left`}
          placeholder={placeholders.description}
          data-enter-next=""
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          onChange={(e) => onDescription(e.target.value.replace(/\n/g, ' '))}
          textSize="lead"
          className="overflow-x-hidden whitespace-pre-wrap"
        />
        <Remaining id={`${idPrefix}-description-left`} value={description} max={max.description} />
      </div>
    </div>
  )
}

// ── Languages Choice (blog LanguagesStep) ────────────────────────────────────

export type LanguageChoice = 'translate' | 'write' | 'later'

// ── Overview pieces (blog ReviewStep) ────────────────────────────────────────

export function OverviewMenu({ items, label }: { items: { key: string; label: string; onSelect: () => void }[]; label: string }) {
  return <CardMenu label={label} items={items} />
}

export function StateBadge({ state, label }: { state: SectionState; label: string }) {
  if (state === 'done') {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m5 12 5 5L20 7" />
        </svg>
        {label}
      </span>
    )
  }
  return <Pill tone={state === 'missing' ? 'highlight' : 'muted'}>{label}</Pill>
}

// ── Preview (blog PreviewStep) ───────────────────────────────────────────────

type Device = 'phone' | 'computer'
type Theme = 'light' | 'dark'
const FRAME_WIDTH: Record<Device, number> = { phone: 390, computer: 1280 }
const FRAME_HEIGHT = 760
const REFRESH_MARGIN_MS = 60_000

/**
 * The blog PreviewStep, with the link source and URL passed in (a gallery
 * draft previews with kind "gallery"), plus optional extra switches.
 */
export function PreviewPane({
  title,
  helper,
  languages,
  defaultLocale,
  mint: mintLink,
  buildSrc,
  controls,
}: {
  title: string
  helper: string
  languages: string[]
  defaultLocale: string
  mint: () => Promise<({ ok: true } & DraftPreviewLink) | { ok: false; error: string }>
  buildSrc: (link: DraftPreviewLink, locale: string, theme: Theme | null) => string
  controls?: ReactNode
}) {
  const t = useTranslations('clientDashboard.create.preview')
  const ui = useLocale()
  const [picked, setPicked] = useState(languages[0] ?? defaultLocale)
  const locale = languages.includes(picked) ? picked : (languages[0] ?? defaultLocale)
  const [themePick, setThemePick] = useState<Theme | null>(null)
  const [device, setDevice] = useState<Device>('computer')
  const [link, setLink] = useState<DraftPreviewLink | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const [width, setWidth] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const minting = useRef(false)

  const mint = useCallback(async () => {
    if (minting.current) return
    minting.current = true
    setError(null)
    try {
      const r = await mintLink()
      if (r.ok) setLink(r)
      else setError(t(r.error === 'unavailable' || r.error === 'not_found' ? `errors.${r.error}` : 'errors.generic'))
    } catch {
      setError(t('errors.generic'))
    } finally {
      minting.current = false
    }
  }, [mintLink, t])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mint the private link on open (and when the source changes)
    void mint()
  }, [mint])

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(box)
    return () => ro.disconnect()
  }, [])
  const [deviceChosen, setDeviceChosen] = useState(false)
  const effectiveDevice: Device = deviceChosen ? device : width > 0 && width < 560 ? 'phone' : device

  const refreshIfStale = () => {
    if (link && link.exp * 1000 - Date.now() < REFRESH_MARGIN_MS) void mint()
  }

  const themes = link?.themes ?? []
  const theme: Theme | null = themes.length > 1 ? (themePick && themes.includes(themePick) ? themePick : themes[0]) : null
  const src = link ? buildSrc(link, locale, theme) : null
  const loading = !!src && loadedSrc !== src
  const frameW = FRAME_WIDTH[effectiveDevice]
  const scale = width > 0 ? Math.min(1, width / frameW) : 1

  if (!languages.length) {
    return (
      <section aria-labelledby="preview-step-title">
        <StepHeading id="preview-step-title" title={title} helper={helper} />
        <p className="mt-8 text-muted-foreground">{t('empty')}</p>
      </section>
    )
  }

  return (
    <section aria-labelledby="preview-step-title">
      <StepHeading id="preview-step-title" title={title} helper={helper} />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {controls}
        {languages.length > 1 && (
          <SegmentedControl
            appearance="pill"
            label={t('language')}
            value={locale}
            options={languages.map((l) => ({
              value: l,
              label: languageName(l, ui),
            }))}
            onChange={(l) => {
              refreshIfStale()
              setPicked(l)
            }}
          />
        )}
        {themes.length > 1 && theme && (
          <SegmentedControl
            appearance="pill"
            label={t('theme')}
            value={theme}
            options={[
              { value: 'light', label: t('themeLight') },
              { value: 'dark', label: t('themeDark') },
            ]}
            onChange={(v) => {
              refreshIfStale()
              setThemePick(v as Theme)
            }}
          />
        )}
        <SegmentedControl
          appearance="pill"
          label={t('device')}
          value={effectiveDevice}
          options={[
            {
              value: 'phone',
              label: (
                <>
                  {ICONS.phone}
                  {t('phone')}
                </>
              ),
            },
            {
              value: 'computer',
              label: (
                <>
                  {ICONS.computer}
                  {t('computer')}
                </>
              ),
            },
          ]}
          onChange={(v) => {
            setDeviceChosen(true)
            setDevice(v as Device)
          }}
        />
      </div>

      <div ref={boxRef} className="mt-5 w-full">
        {error ? (
          <Notice tone="error" action={<Button onClick={() => void mint()}>{t('retry')}</Button>}>
            {error}
          </Notice>
        ) : (
          <div className="mx-auto" style={{ width: frameW * scale, height: FRAME_HEIGHT }}>
            <Panel padding="none" tone="muted" className="relative size-full overflow-hidden">
              {src && (
                <iframe
                  key={effectiveDevice}
                  src={src}
                  title={t('frameTitle')}
                  onLoad={() => setLoadedSrc(src)}
                  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                  referrerPolicy="no-referrer"
                  className="absolute top-0 left-0 origin-top-left border-0 bg-background"
                  style={{
                    width: frameW,
                    height: FRAME_HEIGHT / scale,
                    transform: `scale(${scale})`,
                  }}
                />
              )}
              {(loading || !src) && (
                <div className="absolute inset-0 flex flex-col gap-4 bg-muted p-6" aria-hidden="true">
                  <Skeleton onMuted className="h-6 w-1/3" />
                  <Skeleton onMuted className="h-10 w-3/4" />
                  <Skeleton onMuted shape="block" className="aspect-video w-full" />
                  <Skeleton onMuted className="h-4 w-full" />
                  <Skeleton onMuted className="h-4 w-5/6" />
                </div>
              )}
              <p className="sr-only" role="status">
                {loading || !src ? t('loading') : ''}
              </p>
            </Panel>
          </div>
        )}
      </div>

      {src && !error && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{t('private')}</p>
          <a href={src} target="_blank" rel="noopener noreferrer" onClick={refreshIfStale} className={buttonClass({ variant: 'link' })}>
            {ICONS.external}
            {t('openNewTab')}
          </a>
        </div>
      )}
    </section>
  )
}

// ── Done (blog DoneStep) ─────────────────────────────────────────────────────

/** The blog DoneStep's screen: check mark, heading, body and the way back. */
export function DoneScreen({ heading, body, backHref, backLabel }: { heading: string; body: string; backHref: string; backLabel: string }) {
  return (
    <section aria-labelledby="done-step-title" className="flex flex-col items-start pt-10">
      <span aria-hidden="true" className="grid size-16 place-items-center rounded-full bg-muted text-success">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m5 12 5 5L20 7" />
        </svg>
      </span>
      <h1 id="done-step-title" className="mt-6 text-[1.875rem] leading-9 font-semibold tracking-tight text-foreground">
        {heading}
      </h1>
      <p className="mt-3 text-[1.0625rem] leading-7 text-muted-foreground">{body}</p>
      <div className="mt-10 flex w-full flex-col gap-3 sm:flex-row">
        <ButtonLink href={backHref} variant="primary" size="lg">
          {backLabel}
        </ButtonLink>
      </div>
    </section>
  )
}

function svg(d: string, size = 16) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

const ICONS = {
  phone: svg('M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2'),
  computer: svg('M3 5h18v11H3zM8 20h8M12 16v4'),
  external: svg('M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5', 18),
}
