'use client'

/**
 * MediaFeatureSection
 *
 * Reusable platform section: optional media on one side, a repeatable list of
 * feature rows on the other, with optional intro, closing line and CTAs.
 *
 * It replaces two bespoke one-off designs from the NoLogo site:
 *
 *   ProductShowcase  → mediaPosition 'left' | 'right' + mockupFrame: true.
 *                      Header (eyebrow/title/intro) runs full width above a
 *                      two-column band: browser-mockup screenshot on one side,
 *                      hairline-separated capability rows on the other, CTAs last.
 *
 *   Qualification    → mediaPosition 'none'. The header becomes the left column
 *                      and the feature rows the right column, with the optional
 *                      closingLine rendered in the heading font and accent colour.
 *
 * Both originals used fixed, breakpoint-free grids ('1.1fr 0.9fr' and '1fr 1fr').
 * Here every multi-column layout is single-column below `md` and only splits at
 * `md` and up, with the split itself driven by the `contentRatio` enum.
 *
 * Media presentation follows the platform convention: the section picks a named
 * style key and the Design System's `mediaStyles` array decides what it means.
 * No colours are resolved in JS — everything is a CSS custom property.
 */

import { useEffect, useId, useState } from 'react'
import { useParams } from 'next/navigation'
import { useReducedMotion } from 'motion/react'
import type {
  MediaFeatureSection as MediaFeatureSectionType,
  DesignSystem,
  MediaStyleDefinition,
  FeatureRow,
  ResolvedImage,
} from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { imageUrl, imageSrcSet } from '@/lib/sanity/image'
import { resolveCta, prefixCtaHref } from '@/lib/sanity/cta'
import { CtaButton } from '@/components/ui/CtaButton'
import { Icon, isIconName } from '@/components/icons'
import { IMAGE_HOVER_CLASSES } from '@/lib/image-presentation'
import { resolveEasing } from '@/lib/motion/easing'
import { renderHeadline } from '@/lib/headline-accent'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'

// ─── Default media styles ─────────────────────────────────────────────────────
// Mirrors MediaContentSection: fallback definitions used when the Design System
// has no mediaStyles array yet. Kept byte-identical so both sections agree on
// what a named style means when the DS is silent.

const DEFAULT_MEDIA_STYLES: MediaStyleDefinition[] = [
  { key: 'default',    borderRadius: 0,    aspectRatio: 'auto', objectFit: 'cover' },
  { key: 'rounded',    borderRadius: 16,   aspectRatio: 'auto', objectFit: 'cover' },
  { key: 'square',     borderRadius: 8,    aspectRatio: '1/1',  objectFit: 'cover' },
  { key: 'landscape',  borderRadius: 8,    aspectRatio: '16/9', objectFit: 'cover' },
  { key: 'portrait',   borderRadius: 8,    aspectRatio: '3/4',  objectFit: 'cover' },
  { key: 'circle',     borderRadius: 9999, aspectRatio: '1/1',  objectFit: 'cover' },
  { key: 'fullHeight', borderRadius: 0,    aspectRatio: 'auto', objectFit: 'cover' },
]

// ─── Pure helpers (exported for unit tests) ───────────────────────────────────

export function resolveMediaStyle(
  styleKey: string | undefined,
  dsStyles: MediaStyleDefinition[] | undefined,
): MediaStyleDefinition {
  const styles = dsStyles?.length ? dsStyles : DEFAULT_MEDIA_STYLES
  return styles.find((s) => s.key === (styleKey ?? 'default')) ?? DEFAULT_MEDIA_STYLES[0]
}

/**
 * Maps contentRatio → a Tailwind grid-cols class for the [media, features] pair
 * (or [header, features] when mediaPosition is 'none').
 *
 * `contentRatio` always describes content-first: '40/60' means the content
 * (feature) column gets 40% and the media column 60% — so when the media sits
 * on the left the fractions are emitted in the opposite order.
 *
 * Every value is `md:`-prefixed: below the md breakpoint the grid collapses to
 * one column. Both source designs hardcoded a desktop-only ratio with no
 * breakpoint at all, which is the bug this fixes.
 */
