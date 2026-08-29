/**
 * Design-system heading typography → CSS custom properties.
 *
 * WHY THIS EXISTS
 * ---------------
 * Section components used to hardcode Tailwind size classes
 * (`text-5xl md:text-6xl lg:text-7xl`), so editing `designSystem.typography`
 * in the Studio had literally no effect on rendered headings. The heading
 * elements now read `font-size: var(--font-size-h1, var(--fs-h1))`, where
 * `--fs-h1` is the component's own legacy step scale (still expressed as
 * Tailwind arbitrary properties, so the breakpoints stay in the markup).
 *
 * Consequence — and this is the live-site safety property:
 *   • DS has a size for the level  → `--font-size-hN` is emitted → DS wins.
 *   • DS has no size for the level → the var is NOT emitted → the fallback
 *     (the component's original Tailwind steps) renders, byte-identical to
 *     what shipped before this change.
 *
 * THE FLUID FORMULA
 * -----------------
 * A fixed rem taken straight from the DS would be worse than the old stepped
 * classes on a phone (76px headlines on a 375px screen). So every heading
 * level is emitted as a fluid `clamp()` instead:
 *
 *   max  = the DS size, in px            (exact at viewports >= MAX_VW)
 *   min  = max(MIN_FLOOR_PX, round(max * MOBILE_RATIO))   (never above max)
 *   the middle term is the straight line through (MIN_VW, min) and (MAX_VW, max):
 *     slopeVw   = (max - min) / (MAX_VW - MIN_VW) * 100      → the `vw` term
 *     interceptPx = min - slopeVw / 100 * MIN_VW             → the `rem` term
 *
 *   → clamp(<min>rem, <intercept>rem + <slope>vw, <max>rem)
 *
 * So at 375px the heading is exactly `min`, at 1280px and wider it is exactly
 * the DS size, and it interpolates linearly in between.
 *
 * MOBILE_RATIO (0.62) and MIN_FLOOR_PX (18) are chosen so that `min` lands on
 * roughly the size the old Tailwind base class rendered at 375px:
 *   h1 76px → 47px (was text-5xl = 48px)   h2 54px → 33px (was text-3xl = 30px)
 *   h3 34px → 21px (was text-2xl = 24px)   h4 24px → 18px (was text-xl  = 20px)
 */

import type { Typescale } from '@/lib/sanity/types'

/** Viewport at which a heading reaches its mobile minimum. */
export const MIN_VW = 375
/** Viewport at which a heading reaches the design-system size exactly. */
export const MAX_VW = 1280
/** Mobile minimum as a fraction of the design-system size. */
export const MOBILE_RATIO = 0.62
/** Absolute floor for the mobile minimum, in px. */
export const MIN_FLOOR_PX = 18

/** Heading levels that get a fluid clamp. Body levels stay at a fixed size. */
export const HEADING_LEVELS = ['h1', 'h2', 'h3', 'h4'] as const
export type HeadingLevel = (typeof HEADING_LEVELS)[number]

function rem(px: number): string {
  return `${parseFloat((px / 16).toFixed(4))}rem`
}

/** The mobile minimum for a given design-system size, in px. */
export function fluidMinPx(maxPx: number): number {
  return Math.min(maxPx, Math.max(MIN_FLOOR_PX, Math.round(maxPx * MOBILE_RATIO)))
}

/**
 * Build the fluid `clamp()` for one heading size.
 * Returns a plain rem value when the scale collapses (min === max), because
 * `clamp(x, …, x)` is just `x` with extra steps.
 */
export function fluidHeadingSize(maxPx: number): string {
  if (!Number.isFinite(maxPx) || maxPx <= 0) return ''
  const minPx = fluidMinPx(maxPx)
  if (minPx >= maxPx) return rem(maxPx)

  const slopeVw = ((maxPx - minPx) / (MAX_VW - MIN_VW)) * 100
  const interceptPx = minPx - (slopeVw / 100) * MIN_VW
  const slope = parseFloat(slopeVw.toFixed(4))
  return `clamp(${rem(minPx)}, ${rem(interceptPx)} + ${slope}vw, ${rem(maxPx)})`
}

/**
 * Emit the per-property heading vars for one level.
 * Only properties the design system actually defines are emitted — an absent
 * property means the component's hardcoded fallback keeps rendering.
 */
export function headingVars(level: HeadingLevel, scale: Typescale | undefined, indent = '      '): string[] {
  if (!scale) return []
  const out: string[] = []
  if (scale.size !== undefined && scale.size !== null) {
    const size = fluidHeadingSize(scale.size)
    if (size) out.push(`${indent}--font-size-${level}: ${size};`)
  }
  if (scale.weight !== undefined && scale.weight !== null) {
    out.push(`${indent}--font-weight-${level}: ${scale.weight};`)
  }
  if (scale.lineHeight !== undefined && scale.lineHeight !== null) {
    out.push(`${indent}--line-height-${level}: ${scale.lineHeight};`)
  }
  if (scale.letterSpacing !== undefined && scale.letterSpacing !== null) {
    out.push(`${indent}--letter-spacing-${level}: ${rem(scale.letterSpacing)};`)
  }
  return out
}

/**
 * Tenants pinned to the pre-design-system heading rendering.
 *
 * These sites are live and did not ask for a restyle. Their design system does
 * carry a typographic scale, so without this pin the headings would resize the
 * moment the scale started being consumed (Livener: h1 72px → 68px, section
 * h2 36px → 50px). Skipping emission keeps every component on its legacy
 * fallback, i.e. pixel-identical output.
 *
 * Remove a tenant from this set once its owner has signed off on the
 * design-system-driven scale — no other code change is needed.
 */
export const TYPOGRAPHY_LEGACY_TENANTS: ReadonlySet<string> = new Set(['livener'])

export function isTypographyLegacyTenant(tenantId: string | undefined): boolean {
  return !!tenantId && TYPOGRAPHY_LEGACY_TENANTS.has(tenantId)
}
