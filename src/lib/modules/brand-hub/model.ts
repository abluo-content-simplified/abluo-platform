// ── Brand Hub — view model builder (ADR-036) ──────────────────────────────────
//
// Pure: (resolved design system, brandHubQuery result) → BrandHubModel.
// No React, no Sanity client, no project-specific values. Everything shown on
// the hub is computed here, so it is unit-tested once and the pages only paint.
//
// Provenance (ADR-036 D3): a value is "designSystem" when set there, "calculated"
// when derived from one, "platformDefault" when unset and the website renders a
// platform value (read from the SAME constants/resolver the website uses), and
// "notSet" otherwise. Nothing is ever invented.

import type { DesignSystem, FontDefinition, PortableTextContent, Typescale } from '@/lib/sanity/types'
import {
  AA_LARGE,
  AA_NORMAL,
  compositeOver,
  contrastRatio,
  parseColor,
  type Rgb,
} from '@/lib/design-system/contrast'
import { FALLBACK_FONTS, FALLBACK_LAYOUT, FALLBACK_MOTION, FALLBACK_RADIUS } from '@/lib/design-system/fallback-tokens'
import { resolveColours, type ResolvedColour, type ResolvedTheme } from '@/lib/design-system/resolved-colours'
import { brandColourVar, emittableBrandColours } from '@/lib/design-system/brand-palette'
import type { BrandHubAssetMeta, BrandHubGuidePageRow, BrandHubListRow, BrandHubQueryResult, BrandHubStatementRow } from './queries'
import {
  BRAND_HUB_PAGES,
  WRITTEN_PAGES,
  type BrandList,
  type BrandListKey,
  COLOUR_ROLE_KEYS,
  TYPE_LEVEL_KEYS,
  type BrandAsset,
  type BrandHubModel,
  type BrandHubPageId,
  type BrandColour,
  type ContrastSuggestion,
  type BrandGuideChange,
  type BrandGuideStatus,
  type BrandLogoRuleKey,
  type BrandStatement,
  type BrandStatementKey,
  type BrandStatementStatus,
  type ButtonSpec,
  type ButtonThemeSpec,
  type ColourRole,
  type ColourRoleKey,
  type ColourValue,
  type ContrastCheck,
  type DesignValue,
  type DoDontItem,
  type FontFamily,
  type ThemeKey,
  type TypeLevel,
  type WrittenContent,
} from './types'

// ── Small helpers ─────────────────────────────────────────────────────────────

const isSet = <T>(v: T | null | undefined): v is T => v !== undefined && v !== null && v !== ('' as unknown)