export function featureGridColsClass(
  ratio: string | undefined,
  mediaOnLeft: boolean,
): string {
  switch (ratio) {
    case '40/60':
      return mediaOnLeft ? 'md:grid-cols-[3fr_2fr]' : 'md:grid-cols-[2fr_3fr]'
    case '60/40':
      return mediaOnLeft ? 'md:grid-cols-[2fr_3fr]' : 'md:grid-cols-[3fr_2fr]'
    default:
      return 'md:grid-cols-2' // 50/50
  }
}

/** True when the section should render a media column at all. */
export function hasMediaColumn(
  mediaPosition: string | undefined,
  imageSrc: string | undefined,
): boolean {
  return mediaPosition !== 'none' && Boolean(imageSrc)
}

/** One distinct screenshot the interactive pane can show. Deduplicated by URL. */
export interface MediaLayer {
  key: string
  src: string
  srcSet: string | undefined
}

// ─── Interactive media helpers (exported for unit tests) ─────────────────────
//
// The interactive path is strictly opt-in: it only engages when the section
// explicitly sets `interactiveMedia` AND an editor has actually attached a
// screenshot to at least one row. Anything else — the field absent, the field
// null (GROQ's answer for a document authored before it existed), the field
// false, or on with no per-row images yet — falls through to the historical
// render, byte for byte.

/** True when the section should render the hover/tap-swappable media pane. */
export function hasInteractiveMedia(
  interactiveMedia: boolean | null | undefined,
  features: FeatureRow[] | null | undefined,
): boolean {
  if (interactiveMedia !== true) return false
  return (features ?? []).some((f) => Boolean(f?.image?.asset))
}

/**
 * The image the media pane shows for a given row:
 *   row image → section image → the first row that has one.
 *
 * The last clause is a safety net for the (authorable) case of a section with
 * no section-level image where only *some* rows carry one: it keeps the pane
 * from ever rendering empty, which is what the brief asks for.
 */
export function resolveActiveImage(
  features: FeatureRow[] | null | undefined,
  activeIndex: number,
  sectionImage: ResolvedImage | null | undefined,
): ResolvedImage | undefined {
  const rows = features ?? []
  const row = rows[activeIndex]
  if (row?.image?.asset) return row.image
  if (sectionImage?.asset) return sectionImage
  return rows.find((f) => f?.image?.asset)?.image
}

/**
 * Alt text for the pane. Prefers the authored alt of whichever image is
 * actually on screen, then the row title, then the section title — so a
 * screen reader hears what the screenshot shows rather than "image".
 */
export function resolveActiveAlt(
  features: FeatureRow[] | null | undefined,
  activeIndex: number,
  sectionImage: ResolvedImage | null | undefined,
  title: string | undefined,
): string {
  const row = (features ?? [])[activeIndex]
  const shown = resolveActiveImage(features, activeIndex, sectionImage)
  if (row?.image?.asset && shown === row.image) {
    return row.image.alt ?? row.title ?? title ?? ''
  }
  return shown?.alt ?? sectionImage?.alt ?? title ?? ''
}

/**
 * Which gesture selects a row. Driven by the `(hover: hover) and
 * (pointer: fine)` media query, never by user-agent sniffing: a touchscreen
 * laptop, a tablet with a trackpad attached mid-session, or a desktop browser
 * in device-emulation mode all answer this correctly, and a UA string does not.
 */
export function selectionModeFromPointer(finePointer: boolean): 'hover' | 'click' {
  return finePointer ? 'hover' : 'click'
}

/** Roving-focus target for a key press inside the row list. Wraps at both ends. */
export function nextFeatureIndex(current: number, key: string, count: number): number {
  if (count <= 0) return 0
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return (current + 1) % count
    case 'ArrowUp':
    case 'ArrowLeft':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return current
  }
}

/**
 * `resolveEasing` speaks motion/react (arrays + named easings); a CSS
 * `transition` needs a timing-function string. This is the one conversion
 * point back, so the cross-fade uses the very same DS easing token the
 * SlideUp entrances in this file already use.
 */
