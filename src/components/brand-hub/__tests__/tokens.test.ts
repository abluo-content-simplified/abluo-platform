import { describe, it, expect } from 'vitest'
import { buildBrandHubModel } from '@/lib/modules/brand-hub/model'
import { buildTokensCss, buildTokensJson } from '../TokensPanel'
import type { DesignSystem } from '@/lib/sanity/types'

const ds = {
  colors: { darkTheme: { background: '#161D2B', primary: '#FFA22B', accent: '#FFA22B' }, lightTheme: { background: '#FFFFFF' } },
  brandPalette: [{ key: 'orange', name: { en: 'Orange' }, value: '#FFA22B' }],
  typography: { headingFont: { source: 'library', libraryFont: 'Barlow Condensed' } },
} as unknown as DesignSystem

describe('design tokens export (ADR-036 S3, built from the model)', () => {
  const model = buildBrandHubModel(ds, null)
  it('CSS has brand variables and only role variables the website emits', () => {
    const css = buildTokensCss(model)
    expect(css).toContain('--color-brand-orange: #FFA22B;')
    expect(css).toContain('--color-primary: #FFA22B;')
    expect(css).toContain("--font-heading: 'Barlow Condensed', sans-serif;")
    expect(css).not.toContain('--color-accent')
  })
  it('JSON parses and carries the palette', () => {
    const json = JSON.parse(buildTokensJson(model))
    expect(json.brand.orange.value).toBe('#FFA22B')
    expect(json.colours.dark.primary.value).toBe('#FFA22B')
  })
})
