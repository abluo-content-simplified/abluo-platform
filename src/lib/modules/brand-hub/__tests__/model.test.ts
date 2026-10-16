import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import type { DesignSystem } from '@/lib/sanity/types'
import { buildBrandHubModel, describeColour, pageFromSegments } from '../model'
import type { BrandHubQueryResult } from '../queries'
import { BRAND_HUB_MODULE_ID, BRAND_HUB_ROBOTS, BRAND_HUB_SEGMENT } from '../route'
import { BRAND_GUIDE_PAGE_FIELDS, brandHubSchemaTypes } from '../schema'
import { resolveColours } from '@/lib/design-system/resolved-colours'
import {
  FALLBACK_DARK, FALLBACK_LAYOUT, FALLBACK_LIGHT, FALLBACK_MOTION, FALLBACK_RADIUS, FALLBACK_STATE, KNOWN_TENANT_BRAND_VALUES,
} from '@/lib/design-system/fallback-tokens'
import { parseColor } from '@/lib/design-system/contrast'
import { RESERVED_SLUGS } from '@/lib/platform/reserved-slugs'
import { MODULE_REGISTRY } from '@/lib/modules/registry'

// Fixture: an amber-on-navy brand (test data only — no module code may contain
// a tenant value, see the last describe block).
const ORANGE = 'oklch(0.7886 0.1630 66.32deg)'
const NAVY = 'oklch(0.2309 0.0292 263.75deg)'
const fixtureDs = (): DesignSystem => ({
  colors: {
    darkTheme: {
      background: NAVY,
      backgroundAlt: 'oklch(0.2626 0.0223 288.58deg)',
      primary: ORANGE,
      secondary: 'oklch(0.3515 0.0866 283.66deg)',
      textPrimary: 'oklch(0.9612 0.0000 89.88deg)',
      textSecondary: 'oklch(0.9612 0.0000 89.88deg / 0.55)',
    },
    lightTheme: {
      background: 'oklch(1 0 0)',
      textPrimary: NAVY,
    },
  },
  typography: {
    headingFont: { source: 'library', libraryFont: 'Display Sans' },
    h1: { size: 68, lineHeight: 1.05, weight: 700 },
  },
  radius: { small: 8 },
  spacing: { xs: 4, s: 8 },
  buttons: {
    primary: {
      darkTheme: { background: ORANGE, text: 'oklch(1 0 0)', borderRadius: 100 },
      lightTheme: { background: ORANGE, text: 'oklch(1 0 0)', borderRadius: 100 },
    },
  },
} as unknown as DesignSystem)

const data: BrandHubQueryResult = {
  guide: { _updatedAt: '2026-10-10T10:00:00Z', version: 3, intro: null, colour: { body: null, doDont: [{ _key: 'a', kind: 'dont', imageUrl: 'https://cdn/x.png', caption: 'No' }] } },
  site: {
    _updatedAt: '2026-10-12T08:00:00Z',
    siteName: 'Acme',
    timeZone: 'Europe/Rome',
    logo: { url: 'https://cdn/logo.svg', extension: 'svg' },
    logoLight: { url: 'https://cdn/logo-light.svg', extension: 'svg' },
    faviconPng: { url: 'https://cdn/fav.png', extension: 'png', width: 32, height: 32 },
  },
  ds: { _updatedAt: '2026-10-14T09:30:00Z', backgroundAssets: [{ key: 'waves', name: 'Waves', dark: { url: 'https://cdn/w-d.svg', extension: 'svg' } }] },
}

const role = (m: ReturnType<typeof buildBrandHubModel>, key: string) => m.colours.find((c) => c.key === key)!

describe('colour values (ADR-036 D4)', () => {
  const m = buildBrandHubModel(fixtureDs(), data)

  it('shows the stored value exactly and calculates HEX/RGB from it', () => {
    const p = role(m, 'primary').dark
    expect(p.stored).toBe(ORANGE)
    expect(p.source).toBe('designSystem')
    expect(p.hex).toBe('#FFA22B')
    expect(p.rgb).toBe('rgb(255 162 43)')
    expect(p.approximate).toBe(false)
  })

  it('shows a translucent colour as seen on the theme background', () => {
    const t = role(m, 'textSecondary').dark
    expect(t.alpha).toBeCloseTo(0.55)
    expect(t.compositedOn).toBe('background')
    expect(t.hex).not.toBe(role(m, 'textPrimary').dark.hex)
  })

  it('labels website fallbacks honestly — role borrowing, platform defaults, not set', () => {
    // dark surface unset → backgroundAlt (set)
    expect(role(m, 'surface').dark).toMatchObject({ source: 'designSystem', sameAs: 'backgroundAlt' })
    // dark border unset → platform
    expect(role(m, 'border').dark).toMatchObject({ source: 'platformDefault', stored: FALLBACK_DARK.border })
    // light primary unset → dark primary (historical chain)
    expect(role(m, 'primary').light).toMatchObject({ source: 'designSystem', sameAs: 'primary', stored: ORANGE })
    // accent has no platform value at all
    expect(role(m, 'accent').dark.source).toBe('notSet')
    expect(role(m, 'accent').dark.stored).toBeNull()
  })

  it('flags out-of-gamut OKLCH as approximate', () => {
    expect(parseColor('oklch(0.7 0.4 150)')?.outOfGamut).toBe(true)
    expect(parseColor(ORANGE)?.outOfGamut).toBeUndefined()
    const v = describeColour({ value: 'oklch(0.7 0.4 150)', source: 'designSystem', sameAs: null }, null)
    expect(v.approximate).toBe(true)
  })
})