export function cssEasing(ease: unknown): string {
  const resolved = resolveEasing(ease, [0.0, 0.0, 0.2, 1])
  if (Array.isArray(resolved)) return `cubic-bezier(${resolved.join(', ')})`
  switch (resolved) {
    case 'linear':
      return 'linear'
    case 'easeIn':
      return 'ease-in'
    case 'easeOut':
      return 'ease-out'
    case 'easeInOut':
      return 'ease-in-out'
    default:
      return 'cubic-bezier(0, 0, 0.2, 1)'
  }
}

/**
 * Builds the deduplicated layer list plus a row → layer index map.
 *
 * Rows that fall back to the same section image share one layer, so a six-row
 * section with two per-row screenshots mounts three <img> elements, not six.
 * A row that resolves to no image at all maps to -1.
 */
export function buildMediaLayers(
  features: FeatureRow[] | null | undefined,
  sectionImage: ResolvedImage | null | undefined,
): { layers: MediaLayer[]; rowLayerIndex: number[] } {
  const layers: MediaLayer[] = []
  const rowLayerIndex: number[] = []

  for (let index = 0; index < (features?.length ?? 0); index += 1) {
    const resolved = resolveActiveImage(features, index, sectionImage)
    const src = imageUrl(resolved, 1400)
    if (!src) {
      rowLayerIndex.push(-1)
      continue
    }
    let layerIndex = layers.findIndex((l) => l.src === src)
    if (layerIndex === -1) {
      layerIndex = layers.length
      layers.push({ key: src, src, srcSet: imageSrcSet(resolved, [600, 900, 1200, 1600]) })
    }
    rowLayerIndex.push(layerIndex)
  }

  return { layers, rowLayerIndex }
}

const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)'

/**
 * True on devices that can hover with a precise pointer.
 *
 * Starts `false` so SSR and the first client paint agree (no hydration
 * mismatch) and so the tap path — which works everywhere — is what a user
 * gets if the effect never runs. Subscribes to `change`, so plugging in a
 * mouse or resizing into a desktop emulation flips the mode live.
 */
function useFinePointer(): boolean {
  const [finePointer, setFinePointer] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(FINE_POINTER_QUERY)
    const update = () => setFinePointer(mq.matches)
    update()
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', update)
      return () => mq.removeEventListener('change', update)
    }
    // Safari < 14 only has the deprecated listener pair.
    mq.addListener(update)
    return () => mq.removeListener(update)
  }, [])

  return finePointer
}

// ─── CTA row ──────────────────────────────────────────────────────────────────

function CtaRow({ section }: { section: MediaFeatureSectionType }) {
  // tenantId and locale are URL params — not stored in Sanity.
  // They're used here to build the correct full path for internal page CTA links.
  const params = useParams()
  const locale = params.locale as string | undefined
  const tenantId = params.tenant as string | undefined

  const primaryCta = section.primaryCta ? prefixCtaHref(resolveCta(section.primaryCta), locale, tenantId) : null
  const secondaryCta = section.secondaryCta ? prefixCtaHref(resolveCta(section.secondaryCta), locale, tenantId) : null

  if ((!primaryCta || primaryCta.type === 'none') && (!secondaryCta || secondaryCta.type === 'none')) {
    return null
  }

  return (
    <div className="mt-8 flex flex-wrap items-center gap-4">
      {primaryCta && primaryCta.type !== 'none' && (
        <CtaButton
          cta={primaryCta}
          className="inline-flex h-11 items-center gap-2 px-6 text-sm font-semibold tracking-wide transition-all duration-200 hover:opacity-90"
          style={{
            backgroundColor: 'var(--btn-primary-bg)',
            color: 'var(--btn-primary-text)',
            borderRadius: 'var(--radius-btn)',
          }}
        />
      )}
      {secondaryCta && secondaryCta.type !== 'none' && (
        <CtaButton
          cta={secondaryCta}
          className="inline-flex h-11 items-center gap-2 px-5 text-sm font-medium transition-all duration-150 hover:opacity-80"
          style={{
            color: 'var(--btn-secondary-text)',
            backgroundColor: 'var(--btn-secondary-bg)',
            borderRadius: 'var(--radius-btn)',
            border: '1.5px solid var(--color-border)',
          }}
        />
      )}
    </div>
  )
}

