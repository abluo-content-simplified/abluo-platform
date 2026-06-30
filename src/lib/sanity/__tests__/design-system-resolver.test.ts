/**
 * Design System Inheritance Resolver — Tests
 *
 * Covers the inheritance scenarios for the Abluo multi-tenant platform.
 * No Sanity connection needed — these test pure merge logic only.
 *
 * Tenant hierarchy used in tests:
 *   Abluo Base  →  Livener    (inherits everything, overrides colors)
 *   Abluo Base  →  Martegani  (inherits everything, overrides colors + heading font)
 *
 * `any` is used intentionally throughout: test fixtures are partial/extended
 * DesignSystem shapes that don't satisfy the full TS interface — that's fine
 * for unit tests. The resolver itself is fully typed.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi } from 'vitest'
import { resolveDesignSystemInheritance } from '../design-system-resolver'
import type { DesignSystem } from '../types'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const abluo_base: DesignSystem & { _id: string; parentDesignSystem: null } = {
  _id: 'abluo-base-ds',
  parentDesignSystem: null,
  name: 'Abluo Base',
  role: 'base',
  colors: {
    lightTheme: {
      background:    'oklch(1 0 0)',
      primary:       'oklch(0.5 0.2 260)',
      textPrimary:   'oklch(0.1 0 0)',
      textSecondary: 'oklch(0.4 0 0)',
    },
    darkTheme: {
      background: 'oklch(0.1 0 0)',
      primary:    'oklch(0.7 0.2 260)',
    },
  },
  typography: {
    headingFont: { source: 'library', libraryFont: 'Inter' },
    bodyFont:    { source: 'library', libraryFont: 'Inter' },
    h1: { size: 48, weight: 700, lineHeight: 1.1 },
    h2: { size: 36, weight: 600, lineHeight: 1.2 },
  },
  radius: { small: 4, medium: 8, large: 16 },
  spacing: { xs: 4, s: 8, m: 16, l: 32, xl: 64 },
  buttons: {
    primary: {
      lightTheme: { background: 'oklch(0.5 0.2 260)', text: 'white', borderRadius: 8 },
      darkTheme:  { background: 'oklch(0.7 0.2 260)', text: 'black', borderRadius: 8 },
    },
    secondary: {
      lightTheme: { background: 'transparent', text: 'oklch(0.5 0.2 260)', borderRadius: 8 },
      darkTheme:  { background: 'transparent', text: 'oklch(0.7 0.2 260)', borderRadius: 8 },
    },
  },
  cards: {
    lightTheme: { background: 'oklch(0.97 0 0)', border: 'oklch(0.9 0 0)' },
    darkTheme:  { background: 'oklch(0.15 0 0)', border: 'oklch(0.2 0 0)' },
  },
  sectionSurfaces: {
    lightTheme: { surface1: 'oklch(1 0 0)', surface2: 'oklch(0.97 0 0)', surface3: 'oklch(0.94 0 0)', brandSurface: 'oklch(0.5 0.2 260)' },
    darkTheme:  { surface1: 'oklch(0.1 0 0)', surface2: 'oklch(0.13 0 0)', surface3: 'oklch(0.16 0 0)', brandSurface: 'oklch(0.3 0.2 260)' },
  },
  glass: {
    backgroundOklch: 'oklch(1 0 0 / 0.7)',
    backdropBlur: 12,
    borderColor: 'oklch(0.9 0 0 / 0.5)',
    borderWidth: 1,
  },
  forms: {
    input: {
      lightTheme: {
        background:    'oklch(1 0 0)',
        border:        'oklch(0.85 0 0)',
        text:          'oklch(0.1 0 0)',
        placeholder:   'oklch(0.6 0 0)',
        focusBorder:   'oklch(0.5 0.2 260)',
        errorBorder:   'oklch(0.5 0.2 30)',
        successBorder: 'oklch(0.5 0.2 140)',
        disabledOpacity: 0.5,
      },
      darkTheme: {
        background:  'oklch(0.15 0 0)',
        border:      'oklch(0.25 0 0)',
        text:        'oklch(0.95 0 0)',
        focusBorder: 'oklch(0.7 0.2 260)',
        disabledOpacity: 0.4,
      },
    },
    textarea: {
      lightTheme: { background: 'oklch(1 0 0)', border: 'oklch(0.85 0 0)', text: 'oklch(0.1 0 0)' },
    },
  },
  navigation: {
    menuRadius: 8,
    menuGap: 4,
    dropdownRadius: 12,
    dropdownStyle: 'solid',
  },
  cardVariants: [
    { key: 'default', label: 'Default', lightTheme: { background: 'oklch(1 0 0)', border: 'oklch(0.9 0 0)' }, darkTheme: { background: 'oklch(0.15 0 0)', border: 'oklch(0.2 0 0)' } },
    { key: 'elevated', label: 'Elevated', lightTheme: { background: 'oklch(1 0 0)', border: 'none' }, darkTheme: { background: 'oklch(0.18 0 0)', border: 'none' } },
  ],
  mediaStyles: [
    { key: 'default',   label: 'Default',        borderRadius: 0,    aspectRatio: 'auto', objectFit: 'cover' },
    { key: 'rounded',   label: 'Rounded',         borderRadius: 16,   aspectRatio: 'auto', objectFit: 'cover' },
    { key: 'circle',    label: 'Circle',          borderRadius: 9999, aspectRatio: '1/1',  objectFit: 'cover' },
  ],
  shadows: {
    card:     '0 1px 3px oklch(0 0 0 / 0.1)',
    dropdown: '0 4px 16px oklch(0 0 0 / 0.12)',
    modal:    '0 8px 32px oklch(0 0 0 / 0.2)',
  },
  layout: {
    maxContentWidth:    1280,
    maxTextWidth:       720,
    sectionPaddingY:    96,
    sectionPaddingYCompact: 56,
    sectionPaddingYLarge:   144,
  },
  branding: {
    logo:    { asset: { _ref: 'abluo-base-logo' } },
    logoLight: { asset: { _ref: 'abluo-base-logo-light' } },
    favicon: { asset: { _ref: 'abluo-base-favicon' } },
    logoHeightDesktop: 32,
    logoHeightMobile:  28,
  },
  backgroundAssets: [
    { key: 'waves', name: 'Waves', lightImage: { asset: { url: '/waves-light.svg' } }, darkImage: { asset: { url: '/waves-dark.svg' } } },
    { key: 'dots',  name: 'Dots',  lightImage: { asset: { url: '/dots-light.svg' } },  darkImage: { asset: { url: '/dots-dark.svg' } } },
  ],
  motion: {
    durationFast:    120,
    durationBase:    200,
    durationSlow:    350,
    durationSlower:  600,
    easingStandard:   'cubic-bezier(0.4, 0, 0.2, 1)',
    easingDecelerate: 'cubic-bezier(0, 0, 0.2, 1)',
    easingAccelerate: 'cubic-bezier(0.4, 0, 1, 1)',
    easingEmphasized: 'cubic-bezier(0.2, 0, 0, 1)',
  },
}

const livener_ds: DesignSystem & { _id: string; parentDesignSystem: { _ref: string; _type: string } } = {
  _id: 'livener-ds',
  parentDesignSystem: { _ref: 'abluo-base-ds', _type: 'reference' },
  name: 'Livener',
  role: 'child',
  // Override colors only — everything else should come from Base
  colors: {
    lightTheme: { primary: 'oklch(0.55 0.2 140)' }, // Livener green
    darkTheme:  { primary: 'oklch(0.7 0.2 140)' },
  },
  // No logo set — should stay undefined after merge (not inherit Base logo)
  branding: {},
}

const martegani_ds: DesignSystem & { _id: string; parentDesignSystem: { _ref: string; _type: string } } = {
  _id: 'martegani-ds',
  parentDesignSystem: { _ref: 'abluo-base-ds', _type: 'reference' },
  name: 'Studio Martegani',
  role: 'child',
  colors: {
    lightTheme: {
      primary:       'oklch(0.4 0.1 30)',   // Martegani terracotta
      textSecondary: 'oklch(0.45 0.05 30)',
    },
  },
  typography: {
    headingFont: { source: 'google', googleFont: 'Playfair Display' }, // Override heading font
  },
  branding: {
    logo: { asset: { _ref: 'martegani-logo' } },
    logoHeightDesktop: 48, // override Base's 32
  },
  cardVariants: [
    { key: 'elevated', label: 'Elevated (Martegani)', lightTheme: { background: 'oklch(0.98 0.01 30)', border: 'none' } }, // override Base's elevated
    { key: 'artwork',  label: 'Artwork Card',         lightTheme: { background: 'oklch(0.95 0.02 30)', border: 'oklch(0.9 0 0)' } }, // new variant
  ],
  mediaStyles: [
    { key: 'rounded',  label: 'Rounded (Martegani)', borderRadius: 24,  aspectRatio: 'auto', objectFit: 'cover' }, // override — larger radius for this DS
    { key: 'portrait', label: 'Portrait',            borderRadius: 4,   aspectRatio: '3/4',  objectFit: 'cover' }, // new style
  ],
}

// ─── Mock fetch function ──────────────────────────────────────────────────────

function makeFetchFn(map: Record<string, any>) {
  return vi.fn(async (id: string) => map[id] ?? null)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('resolveDesignSystemInheritance', () => {

  // ── Null / edge cases ──────────────────────────────────────────────────────

  it('returns null when ds is null', async () => {
    const fetch = makeFetchFn({})
    const result = await resolveDesignSystemInheritance(null, fetch)
    expect(result).toBeNull()
  })

  it('returns ds as-is when there is no parent', async () => {
    const fetch = makeFetchFn({})
    const result = await resolveDesignSystemInheritance(abluo_base as any, fetch)
    expect(fetch).not.toHaveBeenCalled()
    expect(result?.name).toBe('Abluo Base')
  })

  it('returns ds as-is when maxDepth is 0', async () => {
    const fetch = makeFetchFn({ 'abluo-base-ds': abluo_base })
    const result = await resolveDesignSystemInheritance(livener_ds as any, fetch, 0)
    expect(result?.name).toBe('Livener')
    expect(fetch).not.toHaveBeenCalled()
  })

  // ── Abluo Base → Livener ───────────────────────────────────────────────────

  describe('Abluo Base → Livener', () => {
    async function resolve() {
      const fetch = makeFetchFn({ 'abluo-base-ds': abluo_base })
      return resolveDesignSystemInheritance(livener_ds as any, fetch)
    }

    it('calls fetchFn with the parent _ref', async () => {
      const fetch = makeFetchFn({ 'abluo-base-ds': abluo_base })
      await resolveDesignSystemInheritance(livener_ds as any, fetch)
      expect(fetch).toHaveBeenCalledWith('abluo-base-ds')
    })

    it('child name wins', async () => {
      const result = await resolve()
      expect(result?.name).toBe('Livener')
    })

    // Colors — child primary overrides, parent background inherits
    it('inherits parent background color (not set in child)', async () => {
      const result = await resolve()
      expect(result?.colors?.lightTheme?.background).toBe('oklch(1 0 0)')
    })

    it('uses child primary color', async () => {
      const result = await resolve()
      expect(result?.colors?.lightTheme?.primary).toBe('oklch(0.55 0.2 140)')
    })

    it('inherits parent textPrimary (not set in child)', async () => {
      const result = await resolve()
      expect(result?.colors?.lightTheme?.textPrimary).toBe('oklch(0.1 0 0)')
    })

    // Typography — fully inherited
    it('inherits parent headingFont', async () => {
      const result = await resolve()
      expect(result?.typography?.headingFont?.libraryFont).toBe('Inter')
    })

    it('inherits parent h1 typescale', async () => {
      const result = await resolve()
      expect(result?.typography?.h1?.size).toBe(48)
    })

    // Spacing and radius — fully inherited
    it('inherits parent radius', async () => {
      const result = await resolve()
      expect(result?.radius?.medium).toBe(8)
    })

    it('inherits parent spacing', async () => {
      const result = await resolve()
      expect(result?.spacing?.xl).toBe(64)
    })

    // Buttons — fully inherited
    it('inherits parent button primary style', async () => {
      const result = await resolve()
      expect(result?.buttons?.primary?.lightTheme?.background).toBe('oklch(0.5 0.2 260)')
    })

    // Glass — fully inherited
    it('inherits parent global glass token', async () => {
      const result = await resolve()
      expect(result?.glass?.backdropBlur).toBe(12)
      expect(result?.glass?.backgroundOklch).toBe('oklch(1 0 0 / 0.7)')
    })

    // Forms — fully inherited
    it('inherits parent forms.input lightTheme', async () => {
      const result = await resolve()
      expect(result?.forms?.input?.lightTheme?.focusBorder).toBe('oklch(0.5 0.2 260)')
      expect(result?.forms?.input?.lightTheme?.disabledOpacity).toBe(0.5)
    })

    it('inherits parent forms.textarea', async () => {
      const result = await resolve()
      expect(result?.forms?.textarea?.lightTheme?.background).toBe('oklch(1 0 0)')
    })

    // Navigation — fully inherited
    it('inherits parent navigation tokens', async () => {
      const result = await resolve()
      expect(result?.navigation?.menuRadius).toBe(8)
      expect(result?.navigation?.dropdownStyle).toBe('solid')
    })

    // Shadows — fully inherited
    it('inherits parent shadow tokens', async () => {
      const result = await resolve()
      expect(result?.shadows?.card).toBe('0 1px 3px oklch(0 0 0 / 0.1)')
      expect(result?.shadows?.modal).toBe('0 8px 32px oklch(0 0 0 / 0.2)')
    })

    // Layout — fully inherited
    it('inherits parent layout tokens', async () => {
      const result = await resolve()
      expect(result?.layout?.maxContentWidth).toBe(1280)
      expect(result?.layout?.sectionPaddingY).toBe(96)
    })

    // cardVariants — array merged, both base variants present
    it('inherits both base cardVariants', async () => {
      const result = await resolve()
      const keys = result?.cardVariants?.map(v => v.key)
      expect(keys).toContain('default')
      expect(keys).toContain('elevated')
    })

    // backgroundAssets — array merged
    it('inherits parent backgroundAssets', async () => {
      const result = await resolve()
      const keys = result?.backgroundAssets?.map(a => a.key)
      expect(keys).toContain('waves')
      expect(keys).toContain('dots')
    })

    // Branding — LOCAL ONLY
    it('does NOT inherit parent logo (LOCAL ONLY)', async () => {
      const result = await resolve()
      expect(result?.branding?.logo).toBeUndefined()
    })

    it('does NOT inherit parent logoLight (LOCAL ONLY)', async () => {
      const result = await resolve()
      expect(result?.branding?.logoLight).toBeUndefined()
    })

    it('does NOT inherit parent favicon (LOCAL ONLY)', async () => {
      const result = await resolve()
      expect(result?.branding?.favicon).toBeUndefined()
    })

    // logoHeight — INHERIT (sizing token, not identity asset)
    it('inherits parent logoHeightDesktop', async () => {
      const result = await resolve()
      expect(result?.branding?.logoHeightDesktop).toBe(32)
    })

    it('inherits parent logoHeightMobile', async () => {
      const result = await resolve()
      expect(result?.branding?.logoHeightMobile).toBe(28)
    })
  })

  // ── Abluo Base → Martegani ─────────────────────────────────────────────────

  describe('Abluo Base → Martegani', () => {
    async function resolve() {
      const fetch = makeFetchFn({ 'abluo-base-ds': abluo_base })
      return resolveDesignSystemInheritance(martegani_ds as any, fetch)
    }

    it('uses child heading font override (Playfair Display)', async () => {
      const result = await resolve()
      expect(result?.typography?.headingFont?.googleFont).toBe('Playfair Display')
      expect(result?.typography?.headingFont?.source).toBe('google')
    })

    it('inherits parent body font (not overridden)', async () => {
      const result = await resolve()
      expect(result?.typography?.bodyFont?.libraryFont).toBe('Inter')
    })

    it('uses child primary color (terracotta)', async () => {
      const result = await resolve()
      expect(result?.colors?.lightTheme?.primary).toBe('oklch(0.4 0.1 30)')
    })

    it('inherits parent background color', async () => {
      const result = await resolve()
      expect(result?.colors?.lightTheme?.background).toBe('oklch(1 0 0)')
    })

    it('uses own logo (not Base logo)', async () => {
      const result = await resolve()
      expect(result?.branding?.logo?.asset?._ref).toBe('martegani-logo')
    })

    it('does not inherit Base logo even when tenant sets its own', async () => {
      // The tenant logo is its own, not inherited — the _ref should be tenant's
      const result = await resolve()
      expect(result?.branding?.logo?.asset?._ref).not.toBe('abluo-base-logo')
    })

    it('uses child logoHeightDesktop override (48)', async () => {
      const result = await resolve()
      expect(result?.branding?.logoHeightDesktop).toBe(48)
    })

    it('inherits parent logoHeightMobile (not set in Martegani)', async () => {
      const result = await resolve()
      expect(result?.branding?.logoHeightMobile).toBe(28)
    })

    // cardVariants array merge
    it('keeps base "default" variant (not overridden by Martegani)', async () => {
      const result = await resolve()
      const defaultVariant = result?.cardVariants?.find(v => v.key === 'default')
      expect(defaultVariant).toBeDefined()
      expect(defaultVariant?.lightTheme?.background).toBe('oklch(1 0 0)')
    })

    it('uses Martegani override of "elevated" variant', async () => {
      const result = await resolve()
      const elevated = result?.cardVariants?.find(v => v.key === 'elevated')
      expect(elevated?.label).toBe('Elevated (Martegani)')
      expect(elevated?.lightTheme?.background).toBe('oklch(0.98 0.01 30)')
    })

    it('adds Martegani-specific "artwork" variant', async () => {
      const result = await resolve()
      const artwork = result?.cardVariants?.find(v => v.key === 'artwork')
      expect(artwork).toBeDefined()
      expect(artwork?.label).toBe('Artwork Card')
    })

    it('result has 3 cardVariants total (default + elevated + artwork)', async () => {
      const result = await resolve()
      expect(result?.cardVariants?.length).toBe(3)
    })

    // mediaStyles — array merged by key
    it('inherits base "default" mediaStyle (not overridden by Martegani)', async () => {
      const result = await resolve()
      const defaultStyle = result?.mediaStyles?.find(s => s.key === 'default')
      expect(defaultStyle).toBeDefined()
      expect(defaultStyle?.borderRadius).toBe(0)
    })

    it('uses Martegani override of "rounded" mediaStyle', async () => {
      const result = await resolve()
      const rounded = result?.mediaStyles?.find(s => s.key === 'rounded')
      expect(rounded?.label).toBe('Rounded (Martegani)')
      expect(rounded?.borderRadius).toBe(24)
    })

    it('adds Martegani-specific "portrait" mediaStyle', async () => {
      const result = await resolve()
      const portrait = result?.mediaStyles?.find(s => s.key === 'portrait')
      expect(portrait).toBeDefined()
      expect(portrait?.aspectRatio).toBe('3/4')
    })

    it('result has 4 mediaStyles total (default + rounded + circle + portrait)', async () => {
      const result = await resolve()
      expect(result?.mediaStyles?.length).toBe(4)
    })

    // shadows and layout still inherited
    it('inherits parent shadow tokens', async () => {
      const result = await resolve()
      expect(result?.shadows?.dropdown).toBe('0 4px 16px oklch(0 0 0 / 0.12)')
    })

    it('inherits parent layout tokens', async () => {
      const result = await resolve()
      expect(result?.layout?.maxTextWidth).toBe(720)
    })
  })

  // ── logoHeight = 0 is a valid override ────────────────────────────────────

  it('treats logoHeightDesktop = 0 as a valid override (not inherits parent)', async () => {
    const tenantWithZero: any = {
      _id: 'tenant-zero',
      parentDesignSystem: { _ref: 'abluo-base-ds', _type: 'reference' },
      branding: { logoHeightDesktop: 0 },
    }
    const fetch = makeFetchFn({ 'abluo-base-ds': abluo_base })
    const result = await resolveDesignSystemInheritance(tenantWithZero, fetch)
    expect(result?.branding?.logoHeightDesktop).toBe(0)
  })

  // ── Fetch fallback when parent not found ──────────────────────────────────

  it('returns child as-is when parent fetch returns null', async () => {
    const fetch = makeFetchFn({}) // no parent in store
    const result = await resolveDesignSystemInheritance(livener_ds as any, fetch)
    expect(result?.name).toBe('Livener')
  })

  // ── Motion token inheritance ───────────────────────────────────────────────

  describe('motion token inheritance', () => {
    it('Base → Livener: inherits all motion tokens when child sets none', async () => {
      const fetch = makeFetchFn({ 'abluo-base-ds': abluo_base })
      const result = await resolveDesignSystemInheritance(livener_ds as any, fetch)
      expect(result?.motion?.durationFast).toBe(120)
      expect(result?.motion?.durationBase).toBe(200)
      expect(result?.motion?.durationSlow).toBe(350)
      expect(result?.motion?.durationSlower).toBe(600)
      expect(result?.motion?.easingStandard).toBe('cubic-bezier(0.4, 0, 0.2, 1)')
      expect(result?.motion?.easingDecelerate).toBe('cubic-bezier(0, 0, 0.2, 1)')
    })

    it('child overrides single motion token, rest inherited from Base', async () => {
      const tenantWithSlowerMotion: any = {
        _id: 'calm-tenant',
        parentDesignSystem: { _ref: 'abluo-base-ds', _type: 'reference' },
        motion: {
          durationSlower: 900,  // calmer hero transitions
          easingEmphasized: 'cubic-bezier(0.1, 0, 0, 1)',
        },
      }
      const fetch = makeFetchFn({ 'abluo-base-ds': abluo_base })
      const result = await resolveDesignSystemInheritance(tenantWithSlowerMotion, fetch)
      // Overridden tokens
      expect(result?.motion?.durationSlower).toBe(900)
      expect(result?.motion?.easingEmphasized).toBe('cubic-bezier(0.1, 0, 0, 1)')
      // Inherited tokens (unchanged)
      expect(result?.motion?.durationFast).toBe(120)
      expect(result?.motion?.durationBase).toBe(200)
      expect(result?.motion?.durationSlow).toBe(350)
      expect(result?.motion?.easingStandard).toBe('cubic-bezier(0.4, 0, 0.2, 1)')
      expect(result?.motion?.easingDecelerate).toBe('cubic-bezier(0, 0, 0.2, 1)')
    })

    it('child with no motion field inherits entire parent motion object', async () => {
      const tenantNoMotion: any = {
        _id: 'no-motion-tenant',
        parentDesignSystem: { _ref: 'abluo-base-ds', _type: 'reference' },
        colors: { lightTheme: { primary: 'oklch(0.6 0.2 200)' } },
      }
      const fetch = makeFetchFn({ 'abluo-base-ds': abluo_base })
      const result = await resolveDesignSystemInheritance(tenantNoMotion, fetch)
      expect(result?.motion).toBeDefined()
      expect(result?.motion?.durationFast).toBe(120)
      expect(result?.motion?.easingAccelerate).toBe('cubic-bezier(0.4, 0, 1, 1)')
    })
  })

  // ── backgroundAssets deduplication ────────────────────────────────────────

  it('child backgroundAsset overrides parent asset with same key', async () => {
    const tenantWithAssetOverride: any = {
      _id: 'tenant-asset',
      parentDesignSystem: { _ref: 'abluo-base-ds', _type: 'reference' },
      backgroundAssets: [
        { key: 'waves', name: 'Waves (Custom)', lightImage: { asset: { url: '/custom-waves.svg' } } },
        { key: 'circles', name: 'Circles', lightImage: { asset: { url: '/circles.svg' } } },
      ],
    }
    const fetch = makeFetchFn({ 'abluo-base-ds': abluo_base })
    const result = await resolveDesignSystemInheritance(tenantWithAssetOverride, fetch)
    const waves = result?.backgroundAssets?.find(a => a.key === 'waves')
    expect(waves?.name).toBe('Waves (Custom)')
    expect(result?.backgroundAssets?.find(a => a.key === 'dots')).toBeDefined()
    expect(result?.backgroundAssets?.find(a => a.key === 'circles')).toBeDefined()
    expect(result?.backgroundAssets?.length).toBe(3) // waves + dots + circles
  })

  // ── forms.typography inheritance ──────────────────────────────────────────

  describe('forms.typography inheritance', () => {
    const baseWithFormTypo: any = {
      ...abluo_base,
      forms: {
        ...abluo_base.forms,
        typography: {
          labelColor:     'oklch(0.2 0 0)',
          labelSize:      12,
          labelWeight:    500,
          helpTextColor:  'oklch(0.5 0 0)',
          helpTextSize:   12,
          errorTextColor: 'oklch(0.5 0.2 30)',
          errorTextSize:  12,
          requiredColor:  'oklch(0.5 0.2 30)',
        },
      },
    }

    it('child inherits all form typography tokens when none are set', async () => {
      const child: any = {
        _id: 'child-no-form-typo',
        parentDesignSystem: { _ref: 'parent-ds', _type: 'reference' },
      }
      const fetch = makeFetchFn({ 'parent-ds': baseWithFormTypo })
      const result = await resolveDesignSystemInheritance(child, fetch)
      expect(result?.forms?.typography?.labelColor).toBe('oklch(0.2 0 0)')
      expect(result?.forms?.typography?.labelSize).toBe(12)
      expect(result?.forms?.typography?.labelWeight).toBe(500)
      expect(result?.forms?.typography?.helpTextColor).toBe('oklch(0.5 0 0)')
      expect(result?.forms?.typography?.errorTextColor).toBe('oklch(0.5 0.2 30)')
      expect(result?.forms?.typography?.requiredColor).toBe('oklch(0.5 0.2 30)')
    })

    it('child overrides single form typography token, rest inherited', async () => {
      const child: any = {
        _id: 'child-override-typo',
        parentDesignSystem: { _ref: 'parent-ds', _type: 'reference' },
        forms: {
          typography: {
            labelColor: 'oklch(0.1 0 0)',  // darker label
            labelSize:  14,                // larger label
          },
        },
      }
      const fetch = makeFetchFn({ 'parent-ds': baseWithFormTypo })
      const result = await resolveDesignSystemInheritance(child, fetch)
      // Overridden
      expect(result?.forms?.typography?.labelColor).toBe('oklch(0.1 0 0)')
      expect(result?.forms?.typography?.labelSize).toBe(14)
      // Inherited
      expect(result?.forms?.typography?.labelWeight).toBe(500)
      expect(result?.forms?.typography?.helpTextColor).toBe('oklch(0.5 0 0)')
      expect(result?.forms?.typography?.errorTextColor).toBe('oklch(0.5 0.2 30)')
    })

    it('child with no forms field at all still inherits form typography', async () => {
      const child: any = {
        _id: 'child-no-forms',
        parentDesignSystem: { _ref: 'parent-ds', _type: 'reference' },
        colors: { lightTheme: { primary: 'oklch(0.6 0.2 200)' } },
      }
      const fetch = makeFetchFn({ 'parent-ds': baseWithFormTypo })
      const result = await resolveDesignSystemInheritance(child, fetch)
      expect(result?.forms?.typography?.labelColor).toBe('oklch(0.2 0 0)')
      expect(result?.forms?.typography?.errorTextSize).toBe(12)
    })
  })

  // ── forms.geometry inheritance ────────────────────────────────────────────

  describe('forms.geometry inheritance', () => {
    const baseWithFormGeo: any = {
      ...abluo_base,
      forms: {
        ...abluo_base.forms,
        geometry: {
          inputHeight:  44,
          paddingX:     14,
          paddingY:     10,
          labelGap:      6,
          fieldGap:     20,
          borderRadius:  8,
        },
      },
    }

    it('child inherits all form geometry tokens when none are set', async () => {
      const child: any = {
        _id: 'child-no-geo',
        parentDesignSystem: { _ref: 'parent-ds', _type: 'reference' },
      }
      const fetch = makeFetchFn({ 'parent-ds': baseWithFormGeo })
      const result = await resolveDesignSystemInheritance(child, fetch)
      expect(result?.forms?.geometry?.inputHeight).toBe(44)
      expect(result?.forms?.geometry?.paddingX).toBe(14)
      expect(result?.forms?.geometry?.paddingY).toBe(10)
      expect(result?.forms?.geometry?.labelGap).toBe(6)
      expect(result?.forms?.geometry?.fieldGap).toBe(20)
      expect(result?.forms?.geometry?.borderRadius).toBe(8)
    })

    it('child overrides single geometry token, rest inherited', async () => {
      const child: any = {
        _id: 'child-compact',
        parentDesignSystem: { _ref: 'parent-ds', _type: 'reference' },
        forms: {
          geometry: {
            inputHeight: 36,  // compact variant
            paddingY:     7,
          },
        },
      }
      const fetch = makeFetchFn({ 'parent-ds': baseWithFormGeo })
      const result = await resolveDesignSystemInheritance(child, fetch)
      // Overridden
      expect(result?.forms?.geometry?.inputHeight).toBe(36)
      expect(result?.forms?.geometry?.paddingY).toBe(7)
      // Inherited
      expect(result?.forms?.geometry?.paddingX).toBe(14)
      expect(result?.forms?.geometry?.labelGap).toBe(6)
      expect(result?.forms?.geometry?.fieldGap).toBe(20)
      expect(result?.forms?.geometry?.borderRadius).toBe(8)
    })

    it('borderRadius: 0 is treated as a valid override (not inherits parent)', async () => {
      const child: any = {
        _id: 'child-square',
        parentDesignSystem: { _ref: 'parent-ds', _type: 'reference' },
        forms: {
          geometry: { borderRadius: 0 },
        },
      }
      const fetch = makeFetchFn({ 'parent-ds': baseWithFormGeo })
      const result = await resolveDesignSystemInheritance(child, fetch)
      expect(result?.forms?.geometry?.borderRadius).toBe(0)
    })

    it('child with typography override does not reset geometry', async () => {
      const baseWithBoth: any = {
        ...abluo_base,
        forms: {
          ...abluo_base.forms,
          typography: { labelColor: 'oklch(0.2 0 0)', labelSize: 12 },
          geometry:   { inputHeight: 44, paddingX: 14, paddingY: 10, labelGap: 6, fieldGap: 20, borderRadius: 8 },
        },
      }
      const child: any = {
        _id: 'child-typo-only',
        parentDesignSystem: { _ref: 'parent-ds', _type: 'reference' },
        forms: {
          typography: { labelColor: 'oklch(0.1 0 0)' }, // override only typography
        },
      }
      const fetch = makeFetchFn({ 'parent-ds': baseWithBoth })
      const result = await resolveDesignSystemInheritance(child, fetch)
      // Typography override applied
      expect(result?.forms?.typography?.labelColor).toBe('oklch(0.1 0 0)')
      expect(result?.forms?.typography?.labelSize).toBe(12)
      // Geometry fully inherited (not reset by typography override)
      expect(result?.forms?.geometry?.inputHeight).toBe(44)
      expect(result?.forms?.geometry?.borderRadius).toBe(8)
    })
  })

  // ── Font stub inheritance guard (isFontDefined) ───────────────────────────
  //
  // A Sanity document can contain a partial font object such as
  // { source: 'library' } with no libraryFont name set. This happens when a
  // user opens the Studio font picker, selects a source, and saves without
  // completing the selection. The object is truthy, so a naive `||` check
  // treats it as a valid override and silently discards the parent font.
  //
  // isFontDefined() guards against this by requiring an actual usable name.

  describe('font stub guard — incomplete font objects do not shadow parent', () => {
    const parentWithFonts: any = {
      ...abluo_base,
      _id: 'parent-with-fonts',
      parentDesignSystem: null,
      typography: {
        headingFont: { source: 'library', libraryFont: 'Geist' },
        bodyFont:    { source: 'library', libraryFont: 'Geist' },
      },
    }

    it('child with { source: "library" } stub (no libraryFont) inherits parent headingFont', async () => {
      const child: any = {
        _id: 'child-stub',
        parentDesignSystem: { _ref: 'parent-with-fonts', _type: 'reference' },
        typography: {
          headingFont: { source: 'library' }, // stub — no libraryFont
        },
      }
      const fetch = makeFetchFn({ 'parent-with-fonts': parentWithFonts })
      const result = await resolveDesignSystemInheritance(child, fetch)
      expect(result?.typography?.headingFont?.libraryFont).toBe('Geist')
      expect(result?.typography?.headingFont?.source).toBe('library')
    })

    it('child with { source: "google" } stub (no googleFont) inherits parent bodyFont', async () => {
      const child: any = {
        _id: 'child-google-stub',
        parentDesignSystem: { _ref: 'parent-with-fonts', _type: 'reference' },
        typography: {
          bodyFont: { source: 'google' }, // stub — no googleFont
        },
      }
      const fetch = makeFetchFn({ 'parent-with-fonts': parentWithFonts })
      const result = await resolveDesignSystemInheritance(child, fetch)
      expect(result?.typography?.bodyFont?.libraryFont).toBe('Geist')
    })

    it('child with empty string libraryFont inherits parent headingFont', async () => {
      const child: any = {
        _id: 'child-empty-str',
        parentDesignSystem: { _ref: 'parent-with-fonts', _type: 'reference' },
        typography: {
          headingFont: { source: 'library', libraryFont: '' },
        },
      }
      const fetch = makeFetchFn({ 'parent-with-fonts': parentWithFonts })
      const result = await resolveDesignSystemInheritance(child, fetch)
      expect(result?.typography?.headingFont?.libraryFont).toBe('Geist')
    })

    it('child with a complete font definition overrides parent', async () => {
      const child: any = {
        _id: 'child-complete',
        parentDesignSystem: { _ref: 'parent-with-fonts', _type: 'reference' },
        typography: {
          headingFont: { source: 'google', googleFont: 'Playfair Display' },
        },
      }
      const fetch = makeFetchFn({ 'parent-with-fonts': parentWithFonts })
      const result = await resolveDesignSystemInheritance(child, fetch)
      expect(result?.typography?.headingFont?.googleFont).toBe('Playfair Display')
      expect(result?.typography?.headingFont?.source).toBe('google')
    })

    it('child with undefined typography inherits both parent fonts', async () => {
      const child: any = {
        _id: 'child-no-typo',
        parentDesignSystem: { _ref: 'parent-with-fonts', _type: 'reference' },
      }
      const fetch = makeFetchFn({ 'parent-with-fonts': parentWithFonts })
      const result = await resolveDesignSystemInheritance(child, fetch)
      expect(result?.typography?.headingFont?.libraryFont).toBe('Geist')
      expect(result?.typography?.bodyFont?.libraryFont).toBe('Geist')
    })
  })

  // ── Typescale field-level inheritance — FLAT MERGE (ADR-008) ─────────────
  //
  // Typescale fields (h1–small) are FLAT MERGE objects: { size?, weight?,
  // lineHeight?, letterSpacing? }. A child that sets only one field must
  // inherit the rest from parent.
  //
  // Before this fix, these fields used object-level `||`. Any non-null child
  // typescale (even `{ size: 60 }`) replaced the parent's full definition,
  // discarding inherited weight, lineHeight, and letterSpacing.

  describe('typescale inheritance — partial child must not shadow full parent (FLAT MERGE)', () => {
    const parentWithTypescale: any = {
      ...abluo_base,
      _id: 'parent-typo',
      parentDesignSystem: null,
      typography: {
        ...abluo_base.typography,
        h1: { size: 48, weight: 700, lineHeight: 1.1, letterSpacing: -0.5 },
        body: { size: 16, weight: 400, lineHeight: 1.6 },
      },
    }

    it('child overrides only size — inherits weight, lineHeight, letterSpacing from parent', async () => {
      const child: any = {
        _id: 'child-size-only',
        parentDesignSystem: { _ref: 'parent-typo', _type: 'reference' },
        typography: {
          h1: { size: 60 },
        },
      }
      const fetch = makeFetchFn({ 'parent-typo': parentWithTypescale })
      const result = await resolveDesignSystemInheritance(child, fetch)
      expect(result?.typography?.h1?.size).toBe(60)              // child override
      expect(result?.typography?.h1?.weight).toBe(700)           // inherited
      expect(result?.typography?.h1?.lineHeight).toBe(1.1)       // inherited
      expect(result?.typography?.h1?.letterSpacing).toBe(-0.5)   // inherited
    })

    it('child overrides only weight — inherits size, lineHeight, letterSpacing', async () => {
      const child: any = {
        _id: 'child-weight-only',
        parentDesignSystem: { _ref: 'parent-typo', _type: 'reference' },
        typography: {
          h1: { weight: 900 },
        },
      }
      const fetch = makeFetchFn({ 'parent-typo': parentWithTypescale })
      const result = await resolveDesignSystemInheritance(child, fetch)
      expect(result?.typography?.h1?.weight).toBe(900)            // child override
      expect(result?.typography?.h1?.size).toBe(48)              // inherited
      expect(result?.typography?.h1?.lineHeight).toBe(1.1)       // inherited
      expect(result?.typography?.h1?.letterSpacing).toBe(-0.5)   // inherited
    })

    it('child overrides lineHeight — inherits size and weight', async () => {
      const child: any = {
        _id: 'child-lineheight',
        parentDesignSystem: { _ref: 'parent-typo', _type: 'reference' },
        typography: {
          h1: { lineHeight: 1.3 },
        },
      }
      const fetch = makeFetchFn({ 'parent-typo': parentWithTypescale })
      const result = await resolveDesignSystemInheritance(child, fetch)
      expect(result?.typography?.h1?.lineHeight).toBe(1.3)       // child override
      expect(result?.typography?.h1?.size).toBe(48)              // inherited
      expect(result?.typography?.h1?.weight).toBe(700)           // inherited
    })

    it('child overrides letterSpacing — inherits size, weight, lineHeight', async () => {
      const child: any = {
        _id: 'child-letterspacing',
        parentDesignSystem: { _ref: 'parent-typo', _type: 'reference' },
        typography: {
          h1: { letterSpacing: -1.0 },
        },
      }
      const fetch = makeFetchFn({ 'parent-typo': parentWithTypescale })
      const result = await resolveDesignSystemInheritance(child, fetch)
      expect(result?.typography?.h1?.letterSpacing).toBe(-1.0)   // child override
      expect(result?.typography?.h1?.size).toBe(48)              // inherited
      expect(result?.typography?.h1?.weight).toBe(700)           // inherited
      expect(result?.typography?.h1?.lineHeight).toBe(1.1)       // inherited
    })

    it('child with empty typescale object {} inherits full parent typescale', async () => {
      const child: any = {
        _id: 'child-empty-typescale',
        parentDesignSystem: { _ref: 'parent-typo', _type: 'reference' },
        typography: {
          h1: {},  // empty object — all fields should be inherited
        },
      }
      const fetch = makeFetchFn({ 'parent-typo': parentWithTypescale })
      const result = await resolveDesignSystemInheritance(child, fetch)
      expect(result?.typography?.h1?.size).toBe(48)
      expect(result?.typography?.h1?.weight).toBe(700)
      expect(result?.typography?.h1?.lineHeight).toBe(1.1)
      expect(result?.typography?.h1?.letterSpacing).toBe(-0.5)
    })

    it('child with no h1 set inherits full parent h1 typescale', async () => {
      const child: any = {
        _id: 'child-no-h1',
        parentDesignSystem: { _ref: 'parent-typo', _type: 'reference' },
        typography: {
          // h1 not set — should be fully inherited from parent
          headingFont: { source: 'google', googleFont: 'Playfair Display' },
        },
      }
      const fetch = makeFetchFn({ 'parent-typo': parentWithTypescale })
      const result = await resolveDesignSystemInheritance(child, fetch)
      expect(result?.typography?.h1?.size).toBe(48)
      expect(result?.typography?.h1?.weight).toBe(700)
      expect(result?.typography?.h1?.lineHeight).toBe(1.1)
      expect(result?.typography?.h1?.letterSpacing).toBe(-0.5)
    })

    it('standalone DS (no parent): typescale fields work as-is', async () => {
      const standalone: any = {
        _id: 'standalone',
        parentDesignSystem: null,
        typography: {
          h1: { size: 56, weight: 800 },
        },
      }
      const fetch = makeFetchFn({})
      const result = await resolveDesignSystemInheritance(standalone, fetch)
      expect(result?.typography?.h1?.size).toBe(56)
      expect(result?.typography?.h1?.weight).toBe(800)
      expect(result?.typography?.h1?.lineHeight).toBeUndefined()
    })
  })

})