describe('contrast (ADR-036 D4)', () => {
  const m = buildBrandHubModel(fixtureDs(), data)

  it('measures white text on the amber button as a failure', () => {
    const btn = m.contrast.find((c) => c.theme === 'dark' && c.foreground === 'buttonPrimaryText')!
    expect(btn.ratio).toBeCloseTo(2.01, 2)
    expect(btn.passNormal).toBe(false)
    expect(btn.passLarge).toBe(false)
  })

  it('measures amber on navy as a pass', () => {
    const c = m.contrast.find((x) => x.theme === 'dark' && x.foreground === 'primary' && x.background === 'background')!
    expect(c.ratio).toBeGreaterThan(8)
    expect(c.passNormal).toBe(true)
  })

  it('never measures the same background twice in a theme', () => {
    const dark = m.contrast.filter((c) => c.theme === 'dark' && c.foreground === 'textPrimary')
    const bgs = dark.map((c) => c.backgroundHex)
    expect(new Set(bgs).size).toBe(bgs.length)
  })
})

describe('no invented values (ADR-036 D3)', () => {
  const m = buildBrandHubModel(fixtureDs(), data)

  it('typography: set levels are design-system values, unset levels are Not set', () => {
    const h1 = m.typeLevels.find((l) => l.key === 'h1')!
    expect(h1.size).toEqual({ value: 68, source: 'designSystem' })
    expect(h1.letterSpacing).toEqual({ value: null, source: 'notSet' })
    const body = m.typeLevels.find((l) => l.key === 'body')!
    expect(body.size.source).toBe('notSet')
    expect(m.fonts.find((f) => f.role === 'heading')).toMatchObject({ name: 'Display Sans', source: 'designSystem' })
    expect(m.fonts.find((f) => f.role === 'body')!.source).toBe('platformDefault')
    expect(m.fonts.find((f) => f.role === 'accent')!.source).toBe('notSet')
  })

  it('scales: unset steps are Not set, unless the website renders a platform value', () => {
    expect(m.spacing.find((s) => s.key === 'm')!.value.source).toBe('notSet')
    expect(m.radius.find((s) => s.key === 'medium')!.value).toEqual({ value: FALLBACK_RADIUS.medium, source: 'platformDefault' })
    expect(m.layout.maxContentWidth).toEqual({ value: FALLBACK_LAYOUT.maxContentWidth, source: 'platformDefault' })
    expect(m.layout.maxTextWidth.source).toBe('notSet')
    expect(m.motion.durations[0].value).toEqual({ value: FALLBACK_MOTION.durationFast, source: 'platformDefault' })
    expect(m.shadows.every((s) => s.value.source === 'notSet')).toBe(true)
  })

  it('button radius is the single --radius-btn the website renders', () => {
    expect(m.buttons[0].dark.borderRadius).toEqual({ value: 100, source: 'designSystem' })
    expect(m.buttons[1].light.borderRadius).toEqual({ value: 100, source: 'designSystem' })
  })
})

describe('live, not copied (ADR-036 D2)', () => {
  it('a design-system change shows up in the model', () => {
    const ds = fixtureDs()
    const before = buildBrandHubModel(ds, data)
    ;(ds.colors!.darkTheme as Record<string, string>).primary = 'oklch(0.5 0.1 200deg)'
    const after = buildBrandHubModel(ds, data)
    expect(role(before, 'primary').dark.hex).toBe('#FFA22B')
    expect(role(after, 'primary').dark.stored).toBe('oklch(0.5 0.1 200deg)')
  })

  it('last updated is the latest of guide, site settings and design system', () => {
    expect(buildBrandHubModel(fixtureDs(), data).lastUpdated).toBe('2026-10-14T09:30:00.000Z')
  })

  it('works with no guide document and no data at all', () => {
    const m = buildBrandHubModel(null, null)
    expect(m.version).toBeNull()
    expect(m.assets).toEqual([])
    expect(role(m, 'background').dark).toMatchObject({ source: 'platformDefault' })
  })
})

describe('assets', () => {
  const m = buildBrandHubModel(fixtureDs(), data)
  it('lists the site assets with the background they are meant for', () => {
    expect(m.assets.map((a) => a.key)).toEqual(['logo', 'logoLight', 'faviconPng', 'background:waves:dark'])
    expect(m.assets[0].intendedFor).toBe('dark')
    expect(m.assets[1].intendedFor).toBe('light')
    expect(m.assets[2].previewUrl).toContain('?w=')
    expect(m.assets[0].previewUrl).toBe('https://cdn/logo.svg')
  })
  it('passes do/don’t examples through', () => {
    expect(m.written.colour.doDont[0]).toMatchObject({ kind: 'dont', caption: 'No' })
    expect(m.written.motion).toEqual({ body: null, doDont: [] })
  })
})