// ─── Feature row ──────────────────────────────────────────────────────────────

/**
 * One capability / bullet row: a small bordered accent box holding either the
 * chosen icon or — when no icon is set — a plain accent dot, then the title and
 * an optional description. Rows are separated by a hairline, matching the
 * TreatmentsSection pattern (border on each row, not on the wrapper).
 *
 * A row with only a `title` and no `description` degrades to the Qualification
 * bullet; a row with both is the ProductShowcase capability.
 */
/**
 * Everything the interactive variant needs. Absent → the row renders exactly
 * as it always has: a plain <div>, no roles, no tabindex, no extra padding.
 * That is the whole compatibility guarantee for Livener / Studio Martegani.
 */
interface RowInteraction {
  id: string
  paneId: string
  selected: boolean
  onSelect: () => void
  /** Only supplied in hover mode — omitted entirely on touch devices. */
  onPointerEnter?: () => void
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void
  transition: string | undefined
}

function FeatureRowItem({
  feature,
  interaction,
}: {
  feature: NonNullable<MediaFeatureSectionType['features']>[number]
  interaction?: RowInteraction
}) {
  const selected = interaction?.selected ?? false

  const content = (
    <>
      {/* Accent box — icon when one is chosen, dot otherwise */}
      <span
        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center"
        aria-hidden="true"
        style={{
          border: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--color-primary)',
        }}
      >
        {feature.icon && isIconName(feature.icon) ? (
          // Icon() itself returns null for an unknown key, which would leave an
          // empty box. Checking the registry first lets the dot stand in for a
          // missing *or* stale icon name. Colour is inherited via currentColor.
          <Icon name={feature.icon} size={14} />
        ) : (
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: 'var(--color-primary)' }}
          />
        )}
      </span>

      <div className="min-w-0">
        {feature.title && (
          <h3
            className="text-[0.9375rem] font-semibold leading-snug tracking-tight"
            style={{
              color: selected ? 'var(--color-primary)' : 'var(--color-text-primary)',
              fontFamily: 'var(--font-heading)',
              transition: interaction?.transition,
            }}
          >
            {feature.title}
          </h3>
        )}
        {feature.description && (
          <p
            className="mt-1.5 text-sm leading-relaxed"
            style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}
          >
            {feature.description}
          </p>
        )}
      </div>
    </>
  )

  // Non-interactive (default) row — the historical markup, unchanged.
  if (!interaction) {
    return (
      <div
        className="flex items-start gap-4 py-5 md:gap-5 md:py-6"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        {content}
      </div>
    )
  }

  // Interactive row — a real <button>, so Enter/Space activate it for free and
  // it is reachable by every assistive technology without extra plumbing.
  // The 2px left rule exists (transparent) on every row so selecting one never
  // shifts the text sideways; only its colour changes.
  return (
    <button
      type="button"
      role="tab"
      id={interaction.id}
      aria-selected={selected}
      aria-controls={interaction.paneId}
      tabIndex={selected ? 0 : -1}
      onClick={interaction.onSelect}
      onPointerEnter={interaction.onPointerEnter}
      onFocus={interaction.onSelect}
      onKeyDown={interaction.onKeyDown}
      className="flex w-full items-start gap-4 py-5 pl-4 pr-2 text-left md:gap-5 md:py-6 md:pl-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{
        borderBottom: '1px solid var(--color-border)',
        borderLeft: `2px solid ${selected ? 'var(--color-primary)' : 'transparent'}`,
        backgroundColor: selected ? 'var(--color-surface)' : 'transparent',
        outlineColor: 'var(--color-primary)',
        transition: interaction.transition,
      }}
    >
      {content}
    </button>
  )
}

// ─── Media block ──────────────────────────────────────────────────────────────

