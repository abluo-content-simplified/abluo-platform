'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { StepProps } from '@/components/client/create/types'
import { StepHeading, languageName } from '@/components/client/create/StepHeading'
import { hasText } from '@/lib/client/wizard-steps'
import { draftPreviewUrl } from '@/lib/client/preview-url'
import { mintDraftPreviewAction, type MintPreviewResult } from '@/app/[locale]/(client)/[tenant]/posts/preview-actions'

type Link = Extract<MintPreviewResult, { ok: true }>
type Device = 'phone' | 'computer'
type Theme = 'light' | 'dark'

/** Frame widths: a typical phone, and a laptop-sized page scaled down to fit. */
const FRAME_WIDTH: Record<Device, number> = { phone: 390, computer: 1280 }
const FRAME_HEIGHT = 760
/** Mint a new link when the current one has less than this left (ms). */
const REFRESH_MARGIN_MS = 60_000

/**
 * "Here's how your post will look" — the REAL post page in the website's own
 * design, rendered from the draft (ADR-025 · preview), in a frame. Switches
 * for language (languages with content), light/dark (only when the site has
 * both) and phone/computer width reload only the frame. The link is private,
 * signed and short-lived; "Open in a new tab" uses the same link.
 */
export function PreviewStep({ draft, site, flush }: StepProps) {
  const t = useTranslations('clientDashboard.create.preview')
  const ui = useLocale()
  const withContent = site.languages.filter((l) => draft.title[l]?.trim() || hasText(draft.body[l]))
  const [picked, setPicked] = useState(withContent[0] ?? site.defaultLocale)
  const locale = withContent.includes(picked) ? picked : (withContent[0] ?? site.defaultLocale)
  const [themePick, setThemePick] = useState<Theme | null>(null)
  const [device, setDevice] = useState<Device>('computer')
  const [link, setLink] = useState<Link | null>(null)
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
      // The preview reads the saved draft: make sure the last edits are saved.
      if (flush) await flush()
      const r = await mintDraftPreviewAction({ projectSlug: site.projectSlug, id: draft.id })
      if (r.ok) setLink(r)
      else setError(t(r.error === 'unavailable' || r.error === 'not_found' ? `errors.${r.error}` : 'errors.generic'))
    } catch {
      setError(t('errors.generic'))
    } finally {
      minting.current = false
    }
  }, [flush, site.projectSlug, draft.id, t])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mint the private link once on open
    void mint()
  }, [mint])

  // Phones start on the phone width (after mount — no hydration mismatch).
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(box)
    return () => ro.disconnect()
  }, [])
  const [deviceChosen, setDeviceChosen] = useState(false)
  const effectiveDevice: Device = deviceChosen ? device : width > 0 && width < 560 ? 'phone' : device

  /** Switching re-mints first when the link is about to expire. */
  const refreshIfStale = () => {
    if (link && link.exp * 1000 - Date.now() < REFRESH_MARGIN_MS) void mint()
  }

  const themes = link?.themes ?? []
  const theme: Theme | null = themes.length > 1 ? (themePick && themes.includes(themePick) ? themePick : themes[0]) : null
  const src = link
    ? draftPreviewUrl({ origin: link.origin, locale, projectSlug: link.projectSlug, id: draft.id, token: link.token, theme })
    : null
  const loading = !!src && loadedSrc !== src

  const frameW = FRAME_WIDTH[effectiveDevice]
  const scale = width > 0 ? Math.min(1, width / frameW) : 1

  if (!withContent.length) {
    return (
      <section aria-labelledby="preview-step-title">
        <StepHeading id="preview-step-title" title={t('title')} helper={t('helper')} />
        <p className="mt-8 text-muted-foreground">{t('empty')}</p>
      </section>
    )
  }

  return (
    <section aria-labelledby="preview-step-title">
      <StepHeading id="preview-step-title" title={t('title')} helper={t('helper')} />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {withContent.length > 1 && (
          <Segmented
            label={t('language')}
            value={locale}
            options={withContent.map((l) => ({ value: l, label: languageName(l, ui) }))}
            onChange={(l) => {
              refreshIfStale()
              setPicked(l)
            }}
          />
        )}
        {themes.length > 1 && theme && (
          <Segmented
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
        <Segmented
          label={t('device')}
          value={effectiveDevice}
          options={[
            { value: 'phone', label: t('phone'), icon: ICONS.phone },
            { value: 'computer', label: t('computer'), icon: ICONS.computer },
          ]}
          onChange={(v) => {
            setDeviceChosen(true)
            setDevice(v as Device)
          }}
        />
      </div>

      <div ref={boxRef} className="mt-5 w-full">
        {error ? (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-muted p-6" role="alert">
            <p className="text-[15px] text-foreground">{error}</p>
            <button
              type="button"
              onClick={() => void mint()}
              className="inline-flex min-h-11 items-center rounded-full border border-border bg-background px-4 text-[15px] font-medium text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t('retry')}
            </button>
          </div>
        ) : (
          <div
            className="relative mx-auto overflow-hidden rounded-2xl border border-border bg-muted"
            style={{ width: frameW * scale, height: FRAME_HEIGHT }}
          >
            {src && (
              <iframe
                key={effectiveDevice}
                src={src}
                title={t('frameTitle')}
                onLoad={() => setLoadedSrc(src)}
                // Website scripts run (it IS the real page) but it cannot submit
                // forms or navigate the dashboard.
                sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer"
                className="absolute top-0 left-0 origin-top-left border-0 bg-background"
                style={{ width: frameW, height: FRAME_HEIGHT / scale, transform: `scale(${scale})` }}
              />
            )}
            {(loading || !src) && (
              <div className="absolute inset-0 flex flex-col gap-4 bg-muted p-6" aria-hidden="true">
                <div className="h-6 w-1/3 animate-pulse rounded bg-background" />
                <div className="h-10 w-3/4 animate-pulse rounded bg-background" />
                <div className="aspect-video w-full animate-pulse rounded-xl bg-background" />
                <div className="h-4 w-full animate-pulse rounded bg-background" />
                <div className="h-4 w-5/6 animate-pulse rounded bg-background" />
              </div>
            )}
            <p className="sr-only" role="status">
              {loading || !src ? t('loading') : ''}
            </p>
          </div>
        )}
      </div>

      {src && !error && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{t('private')}</p>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            onClick={refreshIfStale}
            className="inline-flex min-h-11 items-center gap-2 rounded-full px-1 text-[15px] font-semibold text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {ICONS.external}
            {t('openNewTab')}
          </a>
        </div>
      )}
    </section>
  )
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string; icon?: ReactNode }[]
  onChange: (value: string) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-border bg-muted p-1">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => !on && onChange(o.value)}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[15px] font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
              on ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function svg(d: string, size = 16) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const ICONS = {
  phone: svg('M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2'),
  computer: svg('M3 5h18v11H3zM8 20h8M12 16v4'),
  external: svg('M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5', 18),
}