describe('resolveColours keeps the historical website chains', () => {
  it('empty design system → the platform fallbacks', () => {
    const rc = resolveColours(null)
    expect(rc.dark.background!.value).toBe(FALLBACK_DARK.background)
    expect(rc.light.surface!.value).toBe(FALLBACK_LIGHT.surface)
    expect(rc.light.primary!.value).toBe(FALLBACK_DARK.primary)
    expect(rc.light.secondary!.value).toBe(FALLBACK_DARK.secondary)
    expect(rc.dark.success!.value).toBe(FALLBACK_STATE.successDark)
    expect(rc.light.danger!.value).toBe(FALLBACK_STATE.dangerLight)
    expect(rc.dark.accent).toBeNull()
    expect(rc.buttons.primary.dark.text.value).toBe(FALLBACK_DARK.background)
    expect(rc.buttons.secondary.light.background.value).toBe('transparent')
    expect(rc.buttons.secondary.light.text.value).toBe(FALLBACK_LIGHT.textPrimary)
  })
  it('textMuted → textSecondary when set', () => {
    const rc = resolveColours(fixtureDs())
    expect(rc.dark.textMuted).toMatchObject({ value: 'oklch(0.9612 0.0000 89.88deg / 0.55)', sameAs: 'textSecondary' })
  })
})

describe('routing and registry', () => {
  it('maps URL segments to pages and rejects unknown ones', () => {
    expect(pageFromSegments(undefined)).toBe('overview')
    expect(pageFromSegments([])).toBe('overview')
    expect(pageFromSegments(['colour'])).toBe('colour')
    expect(pageFromSegments(['overview'])).toBeNull()
    expect(pageFromSegments(['nope'])).toBeNull()
    expect(pageFromSegments(['colour', 'x'])).toBeNull()
  })
  it('is never indexed (D5)', () => {
    expect(BRAND_HUB_ROBOTS).toEqual({ index: false, follow: false })
  })
  it('reserves its segment so no catalogue or page can take it', () => {
    expect(RESERVED_SLUGS).toContain(BRAND_HUB_SEGMENT)
  })
  it('is registered under its id', () => {
    expect(MODULE_REGISTRY.some((m) => m.id === BRAND_HUB_MODULE_ID)).toBe(true)
  })
  it('the route file uses the shared robots constant', () => {
    const src = readFileSync(resolve(__dirname, '../../../../app/[locale]/(website)/[tenant]/brand/[[...page]]/page.tsx'), 'utf8')
    expect(src).toContain('robots: BRAND_HUB_ROBOTS')
    expect(src).toContain('isModuleEnabled(modules, BRAND_HUB_MODULE_ID)')
  })
  it('platform layout defaults match SectionContainer', () => {
    const src = readFileSync(resolve(__dirname, '../../../../components/layout/SectionContainer.tsx'), 'utf8')
    expect(src).toContain(`--layout-max-content-width, ${FALLBACK_LAYOUT.maxContentWidth}px`)
    expect(src).toContain(`--section-padding-y,${FALLBACK_LAYOUT.sectionPaddingY}px`)
  })
})

describe('the guide document stores no design values (D2)', () => {
  it('has no colour, font, size or spacing fields', () => {
    const names: string[] = []
    const walk = (fields: unknown[] | undefined) => {
      for (const f of (fields ?? []) as { name: string; fields?: unknown[] }[]) {
        names.push(f.name)
        walk(f.fields)
      }
    }
    for (const t of brandHubSchemaTypes as unknown as { fields?: unknown[] }[]) walk(t.fields)
    // The page groups are named after hub pages ("colour" holds TEXT about colour).
    const pageKeys = new Set<string>(BRAND_GUIDE_PAGE_FIELDS)
    const forbidden = names.filter((n) => !pageKeys.has(n) && /colou?r|font|size|radius|spacing|shadow|oklch|hex|palette/i.test(n))
    expect(forbidden).toEqual([])
  })
})

describe('no tenant values in module code (CLAUDE.md, AC-16)', () => {
  const roots = [resolve(__dirname, '..'), resolve(__dirname, '../../../../components/brand-hub')]
  const files: string[] = []
  const collect = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { if (name !== '__tests__') collect(p) }
      else if (/\.(ts|tsx)$/.test(name)) files.push(p)
    }
  }
  roots.forEach(collect)

  it('contains no tenant brand value or tenant slug', () => {
    expect(files.length).toBeGreaterThan(5)
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const v of KNOWN_TENANT_BRAND_VALUES) expect(src, `${f} contains ${v}`).not.toContain(v)
      expect(src.toLowerCase(), f).not.toMatch(/livener|martegani|hoffmann|nologo|barlow|poppins/)
    }
  })
})