/**
 * The screenshot, optionally wrapped in a browser-window chrome: a titlebar with
 * three window dots, a title string and an accent badge, then the image with a
 * soft bottom fade.
 *
 * The fade is a CSS mask rather than a gradient painted in the surface colour —
 * the original hardcoded `var(--bg)`, which breaks the moment the section sits
 * on a different surface. A mask fades the pixels themselves, so it is correct
 * on every surface the platform can put behind it.
 *
 * The three window dots are the only literal colours in this file: they are
 * decorative operating-system chrome, not theme colour, and would stop reading
 * as a window if they took the tenant palette.
 */
const WINDOW_DOTS = ['#ff5f57', '#febc2e', '#28c840'] as const

function MediaBlock({
  imageSrc,
  srcSet,
  alt,
  mockupFrame,
  mockupTitle,
  mockupBadge,
  containerStyle,
  imgStyle,
}: {
  imageSrc: string
  srcSet: string | undefined
  alt: string
  mockupFrame: boolean
  mockupTitle: string | undefined
  mockupBadge: string | undefined
  containerStyle: React.CSSProperties
  imgStyle: React.CSSProperties
}) {
  const picture = (
    <div
      style={mockupFrame ? { overflow: 'hidden' } : containerStyle}
      className="group relative w-full"
    >
      <img
        src={imageSrc}
        srcSet={srcSet}
        sizes="(min-width: 768px) 50vw, 100vw"
        alt={alt}
        loading="lazy"
        style={imgStyle}
        className={IMAGE_HOVER_CLASSES}
      />
      {mockupFrame && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[18%]"
          style={{
            // Fades the image out without needing to know the surface colour.
            backdropFilter: 'none',
            maskImage: 'linear-gradient(to bottom, black, transparent)',
            WebkitMaskImage: 'linear-gradient(to bottom, black, transparent)',
          }}
        />
      )}
    </div>
  )

  if (!mockupFrame) return picture

  return (
    <MockupChrome
      borderRadius={containerStyle.borderRadius}
      mockupTitle={mockupTitle}
      mockupBadge={mockupBadge}
    >
      {picture}
    </MockupChrome>
  )
}

/**
 * The browser-window chrome around a screenshot. Extracted verbatim from
 * MediaBlock so the interactive pane wears exactly the same frame — the markup,
 * classes and tokens below are unchanged from what MediaBlock emitted before.
 */
function MockupChrome({
  borderRadius,
  mockupTitle,
  mockupBadge,
  children,
}: {
  borderRadius: React.CSSProperties['borderRadius']
  mockupTitle: string | undefined
  mockupBadge: string | undefined
  children: React.ReactNode
}) {
  return (
    <div
      className="w-full overflow-hidden"
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: borderRadius ?? 'var(--radius-md)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      {/* Titlebar */}
      <div
        className="flex items-center gap-1.5 px-3 py-2.5"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        {WINDOW_DOTS.map((dot) => (
          <span
            key={dot}
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: dot }}
          />
        ))}
        {mockupTitle && (
          <span
            className="ml-3 flex-1 truncate text-[0.6875rem] font-semibold tracking-[0.04em]"
            style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-heading)' }}
          >
            {mockupTitle}
          </span>
        )}
        {mockupBadge && (
          <span
            className={`${mockupTitle ? '' : 'ml-auto '}shrink-0 px-2 py-[3px] text-[0.5625rem] font-bold uppercase tracking-[0.1em]`}
            style={{
              color: 'var(--color-primary)',
              border: '1px solid var(--color-primary)',
              borderRadius: 'var(--radius-md)',
              fontFamily: 'var(--font-heading)',
            }}
          >
            {mockupBadge}
          </span>
        )}
      </div>

      {/* Screenshot */}
      <div className="relative" style={{ lineHeight: 0 }}>
        {children}
      </div>
    </div>
  )
}

// ─── Interactive media block ─────────────────────────────────────────────────

