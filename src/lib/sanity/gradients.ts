import type { DesignSystem, SectionGradient, SectionSurfaces } from './types'

/**
 * Gradient section surfaces — design-system tokens turned into CSS.
 *
 * A design system defines up to two named gradients per theme
 * (`sectionSurfaces.{light,dark}Theme.gradient1 / gradient2`). A section picks
 * one through its existing Background Surface field ('gradient1' / 'gradient2'),
 * exactly as it picks Surface 1 or Brand Surface. The section never stores
 * colours or angles itself — the gradient belongs to the design system, so it
 * inherits, themes and stays on-brand like every other surface.
 *
 * The tenant layout emits two CSS variables per gradient:
 *   --section-gradient-N-base   a solid colour painted under the gradient
 *   --section-gradient-N        the background-image layer list (or `none`)
 * getSurfaceStyles() reads them as longhands (backgroundColor/backgroundImage)
 * so they never collide with a component's own background longhands.
 */

export type GradientStyle = 'linear' | 'radial' | 'mesh'

/** Anchor points for mesh blobs, in paint order. Choreography, not content. */
const MESH_ANCHORS = ['15% 20%', '85% 15%', '75% 85%', '20% 90%'] as const

/**
 * Accept only values that look like a single CSS colour expression. These are
 * admin-authored, but a stray `;` or `}` would break out of the custom
 * property in the emitted <style> block and take the rest of the theme with it.
 */
export function isSafeColor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 120 &&
    !/[;{}<>\\]/.test(value)
  )
}

function usableColors(g: SectionGradient | null | undefined): string[] {
  return (g?.colors ?? []).filter(isSafeColor).map((c) => c.trim()).slice(0, 5)
}

function clampAngle(angle: unknown): number {
  const n = typeof angle === 'number' && Number.isFinite(angle) ? angle : 135
  return ((Math.round(n) % 360) + 360) % 360
}

export interface GradientCss {
  /** Solid colour under the gradient — also what shows if the image fails. */
  base: string
  /** Value for background-image. */
  image: string
}

/**
 * Turn a gradient token into CSS. Returns null when the token cannot produce a
 * gradient (unset, or fewer than two usable colours) so the caller can fall
 * back to a plain surface instead of painting nothing.
 */
export function buildGradientCss(
  g: SectionGradient | null | undefined,
  /** 'page' spreads mesh blobs down a tall page instead of around one band. */
  layout: 'section' | 'page' = 'section',
): GradientCss | null {
  const colors = usableColors(g)
  if (colors.length < 2) return null

  const style: GradientStyle = g?.style ?? 'linear'

  switch (style) {
    case 'radial':
      return {
        base: colors[colors.length - 1],
        image: `radial-gradient(120% 120% at 0% 0%, ${colors.join(', ')})`,
      }
    case 'mesh': {
      // First colour is the field; each further colour is a soft blob on top.
      const [field, ...blobs] = colors
      if (layout === 'page') {
        // Alternate sides, evenly spaced from top to bottom, each blob tall
        // enough to meet its neighbour — one composition for the whole page.
        const h = Math.max(25, Math.round(120 / blobs.length))
        const step = blobs.length > 1 ? 100 / (blobs.length - 1) : 0
        const layers = blobs.map(
          (c, i) => `radial-gradient(70% ${h}% at ${i % 2 ? 90 : 10}% ${Math.round(i * step)}%, ${c} 0%, transparent 70%)`,
        )
        return { base: field, image: layers.join(', ') }
      }
      const layers = blobs.map(
        (c, i) => `radial-gradient(at ${MESH_ANCHORS[i % MESH_ANCHORS.length]}, ${c} 0px, transparent 55%)`,
      )
      return { base: field, image: layers.join(', ') }
    }
    case 'linear':
    default:
      return {
        base: colors[0],
        image: `linear-gradient(${clampAngle(g?.angle)}deg, ${colors.join(', ')})`,
      }
  }
}

/**
 * CSS custom-property declarations for one theme's gradients, ready to drop
 * into the tenant layout's theme block. Unset gradients fall back to Surface 2
 * with no image, so choosing "Gradient" on a design system that has none still
 * renders a calm, valid section rather than a transparent hole.
 */
export function gradientCssVars(
  sectionSurfaces: SectionSurfaces | null | undefined,
  theme: 'lightTheme' | 'darkTheme',
  indent = '      ',
): string {
  const surfaces = sectionSurfaces?.[theme]
  return ([1, 2] as const)
    .map((n) => {
      const css = buildGradientCss(n === 1 ? surfaces?.gradient1 : surfaces?.gradient2)
      return [
        `${indent}--section-gradient-${n}-base: ${css?.base ?? 'var(--color-section-surface2)'};`,
        `${indent}--section-gradient-${n}: ${css?.image ?? 'none'};`,
      ].join('\n')
    })
    .join('\n')
}

/**
 * Page background gradient — one gradient behind the whole page.
 *
 * Lives in the design system next to the section gradients
 * (`sectionSurfaces.{light,dark}Theme.pageGradient`). When a design system
 * defines one, the tenant layout paints it on <body> and sections that would
 * otherwise default to Surface 1 become transparent so it shows through. A
 * section that picks its own surface still paints it. Design systems without
 * a page gradient render exactly as before.
 */
export function hasPageGradient(ds: Pick<DesignSystem, 'sectionSurfaces'> | null | undefined): boolean {
  const sectionSurfaces = ds?.sectionSurfaces
  return (
    buildGradientCss(sectionSurfaces?.lightTheme?.pageGradient, 'page') !== null ||
    buildGradientCss(sectionSurfaces?.darkTheme?.pageGradient, 'page') !== null
  )
}

/** CSS custom properties for one theme's page gradient. */
export function pageGradientCssVars(
  sectionSurfaces: SectionSurfaces | null | undefined,
  theme: 'lightTheme' | 'darkTheme',
  indent = '      ',
): string {
  const css = buildGradientCss(sectionSurfaces?.[theme]?.pageGradient, 'page')
  return [
    `${indent}--page-gradient-base: ${css?.base ?? 'var(--color-background)'};`,
    `${indent}--page-gradient: ${css?.image ?? 'none'};`,
  ].join('\n')
}

/**
 * The <body> rule — emitted only for design systems that have a page gradient.
 *
 * <html> gets the base colour on purpose: a body background with nothing on
 * <html> propagates to the canvas, and a propagated background is sized to the
 * viewport — the gradient stopped one screen down. With <html> painted, the
 * body keeps its own background, sized to the body box (the whole page).
 */
export const PAGE_GRADIENT_BODY_RULE = `
    html { background-color: var(--page-gradient-base); }
    body {
      background-color: var(--page-gradient-base);
      background-image: var(--page-gradient);
      background-repeat: no-repeat;
      background-size: 100% 100%;
      min-height: 100vh;
    }`
