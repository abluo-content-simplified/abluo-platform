import type { BrandAsset } from '@/lib/modules/brand-hub/types'
import { formatBrandHubMessage, type BrandHubMessages } from '@/lib/i18n/brand-hub-messages'
import {
  CARD_STYLE, CHECKERBOARD, DoDontGrid, FOCUS_RING, HEADING_FONT, RichText, Section, Spec, StatementCard,
  formatBytes, formatNumber, themeBackground, type HubPageProps,
} from './shared'
import type { BrandHubModel } from '@/lib/modules/brand-hub/types'

const TRANSPARENT_EXT = new Set(['svg', 'png', 'webp', 'gif', 'avif'])

/** Background graphics always read as background graphics; the design system's own name follows. */
function assetLabel(a: BrandAsset, m: BrandHubMessages): string {
  if (a.key.startsWith('background:')) {
    return a.name ? formatBrandHubMessage(m.backgroundNamed, { name: a.name }) : m.assetLabels.background
  }
  return m.assetLabels[a.key as Exclude<BrandAsset['key'], `background:${string}`>]
}

function Tile({ label, style, src, alt, width }: { label: string; style: React.CSSProperties; src: string; alt: string; width?: number }) {
  return (
    <figure className="m-0 min-w-0">
      <div
        className="flex items-start justify-center overflow-hidden p-4"
        style={{ ...style, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', minHeight: 96 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="block h-auto max-w-full" style={width ? { width } : { maxHeight: 128 }} loading="lazy" />
      </div>
      <figcaption className="mt-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label}</figcaption>
    </figure>
  )
}

function AssetCard({ a, model, m, locale }: { a: BrandAsset; model: BrandHubModel; m: BrandHubMessages; locale: string }) {
  const label = assetLabel(a, m)
  const ext = (a.extension ?? '').toLowerCase().replace('.', '')
  const transparent = TRANSPARENT_EXT.has(ext)
  const isFavicon = a.key === 'faviconSvg' || a.key === 'faviconPng'
  const href = `${a.url}${a.url.includes('?') ? '&' : '?'}dl=`
  const size = a.width ?? 32
  return (
    <li className="break-inside-avoid p-5" style={CARD_STYLE}>
      <h3 className="mb-1 text-lg font-semibold" style={HEADING_FONT}>{label}</h3>
      {a.intendedFor && (
        <p className="mb-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {a.intendedFor === 'light' ? m.intendedForLight : m.intendedForDark}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label={m.onLightTile} style={{ background: themeBackground(model, 'light') }} src={a.previewUrl} alt={label} />
        <Tile label={m.onDarkTile} style={{ background: themeBackground(model, 'dark') }} src={a.previewUrl} alt="" />
        {transparent && <Tile label={m.transparentTile} style={CHECKERBOARD} src={a.previewUrl} alt="" />}
      </div>
      {isFavicon && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Tile label={m.nativeSize} style={{ background: themeBackground(model, 'light') }} src={a.previewUrl} alt="" width={Math.min(size, 64)} />
          <Tile label={m.enlarged} style={{ background: themeBackground(model, 'light') }} src={a.previewUrl} alt="" width={Math.min(size * 4, 256)} />
        </div>
      )}
      <dl className="mt-4 flex flex-col gap-1.5">
        {(a.extension || a.mimeType) && <Spec label={m.format} m={m}><span>{(a.extension ?? a.mimeType ?? '').replace('.', '').toUpperCase()}</span></Spec>}
        {a.width && a.height && <Spec label={m.dimensions} m={m}><span>{formatNumber(locale, a.width)} × {formatNumber(locale, a.height)} px</span></Spec>}
        {a.size !== null && <Spec label={m.fileSize} m={m}><span>{formatBytes(locale, a.size)}</span></Spec>}
      </dl>
      <a
        href={href}
        download
        className={`mt-4 inline-block rounded px-4 py-2 text-sm font-semibold print:hidden ${FOCUS_RING}`}
        style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', borderRadius: 'var(--radius-btn)' }}
      >
        {m.download}
        <span className="sr-only"> {label}</span>
      </a>
    </li>
  )
}

export function LogoPage({ model, m, locale }: HubPageProps) {
  const w = model.written.logo
  return (
    <>
      <RichText value={w.body} />
      <Section title={m.logoRulesTitle} id="logo-rules">
        <p className="mb-5 text-[0.9375rem]" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}>{m.logoRulesIntro}</p>
        <ul className="grid gap-4 sm:grid-cols-2">
          {model.logoRules.map((r) => <StatementCard key={r.key} title={m.logoRules[r.key]} statement={r} m={m} />)}
        </ul>
      </Section>
      {model.assets.length > 0 && (
        <Section title={m.assetsTitle}>
          <ul className="flex flex-col gap-5">
            {model.assets.map((a) => <AssetCard key={a.key} a={a} model={model} m={m} locale={locale} />)}
          </ul>
        </Section>
      )}
      <DoDontGrid items={w.doDont} m={m} />
    </>
  )
}