/**
 * The swappable screenshot pane.
 *
 * Every layer is mounted at all times, stacked in a single CSS grid cell
 * (`gridArea: 1 / 1`) and toggled with opacity. That buys three things at once:
 *
 *   • the browser downloads and decodes every screenshot up front, so a swap is
 *     an opacity change on an already-painted image, never a flash of nothing;
 *   • the outgoing and incoming images are on screen simultaneously, which is
 *     what makes it a cross-fade rather than a cut;
 *   • grid stacking (unlike absolute positioning) keeps the images in flow, so
 *     the pane still derives its height from them and does not need a hardcoded
 *     aspect ratio to avoid collapsing.
 *
 * The container height settles on the tallest screenshot, so swapping never
 * reflows the page around it.
 *
 * The hover-zoom class the static block uses is deliberately absent: here the
 * hover target is the row list, not the image, and its transform transition
 * would fight the opacity one.
 */
function InteractiveMediaBlock({
  layers,
  activeLayer,
  alt,
  mockupFrame,
  mockupTitle,
  mockupBadge,
  containerStyle,
  imgStyle,
  stretch,
  transition,
}: {
  layers: MediaLayer[]
  activeLayer: number
  alt: string
  mockupFrame: boolean
  mockupTitle: string | undefined
  mockupBadge: string | undefined
  containerStyle: React.CSSProperties
  imgStyle: React.CSSProperties
  stretch: boolean
  transition: string | undefined
}) {
  const stack = (
    <div
      className="relative grid w-full"
      style={mockupFrame ? { overflow: 'hidden' } : containerStyle}
    >
      {layers.map((layer, index) => {
        const isActive = index === activeLayer
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={layer.key}
            src={layer.src}
            srcSet={layer.srcSet}
            sizes="(min-width: 768px) 50vw, 100vw"
            // Only the visible layer is described; the rest are decorative
            // preloads and must not reach the accessibility tree.
            alt={isActive ? alt : ''}
            aria-hidden={isActive ? undefined : true}
            loading="lazy"
            decoding="async"
            style={{
              ...imgStyle,
              gridArea: '1 / 1',
              // Auto-height images must not be stretched to the tallest
              // layer's height by the grid's default `stretch` alignment.
              alignSelf: stretch ? 'stretch' : 'start',
              opacity: isActive ? 1 : 0,
              transition,
            }}
          />
        )
      })}
      {mockupFrame && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[18%]"
          style={{
            maskImage: 'linear-gradient(to bottom, black, transparent)',
            WebkitMaskImage: 'linear-gradient(to bottom, black, transparent)',
          }}
        />
      )}
    </div>
  )

  if (!mockupFrame) return stack

  return (
    <MockupChrome
      borderRadius={containerStyle.borderRadius}
      mockupTitle={mockupTitle}
      mockupBadge={mockupBadge}
    >
      {stack}
    </MockupChrome>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  section: MediaFeatureSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
}

