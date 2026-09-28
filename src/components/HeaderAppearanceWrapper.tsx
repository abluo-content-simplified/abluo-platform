'use client'

import { useState, useEffect } from 'react'
import type { HeaderAppearance } from '@/lib/sanity/types'

interface HeaderAppearanceWrapperProps {
  config?: HeaderAppearance
  children: React.ReactNode
}

/** Get CSS classes and styles based on appearance mode (initial or scrolled). */
function getHeaderStyles(
  mode: 'initial' | 'scrolled',
  config: HeaderAppearance | undefined
): { resolvedStyle: string; className: string; style: React.CSSProperties } {
  // Defaults matter here more than anywhere else in this component. When a
  // tenant has no headerAppearance at all (siteConfig.headerAppearance null),
  // `style` used to come back undefined for BOTH modes, which matched neither
  // 'solid' nor 'glass' and left bgColor at 'transparent' forever. The header
  // then never gained a background, at the top or scrolled, while the nav sat
  // in --color-text-primary: near-black text over whatever photograph the hero
  // happened to use. Unconfigured must degrade to readable, so the scrolled
  // state falls back to glass.
  const style =
    (mode === 'initial' ? config?.initialStyle : config?.scrolledStyle) ??
    (mode === 'initial' ? 'transparent' : 'glass')
  const opacity = (config?.backgroundOpacity ?? 85) / 100
  const blur = config?.blurEffect ?? true
  const shadow = config?.shadow ?? 'small'
  const height = config?.headerHeight ?? 'normal'
  const customHeight = config?.customHeight
  const zIndex = config?.zIndex ?? 50
  const borderStyle = config?.borderStyle ?? 'onScroll'
  const sticky = config?.stickyHeader ?? true

  // Height classes
  const heightClass = customHeight ? '' : {
    compact: 'h-12',
    normal: 'h-16',
    large: 'h-20',
  }[height]

  // Shadow classes
  const shadowClass = {
    none: '',
    small: 'shadow-sm',
    medium: 'shadow-md',
  }[shadow]

  // Style-specific classes and styles
  let bgColor = 'transparent'
  let backdropClass = ''

  if (style === 'solid') {
    bgColor = `color-mix(in oklch, var(--color-background) ${opacity * 100}%, transparent)`
  } else if (style === 'glass') {
    bgColor = `color-mix(in oklch, var(--color-background) ${opacity * 100}%, transparent)`
    // backdrop-blur-sm (4px) is barely perceptible behind scrolling content;
    // xl (24px) is what actually separates a floating header from the page.
    backdropClass = blur ? 'backdrop-blur-xl saturate-150' : ''
  }
  // transparent: bgColor stays transparent

  // Determine border visibility
  let borderBottom = 'none'
  if (borderStyle === 'always') {
    borderBottom = '1px solid var(--color-border)'
  } else if (borderStyle === 'onScroll') {
    borderBottom = mode === 'scrolled' ? '1px solid var(--color-border)' : 'none'
  }

  const positionClass = sticky ? 'fixed' : 'absolute'
  const className = `${positionClass} left-0 right-0 top-0 flex items-center justify-between px-6 md:px-16 lg:px-24 ${heightClass} ${shadowClass} ${backdropClass}`.trim()

  return {
    resolvedStyle: style,
    className,
    style: {
      backgroundColor: bgColor,
      borderBottom,
      transition: 'all 300ms ease-in-out',
      zIndex,
      height: customHeight ? `${customHeight}px` : undefined,
    },
  }
}

export function HeaderAppearanceWrapper({ config, children }: HeaderAppearanceWrapperProps) {
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    if (!config?.stickyHeader) return

    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [config?.stickyHeader])

  const mode = isScrolled ? 'scrolled' : 'initial'
  const { resolvedStyle, className, style } = getHeaderStyles(mode, config)

  // ── Scrim ──────────────────────────────────────────────────────────────────
  // A transparent header cannot guarantee contrast: the nav is drawn in
  // --color-text-primary, a fixed colour, over whatever photograph the hero
  // happens to carry. A light theme wants dark text; Claudia's hero is a dark
  // forest. No single text colour survives both.
  //
  // So when the header IS transparent, we lay a soft gradient of the theme's
  // OWN background colour behind it, fading to nothing over 1.6x the header
  // height. Light theme gets a pale veil, dark theme a dark one, and
  // --color-text-primary always has something of its own theme to sit on,
  // whatever the image. It reads as depth rather than as a bar, which a solid
  // background would.
  //
  // z-index -1 keeps it behind the nav. The header already establishes a
  // stacking context (it sets z-index itself), so -1 cannot escape behind the
  // hero -- it stays inside the header's own layer.
  const showScrim = resolvedStyle === 'transparent'

  return (
    <header className={className} style={style}>
      {showScrim && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0"
          style={{
            height: '160%',
            zIndex: -1,
            backgroundImage:
              'linear-gradient(to bottom, color-mix(in oklch, var(--color-background) 72%, transparent) 0%, color-mix(in oklch, var(--color-background) 40%, transparent) 55%, transparent 100%)',
            transition: 'opacity 300ms ease-in-out',
          }}
        />
      )}
      {children}
    </header>
  )
}
