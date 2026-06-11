import type { DesignSystem, SectionSurfaces, GlassStyle } from './types'

export type SurfaceType = 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass' | 'usePagePattern'
export type PagePattern = 'none' | 'alternate1-2' | 'alternate1-2-3'

/**
 * Get the resolved surface for a section based on page pattern and section index
 * @param sectionBackground - The section's background field value
 * @param pagePattern - The page's background pattern
 * @param sectionIndex - The zero-based index of the section in the page
 * @returns The computed surface type
 */
export function computeSectionSurface(
  sectionBackground: SurfaceType | undefined,
  pagePattern: PagePattern | undefined,
  sectionIndex: number
): SurfaceType {
  // Explicit override takes precedence
  if (sectionBackground && sectionBackground !== 'usePagePattern') {
    return sectionBackground
  }

  // Apply page pattern
  const pattern = pagePattern ?? 'none'

  switch (pattern) {
    case 'alternate1-2':
      return sectionIndex % 2 === 0 ? 'surface1' : 'surface2'
    case 'alternate1-2-3':
      const cycle = sectionIndex % 3
      return cycle === 0 ? 'surface1' : cycle === 1 ? 'surface2' : 'surface3'
    case 'none':
    default:
      return 'surface1' // Default fallback
  }
}

/**
 * Get the CSS background color for a given surface
 * @param designSystem - The design system
 * @param surface - The surface type
 * @returns CSS string for background-color, or undefined if surface should be transparent
 */
export function getSurfaceColor(designSystem: DesignSystem | null | undefined, surface: SurfaceType): string | undefined {
  if (!designSystem?.sectionSurfaces) return undefined

  const surfaces = designSystem.sectionSurfaces

  switch (surface) {
    case 'surface1':
      return surfaces.surface1
    case 'surface2':
      return surfaces.surface2
    case 'surface3':
      return surfaces.surface3
    case 'brandSurface':
      return surfaces.brandSurface
    case 'transparent':
    case 'usePagePattern':
      return undefined
    case 'glass':
      // Glass returns undefined here — see getGlassStyles() for full treatment
      return undefined
    default:
      return undefined
  }
}

/**
 * Get the full CSS object for a glass surface
 * @param designSystem - The design system
 * @returns React.CSSProperties for glass surface, or undefined if glass not defined
 */
export function getGlassStyles(
  designSystem: DesignSystem | null | undefined
): React.CSSProperties | undefined {
  if (!designSystem?.sectionSurfaces?.glass) return undefined

  const glass = designSystem.sectionSurfaces.glass

  return {
    backgroundColor: glass.backgroundOklch,
    backdropFilter: glass.backdropBlur ? `blur(${glass.backdropBlur}px)` : undefined,
    border: glass.borderWidth && glass.borderColor
      ? `${glass.borderWidth}px solid ${glass.borderColor}`
      : undefined,
  } as React.CSSProperties
}

/**
 * Get inline styles for a section based on its surface type
 * @param designSystem - The design system
 * @param surface - The surface type
 * @returns React.CSSProperties or undefined
 */
export function getSurfaceStyles(
  designSystem: DesignSystem | null | undefined,
  surface: SurfaceType
): React.CSSProperties | undefined {
  if (surface === 'glass') {
    return getGlassStyles(designSystem)
  }

  const bgColor = getSurfaceColor(designSystem, surface)
  return bgColor ? { backgroundColor: bgColor } : undefined
}