function dsOr<T extends number | string>(v: T | null | undefined, platform?: T): DesignValue<T> {
  if (isSet(v)) return { value: v, source: 'designSystem' }
  if (platform !== undefined) return { value: platform, source: 'platformDefault' }
  return { value: null, source: 'notSet' }
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0').toUpperCase()
export const toHex = ([r, g, b]: Rgb) => `#${hex2(r)}${hex2(g)}${hex2(b)}`
export const toRgbString = ([r, g, b]: Rgb) => `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`

const NOT_SET_COLOUR: ColourValue = {
  stored: null, source: 'notSet', sameAs: null, hex: null, rgb: null,
  alpha: 1, compositedOn: null, approximate: false, swatch: null,
}

/** The opaque colour actually seen, for contrast and HEX/RGB. */
function seenRgb(value: string | null | undefined, on: Rgb | null): Rgb | null {
  if (!value) return null
  const p = parseColor(value)
  if (!p) return null
  if (p.alpha >= 1 || !on) return p.rgb
  return compositeOver(p.rgb, p.alpha, on)
}

/**
 * ADR-036 D4 — one colour as the hub shows it. HEX/RGB are calculated (sRGB,
 * clamped + flagged when out of gamut, rounded to integers); a translucent
 * value is shown as it is seen on the theme's background.
 */
export function describeColour(resolved: ResolvedColour | null, themeBackground: Rgb | null): ColourValue {
  if (!resolved) return NOT_SET_COLOUR
  const stored = resolved.value
  const base = {
    stored,
    source: resolved.source,
    sameAs: (resolved.sameAs as ColourRoleKey | null) ?? null,
    swatch: stored,
  }
  if (stored.trim().toLowerCase() === 'transparent') {
    return { ...base, hex: null, rgb: null, alpha: 0, compositedOn: null, approximate: false }
  }
  const p = parseColor(stored)
  if (!p) return { ...base, hex: null, rgb: null, alpha: 1, compositedOn: null, approximate: false }
  const translucent = p.alpha < 1 && themeBackground !== null
  const rgb = translucent ? compositeOver(p.rgb, p.alpha, themeBackground!) : p.rgb
  return {
    ...base,
    hex: toHex(rgb),
    rgb: toRgbString(rgb),
    alpha: p.alpha,
    compositedOn: translucent ? 'background' : null,
    approximate: p.outOfGamut === true,
  }
}

// ── Colours ───────────────────────────────────────────────────────────────────

function themeBackgroundRgb(theme: ResolvedTheme): Rgb | null {
  return seenRgb(theme.background?.value, null)
}

/**
 * The CSS variable the tenant layout emits per role (null = none emitted).
 * A test checks each name against the layout source.
 */
export const ROLE_CSS_VARS: Record<ColourRoleKey, string | null> = {
  background: '--color-background',
  backgroundAlt: '--color-background-alt',
  surface: '--color-surface',
  primary: '--color-primary',
  secondary: '--color-secondary',
  accent: null,
  textPrimary: '--color-text-primary',
  textSecondary: '--color-text-secondary',
  textMuted: '--color-text-muted',
  border: '--color-border',
  success: '--color-success',
  warning: '--color-warning',
  danger: '--color-danger',
}

function buildColours(light: ResolvedTheme, dark: ResolvedTheme): ColourRole[] {
  const lBg = themeBackgroundRgb(light)
  const dBg = themeBackgroundRgb(dark)
  return COLOUR_ROLE_KEYS.map((key) => ({
    key,
    cssVar: ROLE_CSS_VARS[key],
    light: describeColour(light[key], key === 'background' ? null : lBg),
    dark: describeColour(dark[key], key === 'background' ? null : dBg),
  }))
}

function buildButtons(ds: DesignSystem | null, rc: ReturnType<typeof resolveColours>): ButtonSpec[] {
  // The website emits ONE --radius-btn for every button (tenant layout).
  const own = ds?.buttons?.primary?.darkTheme?.borderRadius ?? ds?.buttons?.primary?.lightTheme?.borderRadius
  const radius: DesignValue<number> = isSet(own)
    ? { value: own, source: 'designSystem' }
    : isSet(ds?.radius?.medium)
      ? { value: ds!.radius!.medium!, source: 'designSystem' }
      : { value: FALLBACK_RADIUS.medium, source: 'platformDefault' }

  const spec = (b: ReturnType<typeof resolveColours>['buttons']['primary']['dark'], theme: ResolvedTheme): ButtonThemeSpec => {
    const bg = themeBackgroundRgb(theme)
    return {
      background: describeColour(b.background, bg),
      text: describeColour(b.text, bg),
      hoverBackground: describeColour(b.hoverBackground, bg),
      borderRadius: radius,
    }
  }
  return (['primary', 'secondary'] as const).map((variant) => ({
    variant,
    light: spec(rc.buttons[variant].light, rc.light),
    dark: spec(rc.buttons[variant].dark, rc.dark),
  }))
}

const CONTRAST_FOREGROUNDS: ColourRoleKey[] = [
  'textPrimary', 'textSecondary', 'textMuted',
  'primary', 'secondary', 'accent',
  'success', 'warning', 'danger',
]
const CONTRAST_BACKGROUNDS: ColourRoleKey[] = ['background', 'backgroundAlt', 'surface']

const round2 = (n: number) => Math.round(n * 100) / 100

function check(
  theme: ThemeKey,
  foreground: ContrastCheck['foreground'],
  background: ContrastCheck['background'],
  fg: Rgb,
  bg: Rgb,
): ContrastCheck {
  const ratio = round2(contrastRatio(fg, bg))
  const passNormal = ratio >= AA_NORMAL
  // Buttons: the button colour is the brand decision, so suggest both a text
  // and a background change; for text roles, suggest changing the text.
  const isButton = foreground === 'buttonPrimaryText' || foreground === 'buttonSecondaryText'
  const suggestions: ContrastSuggestion[] = passNormal
    ? []
    : [
        suggestLightness(fg, bg, 'foreground'),
        ...(isButton ? [suggestLightness(bg, fg, 'background')] : []),
      ].filter((x): x is ContrastSuggestion => x !== null)
  return {
    theme, foreground, background,
    foregroundHex: toHex(fg), backgroundHex: toHex(bg),
    ratio, passNormal, passLarge: ratio >= AA_LARGE,
    suggestions,
  }
}

// ── OKLCH helpers (calculated suggestions, approximate print values) ─────────

const toLinear = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/** sRGB (0–255) → OKLCH [L 0–1, C, H degrees]. */
export function rgbToOklch([r, g, b]: Rgb): [number, number, number] {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const C = Math.sqrt(A * A + B * B)
  let H = (Math.atan2(B, A) * 180) / Math.PI
  if (H < 0) H += 360
  return [L, C, H]
}

const oklchString = (L: number, C: number, H: number) => `oklch(${L.toFixed(4)} ${C.toFixed(4)} ${H.toFixed(2)}deg)`

/**
 * The nearest lightness (hue and chroma kept, chroma reduced only if the
 * colour leaves sRGB) at which `change` reaches AA (4.5:1) against `other`.
 * Searches both directions and returns the smaller change; null when none.
 */
export function suggestLightness(change: Rgb, other: Rgb, side: ContrastSuggestion['change']): ContrastSuggestion | null {
  const [L0, C0, H] = rgbToOklch(change)
  let best: { L: number; C: number; rgb: Rgb; ratio: number } | null = null
  for (const dir of [-1, 1]) {
    for (let step = 1; step <= 200; step++) {
      const L = L0 + dir * step * 0.005
      if (L < 0 || L > 1) break
      let C = C0
      let parsed = parseColor(oklchString(L, C, H))
      while (parsed?.outOfGamut && C > 0.001) {
        C *= 0.9
        parsed = parseColor(oklchString(L, C, H))
      }
      if (!parsed) break
      const ratio = contrastRatio(parsed.rgb, other)
      if (ratio >= AA_NORMAL) {
        if (!best || Math.abs(L - L0) < Math.abs(best.L - L0)) best = { L, C, rgb: parsed.rgb, ratio }
        break
      }
    }
  }
  if (!best) return null
  return { change: side, oklch: oklchString(best.L, best.C, H), hex: toHex(best.rgb), ratio: round2(best.ratio) }
}

/** Naive RGB → CMYK, a screen approximation only (print needs a proof). */
export function approximateCmyk([r, g, b]: Rgb): string {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const k = 1 - Math.max(R, G, B)
  if (k >= 1) return '0 0 0 100'
  const f = (x: number) => Math.round(((1 - x - k) / (1 - k)) * 100)
  return `${f(R)} ${f(G)} ${f(B)} ${Math.round(k * 100)}`
}

// ── Brand palette (ADR-036 S2) ───────────────────────────────────────────────

const pickText = (v: Record<string, string | undefined> | null | undefined, locale: string, defaultLocale: string): string | null => {
  if (!v || typeof v !== 'object') return null
  const raw = v[locale] ?? v[defaultLocale] ?? v.en ?? Object.entries(v).find(([k, x]) => !k.startsWith('_') && typeof x === 'string')?.[1]
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

function buildBrandPalette(ds: DesignSystem | null, colours: ColourRole[], locale: string, defaultLocale: string): BrandColour[] {
  return emittableBrandColours(ds).map((c) => {
    const value = describeColour({ value: c.value, source: 'designSystem', sameAs: null } as ResolvedColour, null)
    const parsed = parseColor(c.value)
    const cmyk: DesignValue<string> = c.cmyk?.trim()
      ? { value: c.cmyk.trim(), source: 'designSystem' }
      : parsed
        ? { value: approximateCmyk(parsed.rgb), source: 'calculated' }
        : { value: null, source: 'notSet' }
    const matchesRoles = value.hex
      ? colours.filter((r) => r.light.hex === value.hex || r.dark.hex === value.hex).map((r) => r.key)
      : []
    return {
      key: c.key,
      name: pickText(c.name, locale, defaultLocale) ?? c.key,
      tier: c.tier === 'secondary' || c.tier === 'neutral' ? c.tier : 'primary',
      usage: c.usage === 'screen' || c.usage === 'print' ? c.usage : 'both',
      description: pickText(c.description, locale, defaultLocale),
      uses: pickText(c.uses, locale, defaultLocale),
      cssVar: brandColourVar(c.key),
      value,
      cmyk,
      pantone: c.pantone?.trim() || null,
      matchesRoles,
    }
  })
}

/** ADR-036 D4 — measured pairs, per theme. Duplicated backgrounds are measured once. */
export function buildContrast(rc: ReturnType<typeof resolveColours>): ContrastCheck[] {
  const out: ContrastCheck[] = []
  for (const theme of ['light', 'dark'] as const) {
    const t = rc[theme]
    const page = seenRgb(t.background?.value, null)
    const seenBackgrounds = new Set<string>()
    for (const bgKey of CONTRAST_BACKGROUNDS) {
      const bg = seenRgb(t[bgKey]?.value, page)
      if (!bg) continue
      const id = toHex(bg)
      if (seenBackgrounds.has(id)) continue
      seenBackgrounds.add(id)
      for (const fgKey of CONTRAST_FOREGROUNDS) {
        const fg = seenRgb(t[fgKey]?.value, bg)
        if (!fg) continue
        out.push(check(theme, fgKey, bgKey, fg, bg))
      }
    }
    // Buttons: their text on their own background (a transparent background is the page).
    for (const variant of ['primary', 'secondary'] as const) {
      const b = rc.buttons[variant][theme]
      const bgValue = b.background.value.trim().toLowerCase() === 'transparent' ? t.background?.value : b.background.value
      const bg = seenRgb(bgValue, page)
      const fg = bg ? seenRgb(b.text.value, bg) : null
      if (!bg || !fg) continue
      out.push(check(
        theme,
        variant === 'primary' ? 'buttonPrimaryText' : 'buttonSecondaryText',
        variant === 'primary' ? 'buttonPrimaryBackground' : 'buttonSecondaryBackground',
        fg,
        bg,
      ))
    }
  }
  return out
}

// ── Typography ────────────────────────────────────────────────────────────────

/**
 * Google Fonts page for a family. Every font in the design system's library is
 * a Google font, and 'google' fonts are by definition; anything else gets none.
 */
export function googleFontsUrl(name: string, source: string | null | undefined): string | null {
  if (source !== 'library' && source !== 'google') return null
  if (!/^[A-Za-z0-9 ]{1,60}$/.test(name)) return null
  return `https://fonts.google.com/specimen/${name.trim().replace(/ +/g, '+')}`
}

function fontFamily(role: FontFamily['role'], def: FontDefinition | undefined, platform: string | null): FontFamily {
  const name =
    def?.source === 'google' && def.googleFont?.trim() ? def.googleFont.trim()
      : def?.source === 'library' && def.libraryFont?.trim() ? def.libraryFont.trim()
        : null
  if (name) return { role, name, provider: def!.source ?? null, source: 'designSystem', specimenUrl: googleFontsUrl(name, def!.source) }
  if (platform) return { role, name: platform, provider: null, source: 'platformDefault', specimenUrl: null }
  return { role, name: null, provider: null, source: 'notSet', specimenUrl: null }
}

function typeLevel(key: TypeLevel['key'], t: Typescale | undefined): TypeLevel {
  return {
    key,
    family: key.startsWith('h') ? 'heading' : 'body',
    size: dsOr(t?.size),
    minSize: dsOr(t?.minSize),
    weight: dsOr(t?.weight),
    lineHeight: dsOr(t?.lineHeight),
    letterSpacing: dsOr(t?.letterSpacing),
  }
}

// ── Assets ────────────────────────────────────────────────────────────────────

const RASTER = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'])

function asset(
  key: BrandAsset['key'],
  meta: BrandHubAssetMeta | null | undefined,
  intendedFor: ThemeKey | null,
  name: string | null = null,
): BrandAsset | null {
  if (!meta?.url) return null
  const ext = meta.extension?.toLowerCase() ?? null
  const previewUrl = ext && RASTER.has(ext) && ext !== 'gif'
    ? `${meta.url}?w=1200&fit=max&auto=format`
    : meta.url
  return {
    key, intendedFor, name,
    url: meta.url,
    previewUrl,
    originalFilename: meta.originalFilename ?? null,
    extension: ext,
    mimeType: meta.mimeType ?? null,
    size: meta.size ?? null,
    width: meta.width ?? null,
    height: meta.height ?? null,
  }
}

function buildAssets(data: BrandHubQueryResult | null): BrandAsset[] {
  const s = data?.site
  // The header shows `logoLight` in the light theme and `logo` otherwise — so
  // `logo` is "for dark backgrounds" only when a light variant exists.
  const hasLight = Boolean(s?.logoLight?.url)
  const list: (BrandAsset | null)[] = [
    asset('logo', s?.logo, hasLight ? 'dark' : null),
    asset('logoLight', s?.logoLight, 'light'),
    asset('faviconSvg', s?.faviconSvg, null),
    asset('faviconPng', s?.faviconPng, null),
    asset('openGraphImage', s?.openGraphImage, null),
  ]
  for (const bg of data?.ds?.backgroundAssets ?? []) {
    const k = bg.key || bg.name || 'graphic'
    list.push(asset(`background:${k}:dark` as BrandAsset['key'], bg.dark, 'dark', bg.name ?? null))
    list.push(asset(`background:${k}:light` as BrandAsset['key'], bg.light, 'light', bg.name ?? null))
  }
  return list.filter((a): a is BrandAsset => a !== null)
}

// ── Written content ───────────────────────────────────────────────────────────

function written(row: BrandHubGuidePageRow | null | undefined): WrittenContent {
  const body = Array.isArray(row?.body) && row!.body!.length > 0 ? (row!.body as WrittenContent['body']) : null
  const doDont: DoDontItem[] = (row?.doDont ?? []).map((d) => ({
    key: d._key,
    kind: d.kind === 'dont' ? 'dont' : 'do',
    imageUrl: d.imageUrl ?? null,
    imageAlt: d.caption ?? null,
    caption: d.caption ?? null,
  }))
  const raw = row?.status as BrandStatementStatus | undefined
  const status: BrandStatementStatus | null = !body && doDont.length === 0 ? null : raw && STATUSES.includes(raw) ? raw : 'draft'
  return { status, body, doDont }
}

const STATEMENT_KEYS: BrandStatementKey[] = ['mission', 'vision', 'promise', 'positioning', 'story']
const LIST_KEYS: BrandListKey[] = ['audience', 'differentiators', 'personality', 'values']
const LOGO_RULE_KEYS: BrandLogoRuleKey[] = ['clearSpace', 'minimumDigital', 'minimumPrint', 'backgrounds']
const STATUSES: readonly BrandStatementStatus[] = ['draft', 'approved', 'needsDecision']
const GUIDE_STATUSES: readonly BrandGuideStatus[] = ['draft', 'review', 'published']
const MAX_CHANGES = 5

/**
 * Statements / rules in a fixed order. Unwritten text → null; an unwritten
 * slot reads as `needsDecision`, a written one without a status as `draft`
 * (never "approved" by default).
 */
function statements<K extends string>(keys: K[], rows: Record<string, BrandHubStatementRow | null> | null | undefined): BrandStatement<K>[] {
  return keys.map((key) => {
    const row = rows?.[key]
    const text = typeof row?.text === 'string' && row.text.trim() ? row.text.trim() : null
    const raw = row?.status as BrandStatementStatus | undefined
    const status: BrandStatementStatus = !text ? 'needsDecision' : raw && STATUSES.includes(raw) ? raw : 'draft'
    return { key, text, status }
  })
}

const cleanText = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Foundation lists in a fixed order; an empty list reads as needsDecision, a filled one without status as draft. */
function lists(rows: Record<string, BrandHubListRow | null> | null | undefined): BrandList[] {
  return LIST_KEYS.map((key) => {
    const row = rows?.[key]
    const items = (row?.items ?? [])
      .map((i) => ({ key: i._key, title: cleanText(i.title) ?? '', text: cleanText(i.text), note: cleanText(i.note) }))
      .filter((i) => i.title)
    const intro = cleanText(row?.intro)
    const outro = cleanText(row?.outro)
    const empty = !intro && !outro && items.length === 0
    const raw = row?.status as BrandStatementStatus | undefined
    const status: BrandStatementStatus = empty ? 'needsDecision' : raw && STATUSES.includes(raw) ? raw : 'draft'
    return { key, status, intro, items, outro }
  })
}

function changes(rows: NonNullable<BrandHubQueryResult['guide']>['changes']): BrandGuideChange[] {
  return (rows ?? [])
    .filter((r) => typeof r?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && typeof r.note === 'string' && r.note.trim())
    .map((r) => ({ key: r._key, date: r.date as string, note: (r.note as string).trim() }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, MAX_CHANGES)
}

const portable = (v: unknown): PortableTextContent | null => (Array.isArray(v) && v.length > 0 ? (v as PortableTextContent) : null)

function latest(...isoDates: (string | null | undefined)[]): string | null {
  const ts = isoDates.filter(isSet).map((d) => Date.parse(d)).filter((n) => !Number.isNaN(n))
  return ts.length ? new Date(Math.max(...ts)).toISOString() : null
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function buildBrandHubModel(
  ds: DesignSystem | null,
  data: BrandHubQueryResult | null,
  opts: { locale?: string; defaultLocale?: string } = {},
): BrandHubModel {
  const rc = resolveColours(ds)
  const colours = buildColours(rc.light, rc.dark)
  const typo = ds?.typography
  const guide = data?.guide ?? null

  const writtenPages = Object.fromEntries(WRITTEN_PAGES.map((p) => [p, written(guide?.[p])])) as BrandHubModel['written']

  return {
    projectName: data?.site?.siteName ?? null,
    version: isSet(guide?.version) ? guide!.version! : null,
    lastUpdated: latest(guide?._updatedAt, data?.site?._updatedAt, data?.ds?._updatedAt, data?.ds?.parentUpdatedAt, data?.ds?.grandparentUpdatedAt),
    timeZone: data?.site?.timeZone ?? null,

    status: guide ? (GUIDE_STATUSES.includes(guide.status as BrandGuideStatus) ? (guide.status as BrandGuideStatus) : 'draft') : null,
    intro: portable(guide?.intro),
    statements: statements(STATEMENT_KEYS, guide?.statements),
    lists: lists(guide?.lists),
    howToUse: portable(guide?.howToUse),
    changes: changes(guide?.changes),
    logoRules: statements(LOGO_RULE_KEYS, guide?.logoRules),
    written: writtenPages,

    colours,
    brandPalette: buildBrandPalette(ds, colours, opts.locale ?? 'en', opts.defaultLocale ?? opts.locale ?? 'en'),
    buttons: buildButtons(ds, rc),
    contrast: buildContrast(rc),

    fonts: [
      fontFamily('heading', typo?.headingFont, FALLBACK_FONTS.heading),
      fontFamily('body', typo?.bodyFont, FALLBACK_FONTS.body),
      fontFamily('accent', typo?.accentFont, null),
    ],
    typeLevels: TYPE_LEVEL_KEYS.map((k) => typeLevel(k, typo?.[k])),

    spacing: (['xs', 's', 'm', 'l', 'xl'] as const).map((key) => ({ key, value: dsOr(ds?.spacing?.[key]) })),
    radius: (['small', 'medium', 'large'] as const).map((key) => ({ key, value: dsOr(ds?.radius?.[key], FALLBACK_RADIUS[key]) })),
    shadows: (['card', 'dropdown', 'modal'] as const).map((key) => ({ key, value: dsOr(ds?.shadows?.[key]) })),

    layout: {
      maxContentWidth: dsOr(ds?.layout?.maxContentWidth, FALLBACK_LAYOUT.maxContentWidth),
      maxTextWidth: dsOr(ds?.layout?.maxTextWidth),
      sectionPaddingY: dsOr(ds?.layout?.sectionPaddingY, FALLBACK_LAYOUT.sectionPaddingY),
      sectionPaddingYCompact: dsOr(ds?.layout?.sectionPaddingYCompact),
      sectionPaddingYLarge: dsOr(ds?.layout?.sectionPaddingYLarge),
    },

    motion: {
      durations: (['durationFast', 'durationBase', 'durationSlow', 'durationSlower'] as const).map((key) => ({
        key, value: dsOr(ds?.motion?.[key], FALLBACK_MOTION[key]),
      })),
      easings: (['easingStandard', 'easingDecelerate', 'easingAccelerate', 'easingEmphasized'] as const).map((key) => ({
        key, value: dsOr(ds?.motion?.[key], FALLBACK_MOTION[key]),
      })),
    },

    assets: buildAssets(data),
  }
}

/** URL segment → page id; null for an unknown segment (the route 404s). */
export function pageFromSegments(segments: string[] | undefined): BrandHubPageId | null {
  if (!segments || segments.length === 0) return 'overview'
  if (segments.length > 1) return null
  const id = segments[0]
  return id !== 'overview' && (BRAND_HUB_PAGES as readonly string[]).includes(id) ? (id as BrandHubPageId) : null
}
