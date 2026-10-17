/**
 * Brand palette → CSS variables (ADR-036 S2).
 *
 * One source for the variable names, used by the tenant layout (which emits
 * them) and the Brand Hub (which documents them), so the two cannot drift.
 * Only css-safe keys and parseable colours are emitted; anything else is
 * skipped, never "fixed".
 */
import type { BrandPaletteColour, DesignSystem } from '@/lib/sanity/types'
import { parseColor } from '@/lib/design-system/contrast'

export const BRAND_KEY_PATTERN = /^[a-z][a-z0-9-]{0,31}$/

export function brandColourVar(key: string): string {
  return `--color-brand-${key}`
}

/** The palette entries the website emits, in order, first entry wins on a duplicate key. */
export function emittableBrandColours(ds: Pick<DesignSystem, 'brandPalette'> | null | undefined): BrandPaletteColour[] {
  const seen = new Set<string>()
  const out: BrandPaletteColour[] = []
  for (const c of ds?.brandPalette ?? []) {
    const key = c?.key?.trim()
    const value = c?.value?.trim()
    if (!key || !value || !BRAND_KEY_PATTERN.test(key) || seen.has(key)) continue
    if (!parseColor(value) || /[;{}]/.test(value)) continue
    seen.add(key)
    out.push({ ...c, key, value })
  }
  return out
}

/** One `--color-brand-{key}` declaration per colour, for the :root block ('' when none). */
export function brandPaletteCssVars(ds: Pick<DesignSystem, 'brandPalette'> | null | undefined, indent = '      '): string {
  return emittableBrandColours(ds)
    .map((c) => `${indent}${brandColourVar(c.key)}: ${c.value};\n`)
    .join('')
}
