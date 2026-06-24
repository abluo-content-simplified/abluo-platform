import type { DesignSystem, SectionSurfaces, SectionSurfacesTheme, GlassStyle } from './types'

export type SurfaceType = 'surface1' | 'surface2' | 'surface3' | 'brandSurface' | 'transparent' | 'glass' | 'usePagePattern'
export type PagePattern = 'none' | 'alternate1-2' | 'alternate1-2-3'
export type ThemeMode = 'light' | 'dark'

/**
 * Detect the current theme from the document element
 * @returns The current theme: 'light' or 'dark'
 */
export function getCurrentTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

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
 * @param theme - (Optional) Theme to use — defaults to current theme
 * @returns CSS string for background-color, or undefined if surface should be transparent
 */
export function getSurfaceColor(
  designSystem: DesignSystem | null | undefined,
  surface: SurfaceType,
  theme?: ThemeMode
): string | undefined {
  if (!designSystem?.sectionSurfaces) return undefined

  const currentTheme = theme ?? getCurrentTheme()
  const themeSurfaces: SectionSurfacesTheme | undefined =
    currentTheme === 'dark'
      ? designSystem.sectionSurfaces.darkTheme
      : designSystem.sectionSurfaces.lightTheme

  if (!themeSurfaces) return undefined

  switch (surface) {
    case 'surface1':
      return themeSurfaces.surface1
    case 'surface2':
      return themeSurfaces.surface2
    case 'surface3':
      return themeSurfaces.surface3
    case 'brandSurface':
      return themeSurfaces.brandSurface
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
 * @param theme - (Optional) Theme to use — defaults to current theme
 * @returns React.CSSProperties for glass surface, or undefined if glass not defined
 */
export function getGlassStyles(
  designSystem: DesignSystem | null | undefined,
  theme?: ThemeMode
): React.CSSProperties | undefined {
  if (!designSystem?.sectionSurfaces) return undefined

  const currentTheme = theme ?? getCurrentTheme()
  const themeSurfaces =
    currentTheme === 'dark'
      ? designSystem.sectionSurfaces.darkTheme
      : designSystem.sectionSurfaces.lightTheme

  if (!themeSurfaces?.glass) return undefined

  const glass = themeSurfaces.glass

  return {
    backgroundColor: 'var(--color-section-glass-bg)',
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
 * @param theme - (Optional) Theme to use — defaults to current theme
 * @returns React.CSSProperties or undefined
 */
export function getSurfaceStyles(
  designSystem: DesignSystem | null | undefined,
  surface: SurfaceType,
  theme?: ThemeMode
): React.CSSProperties | undefined {
  // Use CSS custom properties so dark/light theme switching works in RSC context
  // where getCurrentTheme() always returns 'light' (no window object).
  switch (surface) {
    case 'surface1':
      return { backgroundColor: 'var(--color-section-surface1)' }
    case 'surface2':
      return { backgroundColor: 'var(--color-section-surface2)' }
    case 'surface3':
      return { backgroundColor: 'var(--color-section-surface3)' }
    case 'brandSurface':
      return { backgroundColor: 'var(--color-section-brand-surface)' }
    case 'glass':
      return getGlassStyles(designSystem, theme)
    case 'transparent':
    case 'usePagePattern':
    default:
      return undefined
  }
}
