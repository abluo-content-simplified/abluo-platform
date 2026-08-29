import type { CSSProperties } from 'react'
import type { DesignSystem } from '@/lib/sanity/types'

/**
 * 'plain' — inline accent text with the DS marker (section eyebrows, matching
 * the original site's `.section-label`).
 * 'pill'  — bordered, accent-tinted capsule around the same text (the original
 * site's hero eyebrow).
 */
export type EyebrowVariant = 'plain' | 'pill'

/** The DS marker enum, re-exported so call sites can name it. */
export type EyebrowAccent = NonNullable<DesignSystem['eyebrowAccent']>

interface Props {
  /** Already-resolved (locale-coalesced) eyebrow text. */
  eyebrow: string
  designSystem: DesignSystem | null
  /**
   * True when the eyebrow renders over a media background (hero image/video)
   * and needs a white marker + text for contrast, instead of the DS token colors.
   * Ignored by `variant="pill"`, which carries its own tinted backdrop and so
   * keeps the accent colour over media (as the original hero does).
   */
  onMedia?: boolean
  className?: string
  /**
   * Optional pre-resolved image URL for the 'brandMark' accent. Identity assets
   * live per-site in Website Settings, so callers supply the site logo here when
   * available; when absent, 'brandMark' falls back to a dot.
   */
  brandMarkSrc?: string
  /** Visual treatment. Defaults to 'plain' — the inline, un-boxed eyebrow. */
  variant?: EyebrowVariant
  /**
   * What an ABSENT `designSystem.eyebrowAccent` resolves to.
   *
   * Heroes keep 'dot' — the marker they have always drawn. Section eyebrows
   * pass 'none', because they have never drawn a marker: a tenant with no
   * eyebrow DS fields must keep exactly the markerless <p> it renders today.
   * An explicit DS value always wins over this.
   */
  defaultAccent?: EyebrowAccent
  /**
   * Text weight of the 'plain' label. Sections are split between `font-medium`
   * and `font-semibold` today and neither is "wrong", so the weight travels
   * with the call site rather than being flattened.
   */
  weight?: 'medium' | 'semibold'
  /**
   * Optional font-family for the 'plain' label (CtaBannerSection pins its
   * eyebrow to `var(--font-body)`). Omitted → inherited, as before.
   */
  fontFamily?: string
}

/** Accent tint derived from the accent token — never a hardcoded colour. */
const PILL_BG = 'color-mix(in oklch, var(--color-primary) 8%, transparent)'
const PILL_BORDER = 'color-mix(in oklch, var(--color-primary) 22%, transparent)'

/**
 * EyebrowLabel — shared eyebrow primitive: accent marker + text.
 *
 * Marker shape is driven by designSystem.eyebrowAccent ('none' | 'dot' |
 * 'square' | 'brandMark'), read directly from the resolved designSystem prop
 * (no CSS var — enum DS field convention, see CLAUDE.md). When the DS field is
 * absent the marker falls back to the `defaultAccent` prop — 'dot' for heroes
 * (unchanged), 'none' for section eyebrows, which have never drawn one.
 *
 * Text colour is driven by designSystem.eyebrowColor ('muted' | 'accent'),
 * read the same way (enum DS field, no CSS var). Default — and what an absent
 * field resolves to — is 'muted' (`var(--color-text-muted)`), the historical
 * eyebrow colour, so every tenant that has not opted in renders exactly as it
 * did. 'accent' paints the text in `var(--color-primary)`. Over full-bleed
 * media the 'plain' variant still switches to white for contrast, unchanged.
 *
 * Inside the 'pill' variant the 'dot' marker pulses subtly via Tailwind's
 * `motion-safe:animate-pulse` (inert under `prefers-reduced-motion: reduce`).
 * The plain variant's marker is untouched — same classes, no animation.
 */
export function EyebrowLabel({
  eyebrow,
  designSystem,
  onMedia = false,
  className,
  brandMarkSrc,
  variant = 'plain',
  defaultAccent = 'dot',
  weight = 'medium',
  fontFamily,
}: Props) {
  const accent = designSystem?.eyebrowAccent ?? defaultAccent
  const isPill = variant === 'pill'

  // Opt-in text colour. Absent (every tenant that predates the field) → 'muted',
  // i.e. the exact `var(--color-text-muted)` the eyebrow has always used.
  const restColor =
    designSystem?.eyebrowColor === 'accent' ? 'var(--color-primary)' : 'var(--color-text-muted)'

  // The pill's tinted backdrop keeps the text legible over media, so only the
  // plain variant flips to white.
  const useMediaColors = onMedia && !isPill
  const markerColor = useMediaColors ? '#ffffff' : 'var(--color-primary)'
  const textColor = useMediaColors ? 'rgba(255,255,255,0.6)' : restColor

  // brandMark falls back to dot when no logo source is supplied — never render a broken image.
  const effectiveAccent = accent === 'brandMark' && !brandMarkSrc ? 'dot' : accent

  // 6px dot inside the pill (as the original hero); inline, the marker keeps the
  // exact classes and inline style it has always had — 8px box, no animation.
  const dotClass = isPill
    ? 'shrink-0 rounded-full motion-safe:animate-pulse'
    : 'h-2 w-2 rounded-full'
  const squareClass = isPill ? 'shrink-0 rounded-[1px]' : 'h-2 w-2 rounded-[1px]'
  const markerStyle: CSSProperties = {
    backgroundColor: markerColor,
    ...(isPill ? { width: '6px', height: '6px' } : {}),
  }

  const wrapperStyle: CSSProperties = isPill
    ? {
        border: `1px solid ${PILL_BORDER}`,
        backgroundColor: PILL_BG,
        borderRadius: 'var(--radius-full)',
        padding: '0.4rem 0.875rem',
      }
    : {}

  const textStyle: CSSProperties = isPill
    ? { color: textColor, fontFamily: 'var(--font-heading)' }
    : { color: textColor, ...(fontFamily ? { fontFamily } : {}) }

  const marker = (
    <>
      {effectiveAccent === 'dot' && (
        <span className={dotClass} style={markerStyle} aria-hidden="true" />
      )}
      {effectiveAccent === 'square' && (
        <span className={squareClass} style={markerStyle} aria-hidden="true" />
      )}
      {effectiveAccent === 'brandMark' && brandMarkSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brandMarkSrc} alt="" className="h-4 w-auto" aria-hidden="true" />
      )}
    </>
  )

  if (isPill) {
    return (
      <div className={className}>
        <span
          className="inline-flex items-center gap-2.5 text-[0.6875rem] font-bold uppercase tracking-[0.14em]"
          style={{ ...wrapperStyle, ...textStyle }}
        >
          {marker}
          {eyebrow}
        </span>
      </div>
    )
  }

  // Written out in full — Tailwind's scanner only sees literal class names,
  // never an interpolated `font-${weight}`.
  const weightClass = weight === 'semibold' ? 'font-semibold' : 'font-medium'
  const textClass = `text-xs ${weightClass} uppercase tracking-[0.2em]`

  // No marker → no flex wrapper. The label is then the exact same bare <p>
  // (same classes, same inline colour) every section rendered before it was
  // routed through here, so a tenant without eyebrow DS fields is byte-stable.
  if (effectiveAccent === 'none') {
    return (
      <p className={className ? `${className} ${textClass}` : textClass} style={textStyle}>
        {eyebrow}
      </p>
    )
  }

  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`}>
      {marker}
      <p className={textClass} style={textStyle}>
        {eyebrow}
      </p>
    </div>
  )
}
