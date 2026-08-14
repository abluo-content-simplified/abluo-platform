import type { DesignSystem } from '@/lib/sanity/types'

interface Props {
  /** Already-resolved (locale-coalesced) eyebrow text. */
  eyebrow: string
  designSystem: DesignSystem | null
  /**
   * True when the eyebrow renders over a media background (hero image/video)
   * and needs a white marker + text for contrast, instead of the DS token colors.
   */
  onMedia?: boolean
  className?: string
  /**
   * Optional pre-resolved image URL for the 'brandMark' accent. Identity assets
   * live per-site in Website Settings, so callers supply the site logo here when
   * available; when absent, 'brandMark' falls back to a dot.
   */
  brandMarkSrc?: string
}

/**
 * EyebrowLabel — shared eyebrow primitive: accent marker + text.
 *
 * Marker shape is driven by designSystem.eyebrowAccent ('none' | 'dot' |
 * 'square' | 'brandMark'), read directly from the resolved designSystem prop
 * (no CSS var — enum DS field convention, see CLAUDE.md). Default 'dot'.
 *
 * Text styling matches the existing eyebrow look (text-xs font-medium
 * uppercase tracking-[0.2em]) so wiring this in changes only the marker,
 * never the text appearance.
 */
export function EyebrowLabel({ eyebrow, designSystem, onMedia = false, className, brandMarkSrc }: Props) {
  const accent = designSystem?.eyebrowAccent ?? 'dot'
  const markerColor = onMedia ? '#ffffff' : 'var(--color-primary)'
  const textColor = onMedia ? 'rgba(255,255,255,0.6)' : 'var(--color-text-muted)'

  // brandMark falls back to dot when no logo source is supplied — never render a broken image.
  const effectiveAccent = accent === 'brandMark' && !brandMarkSrc ? 'dot' : accent

  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`}>
      {effectiveAccent === 'dot' && (
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: markerColor }}
          aria-hidden="true"
        />
      )}
      {effectiveAccent === 'square' && (
        <span
          className="h-2 w-2 rounded-[1px]"
          style={{ backgroundColor: markerColor }}
          aria-hidden="true"
        />
      )}
      {effectiveAccent === 'brandMark' && brandMarkSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brandMarkSrc} alt="" className="h-4 w-auto" aria-hidden="true" />
      )}
      <p
        className="text-xs font-medium uppercase tracking-[0.2em]"
        style={{ color: textColor }}
      >
        {eyebrow}
      </p>
    </div>
  )
}
