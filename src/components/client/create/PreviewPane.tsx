'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { StepHeading, languageName } from '@/components/client/create/StepHeading'
import type { DraftPreviewLink } from '@/lib/api/post-preview'
import { Button } from '@/components/app/ui/Button'
import { buttonClass } from '@/components/app/ui/button-styles'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { Skeleton } from '@/components/app/ui/Skeleton'

type Device = 'phone' | 'computer'
type Theme = 'light' | 'dark'
const FRAME_WIDTH: Record<Device, number> = { phone: 390, computer: 1280 }
const FRAME_HEIGHT = 760
const REFRESH_MARGIN_MS = 60_000

/**
 * "Here's how it will look" — the REAL page in the website's own design, in a
 * frame (ADR-025 · preview). ONE component for the post and the gallery
 * wizards: the link source and URL are passed in (`mint`, `buildSrc`; `mint`
 * must be stable), plus optional extra switches (`controls`). Switches for
 * language (languages with content), light/dark (only when the site has both)
 * and phone/computer width reload only the frame. The link is private, signed
 * and short-lived; "Open in a new tab" uses the same link.
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
              if (l === locale) return
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
              if (v === theme) return
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
            if (v === effectiveDevice) return
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