export function MediaFeatureSection({ section, surface, designSystem }: Props) {
  const {
    eyebrow,
    title,
    headlineAccent,
    intro,
    image,
    mediaPosition = 'left',
    contentRatio,
    mediaStyle: mediaStyleKey,
    mockupFrame = false,
    mockupTitle,
    mockupBadge,
    features,
    interactiveMedia,
    closingLine,
  } = section

  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  // Motion tokens — durationSlow for content sections; ms → seconds for motion/react
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  const imageSrc = imageUrl(image, 1400)
  const srcSet = imageSrcSet(image, [600, 900, 1200, 1600])
  const mediaOnLeft = mediaPosition === 'left'

  // ── Interactive media state ───────────────────────────────────────────────
  // All of these hooks run on every render (interactive or not) — they are
  // cheap, and React forbids calling them conditionally. Nothing they produce
  // is *read* unless `interactive` is true, so the default render is untouched.
  const interactive = hasInteractiveMedia(interactiveMedia, features)
  const rowCount = features?.length ?? 0

  const [selectedIndex, setSelectedIndex] = useState(0)
  // Guards against an editor deleting rows while the section is mounted.
  const activeIndex = rowCount > 0 ? Math.min(selectedIndex, rowCount - 1) : 0

  const finePointer = useFinePointer()
  const selectionMode = selectionModeFromPointer(finePointer)
  const prefersReducedMotion = useReducedMotion() ?? false

  const baseId = useId()
  const paneId = `${baseId}-media`
  const rowId = (index: number) => `${baseId}-row-${index}`

  // Roving tabindex. Focus moves by element id rather than through a ref array
  // so nothing ref-shaped has to travel down through props.
  const handleRowKeyDown = (index: number) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      // A <button> would fire onClick for these anyway; taking them here
      // keeps Space from scrolling the page behind the section.
      event.preventDefault()
      setSelectedIndex(index)
      return
    }
    const next = nextFeatureIndex(index, event.key, rowCount)
    if (next === index) return
    event.preventDefault()
    setSelectedIndex(next)
    if (typeof document !== 'undefined') {
      document.getElementById(rowId(next))?.focus()
    }
  }

  // One <img> per *distinct* screenshot, plus the row → layer mapping. Rows
  // that fall back to the same section image therefore share a single layer
  // instead of mounting a duplicate download per row.
  const { layers, rowLayerIndex } = buildMediaLayers(interactive ? features : undefined, image)

  const activeLayer = rowLayerIndex[activeIndex] ?? -1
  const activeAlt = resolveActiveAlt(features, activeIndex, image, title)

  // In interactive mode the pane can be fed entirely by row images, so a
  // section with no section-level image still gets a media column.
  const showMedia = interactive
    ? mediaPosition !== 'none' && layers.length > 0 && activeLayer >= 0
    : hasMediaColumn(mediaPosition, imageSrc)

  // Media style from the DS (or the shared fallbacks)
  const resolvedStyle = resolveMediaStyle(mediaStyleKey, designSystem?.mediaStyles)
  const hasFixedAspect = Boolean(resolvedStyle.aspectRatio && resolvedStyle.aspectRatio !== 'auto')
  const imgContainerStyle: React.CSSProperties = {
    borderRadius: resolvedStyle.borderRadius ? `${resolvedStyle.borderRadius}px` : undefined,
    // Always required so the hover zoom is clipped and the radius reaches the image
    overflow: 'hidden',
    aspectRatio: hasFixedAspect ? resolvedStyle.aspectRatio : undefined,
  }
  const imgStyle: React.CSSProperties = {
    objectFit: resolvedStyle.objectFit ?? 'cover',
    width: '100%',
    height: hasFixedAspect ? '100%' : 'auto',
    display: 'block',
  }

  // Cross-fade + row highlight transitions, built from the same DS motion
  // tokens the SlideUp entrances above already use. `prefers-reduced-motion`
  // drops them entirely: the swap becomes an instant cut, never a jump.
  const easeCss = cssEasing(ease)
  const mediaTransition = prefersReducedMotion ? undefined : `opacity ${duration}s ${easeCss}`
  const rowTransition = prefersReducedMotion
    ? undefined
    : `background-color ${duration}s ${easeCss}, border-color ${duration}s ${easeCss}, color ${duration}s ${easeCss}`

  // ── Header ────────────────────────────────────────────────────────────────
  const header = (
    <SlideUp duration={duration} ease={ease} delay={0}>
      {eyebrow && (
        <EyebrowLabel
          eyebrow={eyebrow}
          designSystem={designSystem}
          defaultAccent="none"
          className="mb-4"
        />
      )}
      {title && (
        <h2
          className="[--fs-h2:1.875rem] md:[--fs-h2:2.25rem]"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-h2, var(--fs-h2))', fontWeight: 'var(--font-weight-h2, 600)', lineHeight: 'var(--line-height-h2, 1.375)', letterSpacing: 'var(--letter-spacing-h2, -0.025em)' }}
        >
          {renderHeadline(title, headlineAccent)}
        </h2>
      )}
      {intro && (
        <p
          className="mt-6 max-w-2xl text-base leading-relaxed"
          style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}
        >
          {intro}
        </p>
      )}
      <div className="mt-8 h-px w-12" style={{ backgroundColor: 'var(--color-border)' }} />
    </SlideUp>
  )

  // ── Feature column (rows + closing line + CTAs) ───────────────────────────
  const featureColumn = (
    <div>
      {features && features.length > 0 && (
        interactive ? (
          // One SlideUp around the whole list rather than one per row: a
          // tablist must own its tabs directly, and a per-row motion wrapper
          // would sit between them in the accessibility tree.
          <SlideUp duration={duration} ease={ease} delay={0}>
            <div
              role="tablist"
              aria-orientation="vertical"
              aria-label={title}
              className="grid gap-0"
              style={{ borderTop: '1px solid var(--color-border)' }}
            >
              {features.map((feature, index) => (
                <FeatureRowItem
                  key={feature._key}
                  feature={feature}
                  interaction={{
                    id: rowId(index),
                    paneId,
                    selected: index === activeIndex,
                    onSelect: () => setSelectedIndex(index),
                    onPointerEnter:
                      selectionMode === 'hover' ? () => setSelectedIndex(index) : undefined,
                    onKeyDown: handleRowKeyDown(index),
                    transition: rowTransition,
                  }}
                />
              ))}
            </div>
          </SlideUp>
        ) : (
          <div className="grid gap-0" style={{ borderTop: '1px solid var(--color-border)' }}>
            {features.map((feature, index) => (
              <SlideUp
                key={feature._key}
                duration={duration}
                ease={ease}
                delay={index * 0.05}
              >
                <FeatureRowItem feature={feature} />
              </SlideUp>
            ))}
          </div>
        )
      )}

      {closingLine && (
        <SlideUp duration={duration} ease={ease} delay={0.1}>
          <p
            className="mt-8 text-base font-bold tracking-tight"
            style={{ color: 'var(--color-primary)', fontFamily: 'var(--font-heading)' }}
          >
            {closingLine}
          </p>
        </SlideUp>
      )}

      <CtaRow section={section} />
    </div>
  )

  // ── Media column ──────────────────────────────────────────────────────────
  const mediaColumn = showMedia ? (
    <SlideUp duration={duration} ease={ease} delay={0.1} className="flex items-start justify-center">
      {interactive ? (
        <div
          id={paneId}
          role="tabpanel"
          aria-labelledby={rowId(activeIndex)}
          tabIndex={0}
          className="w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ outlineColor: 'var(--color-primary)' }}
        >
          <InteractiveMediaBlock
            layers={layers}
            activeLayer={activeLayer}
            alt={activeAlt}
            mockupFrame={mockupFrame}
            mockupTitle={mockupTitle}
            mockupBadge={mockupBadge}
            containerStyle={imgContainerStyle}
            imgStyle={imgStyle}
            stretch={hasFixedAspect}
            transition={mediaTransition}
          />
        </div>
      ) : (
        <MediaBlock
          imageSrc={imageSrc as string}
          srcSet={srcSet}
          alt={image?.alt ?? title ?? ''}
          mockupFrame={mockupFrame}
          mockupTitle={mockupTitle}
          mockupBadge={mockupBadge}
          containerStyle={imgContainerStyle}
          imgStyle={imgStyle}
        />
      )}
    </SlideUp>
  ) : null

  // ── Layout: no media (Qualification shape) ────────────────────────────────
  // Header becomes the left column, feature rows the right. Single column
  // below md — the original had a hardcoded 1fr 1fr with no breakpoint.
  if (!showMedia) {
    return (
      <SectionContainer id={section.anchorId} style={surfaceStyles}>
        <div className={`grid gap-12 ${featureGridColsClass(contentRatio, false)} md:gap-16 lg:gap-24 items-start`}>
          <div>{header}</div>
          {featureColumn}
        </div>
      </SectionContainer>
    )
  }

  // ── Layout: media + features (ProductShowcase shape) ──────────────────────
  // Header spans the full width, then a two-column band. Single column below md
  // — the original had a hardcoded 1.1fr 0.9fr with no breakpoint.
  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      <div className="mb-14 md:mb-16">{header}</div>
      <div className={`grid gap-12 ${featureGridColsClass(contentRatio, mediaOnLeft)} md:gap-16 lg:gap-20 items-start`}>
        <div className={mediaOnLeft ? '' : 'order-last md:order-none'}>
          {mediaOnLeft ? mediaColumn : featureColumn}
        </div>
        <div className={mediaOnLeft ? 'order-last md:order-none' : ''}>
          {mediaOnLeft ? featureColumn : mediaColumn}
        </div>
      </div>
    </SectionContainer>
  )
}
