/**
 * Design System Inheritance Resolver
 *
 * Handles parent/child design system inheritance with merge rules.
 * Runtime resolution: child fields override parent fields, empty fields inherit.
 *
 * Inheritance rules:
 *
 * LOCAL ONLY — never inherited from parent (brand identity assets):
 *   branding.logo, branding.logoLight, branding.favicon,
 *   branding.openGraphImage, branding.appleTouchIcon
 *   Reason: each tenant has its own visual identity; inheriting a logo would
 *   make a child tenant accidentally show the parent's logo.
 *
 * INHERIT WITH OVERRIDE — use child value if set, else fall back to parent:
 *   colors, typography, radius, spacing, buttons, cards, sectionSurfaces,
 *   glass, forms, navigation, shadows, layout,
 *   branding.logoHeightDesktop, branding.logoHeightMobile
 *   (logo sizing is a design token, not a brand identity asset)
 *
 * INHERIT + ARRAY_MERGE — combine parent + child arrays, child wins on key collision:
 *   backgroundAssets, cardVariants
 *
 * Adding a new field?
 *   1. Add it to DS_FIELDS_SELECTION in queries.ts (single GROQ source of truth)
 *   2. Add merge logic here in mergeDesignSystems()
 *   3. For flat objects: use mergeShallowObject()
 *   4. For arrays keyed by .key: use mergeArrayByKey()
 *   5. For nested light/dark theme objects: add a dedicated merge function
 */

import type {
  DesignSystem,
  FormInput,
  FormInputTheme,
  FormTypography,
  FormGeometry,
} from '@/lib/sanity/types'

interface DesignSystemWithRef extends DesignSystem {
  _id?: string
  parentDesignSystem?: { _ref: string; _type: string } | null
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Recursively resolve design system inheritance.
 *
 * Fetches parent design system if parentDesignSystem is set, merges values,
 * and returns a complete design system with inherited + local values.
 *
 * @param ds       Child design system
 * @param fetchFn  Function to fetch a design system by Sanity _id
 * @param maxDepth Max inheritance chain depth (prevents infinite recursion)
 */
export async function resolveDesignSystemInheritance(
  ds: DesignSystemWithRef | null,
  fetchFn: (id: string) => Promise<DesignSystemWithRef | null>,
  maxDepth: number = 5
): Promise<DesignSystem | null> {
  if (!ds || maxDepth === 0) return ds

  // Base case: no parent
  if (!ds.parentDesignSystem?._ref) return ds

  // Recursive case: fetch parent, resolve its inheritance, then merge
  const parentId = ds.parentDesignSystem._ref
  const parent = await fetchFn(parentId)
  if (!parent) return ds

  const resolvedParent = await resolveDesignSystemInheritance(parent, fetchFn, maxDepth - 1)
  return mergeDesignSystems(resolvedParent, ds)
}

// ─── Core merge ───────────────────────────────────────────────────────────────

/**
 * Merge parent and child design systems according to inheritance rules.
 * Priority: child values override parent; empty child fields fall back to parent.
 */
function mergeDesignSystems(
  parent: DesignSystem | null,
  child: DesignSystem | null
): DesignSystem {
  if (!parent) return child || {}
  if (!child) return parent

  return {
    _id: child._id,
    name: child.name || parent.name,
    role: child.role || parent.role,
    description: child.description || parent.description,

    // ─── Branding ────────────────────────────────────────────────────────────
    branding: {
      // LOCAL ONLY — never inherited (brand identity assets)
      logo:            child.branding?.logo            || undefined,
      logoLight:       child.branding?.logoLight       || undefined,
      favicon:         child.branding?.favicon         || undefined,
      openGraphImage:  child.branding?.openGraphImage  || undefined,
      appleTouchIcon:  child.branding?.appleTouchIcon  || undefined,

      // INHERIT WITH OVERRIDE — sizing tokens, not identity
      logoHeightDesktop: child.branding?.logoHeightDesktop !== undefined
        ? child.branding.logoHeightDesktop
        : parent.branding?.logoHeightDesktop,
      logoHeightMobile: child.branding?.logoHeightMobile !== undefined
        ? child.branding.logoHeightMobile
        : parent.branding?.logoHeightMobile,
    },

    // ─── Background Assets: INHERIT + ARRAY_MERGE ────────────────────────────
    // Parent assets provide the base set; child assets override by key or add new ones.
    backgroundAssets: mergeArrayByKey(parent.backgroundAssets, child.backgroundAssets),

    // ─── Colors: INHERIT WITH OVERRIDE ───────────────────────────────────────
    colors: {
      lightTheme: mergeColorTheme(parent.colors?.lightTheme, child.colors?.lightTheme),
      darkTheme:  mergeColorTheme(parent.colors?.darkTheme,  child.colors?.darkTheme),
    },

    // ─── Typography: INHERIT WITH OVERRIDE ───────────────────────────────────
    typography: {
      headingFont: child.typography?.headingFont || parent.typography?.headingFont,
      bodyFont:    child.typography?.bodyFont    || parent.typography?.bodyFont,
      h1:          child.typography?.h1          || parent.typography?.h1,
      h2:          child.typography?.h2          || parent.typography?.h2,
      h3:          child.typography?.h3          || parent.typography?.h3,
      h4:          child.typography?.h4          || parent.typography?.h4,
      bodyLarge:   child.typography?.bodyLarge   || parent.typography?.bodyLarge,
      body:        child.typography?.body        || parent.typography?.body,
      small:       child.typography?.small       || parent.typography?.small,
    },

    // ─── Shape & Spacing: INHERIT WITH OVERRIDE ──────────────────────────────
    // Numbers use !== undefined checks — 0 is a valid override value.
    radius: {
      small:  child.radius?.small  !== undefined ? child.radius.small  : parent.radius?.small,
      medium: child.radius?.medium !== undefined ? child.radius.medium : parent.radius?.medium,
      large:  child.radius?.large  !== undefined ? child.radius.large  : parent.radius?.large,
    },

    spacing: {
      xs: child.spacing?.xs !== undefined ? child.spacing.xs : parent.spacing?.xs,
      s:  child.spacing?.s  !== undefined ? child.spacing.s  : parent.spacing?.s,
      m:  child.spacing?.m  !== undefined ? child.spacing.m  : parent.spacing?.m,
      l:  child.spacing?.l  !== undefined ? child.spacing.l  : parent.spacing?.l,
      xl: child.spacing?.xl !== undefined ? child.spacing.xl : parent.spacing?.xl,
    },

    // ─── Buttons: INHERIT WITH OVERRIDE ──────────────────────────────────────
    buttons: {
      primary: {
        lightTheme: mergeButtonStyleTheme(parent.buttons?.primary?.lightTheme, child.buttons?.primary?.lightTheme),
        darkTheme:  mergeButtonStyleTheme(parent.buttons?.primary?.darkTheme,  child.buttons?.primary?.darkTheme),
      },
      secondary: {
        lightTheme: mergeButtonStyleTheme(parent.buttons?.secondary?.lightTheme, child.buttons?.secondary?.lightTheme),
        darkTheme:  mergeButtonStyleTheme(parent.buttons?.secondary?.darkTheme,  child.buttons?.secondary?.darkTheme),
      },
    },

    // ─── Cards: INHERIT WITH OVERRIDE ────────────────────────────────────────
    /** @deprecated Single-variant card — use cardVariants. Kept for backward compat. */
    cards: {
      lightTheme: mergeCardStyleTheme(parent.cards?.lightTheme, child.cards?.lightTheme),
      darkTheme:  mergeCardStyleTheme(parent.cards?.darkTheme,  child.cards?.darkTheme),
    },

    // ─── Section Surfaces: INHERIT WITH OVERRIDE ─────────────────────────────
    sectionSurfaces: {
      lightTheme: mergeSectionSurfacesTheme(parent.sectionSurfaces?.lightTheme, child.sectionSurfaces?.lightTheme),
      darkTheme:  mergeSectionSurfacesTheme(parent.sectionSurfaces?.darkTheme,  child.sectionSurfaces?.darkTheme),
    },

    // ─── Global Glass Token: INHERIT WITH OVERRIDE ───────────────────────────
    // Consumed by header, navigation dropdown, cards, modals.
    glass: mergeGlassStyle(parent.glass, child.glass),

    // ─── Forms: INHERIT WITH OVERRIDE ────────────────────────────────────────
    // Each element type (input, textarea, etc.) inherits independently.
    // typography and geometry are flat objects — mergeShallowObject handles them.
    forms: {
      input:      mergeFormInput(parent.forms?.input,    child.forms?.input),
      textarea:   mergeFormInput(parent.forms?.textarea, child.forms?.textarea),
      select:     mergeFormInput(parent.forms?.select,   child.forms?.select),
      checkbox:   mergeFormInput(parent.forms?.checkbox, child.forms?.checkbox),
      radio:      mergeFormInput(parent.forms?.radio,    child.forms?.radio),
      typography: mergeShallowObject<FormTypography>(parent.forms?.typography, child.forms?.typography),
      geometry:   mergeShallowObject<FormGeometry>(parent.forms?.geometry,    child.forms?.geometry),
    },

    // ─── Navigation: INHERIT WITH OVERRIDE ───────────────────────────────────
    navigation: mergeShallowObject(parent.navigation, child.navigation),

    // ─── Card Variants: INHERIT + ARRAY_MERGE ────────────────────────────────
    // Parent provides base variant set; child can override by key or add variants.
    cardVariants: mergeArrayByKey(parent.cardVariants, child.cardVariants),

    // ─── Shadows: INHERIT WITH OVERRIDE ──────────────────────────────────────
    shadows: mergeShallowObject(parent.shadows, child.shadows),

    // ─── Layout Tokens: INHERIT WITH OVERRIDE ────────────────────────────────
    layout: mergeShallowObject(parent.layout, child.layout),

    // ─── Motion Tokens: INHERIT WITH OVERRIDE ────────────────────────────────
    // All fields are flat (numbers + strings) — mergeShallowObject handles this.
    // A tenant can override individual tokens (e.g. slower durations for a calmer feel)
    // without touching the rest.
    motion: mergeShallowObject(parent.motion, child.motion),
  }
}

// ─── Generic helpers ─────────────────────────────────────────────────────────

/**
 * Merge a shallow flat object — child non-null/undefined values override parent.
 * Suitable for: navigation, shadows, layout, and any future flat design token group.
 *
 * String fields: child value wins if non-empty.
 * Number fields: child value wins if not undefined/null (0 is a valid override).
 */
function mergeShallowObject<T extends object>(
  parent: T | undefined,
  child: T | undefined
): T | undefined {
  if (!parent && !child) return undefined
  if (!parent) return child
  if (!child) return parent

  const result = { ...parent } as Record<string, unknown>
  for (const [key, value] of Object.entries(child as Record<string, unknown>)) {
    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }
  return result as unknown as T
}

/**
 * Merge two arrays by their `key` field — parent provides the base set,
 * child overrides entries with the same key and appends new ones.
 * Suitable for: backgroundAssets, cardVariants, and any future keyed array.
 */
function mergeArrayByKey<T extends { key: string }>(
  parent: T[] | undefined,
  child: T[] | undefined
): T[] | undefined {
  if (!parent && !child) return undefined
  if (!parent) return child
  if (!child) return parent

  const map = new Map<string, T>()
  for (const item of parent) {
    if (item.key) map.set(item.key, item)
  }
  for (const item of child) {
    if (item.key) map.set(item.key, item)
  }
  return Array.from(map.values())
}

// ─── Field-specific merge helpers ────────────────────────────────────────────

function mergeColorTheme(parent: any, child: any): any {
  if (!parent) return child
  if (!child) return parent
  return {
    background:    child.background    || parent.background,
    backgroundAlt: child.backgroundAlt || parent.backgroundAlt,
    surface:       child.surface       || parent.surface,
    primary:       child.primary       || parent.primary,
    secondary:     child.secondary     || parent.secondary,
    accent:        child.accent        || parent.accent,
    textPrimary:   child.textPrimary   || parent.textPrimary,
    textSecondary: child.textSecondary || parent.textSecondary,
    textMuted:     child.textMuted     || parent.textMuted,
    border:        child.border        || parent.border,
    success:       child.success       || parent.success,
    warning:       child.warning       || parent.warning,
    danger:        child.danger        || parent.danger,
  }
}

function mergeButtonStyleTheme(parent: any, child: any): any {
  if (!parent) return child
  if (!child) return parent
  return {
    background:   child.background   || parent.background,
    text:         child.text         || parent.text,
    borderRadius: child.borderRadius !== undefined && child.borderRadius !== null
      ? child.borderRadius
      : parent.borderRadius,
    hover: {
      background: child.hover?.background || parent.hover?.background,
      text:       child.hover?.text       || parent.hover?.text,
    },
  }
}

function mergeCardStyleTheme(parent: any, child: any): any {
  if (!parent) return child
  if (!child) return parent
  return {
    background: child.background || parent.background,
    border:     child.border     || parent.border,
  }
}

function mergeSectionSurfacesTheme(parent: any, child: any): any {
  if (!parent) return child
  if (!child) return parent
  return {
    surface1:     child.surface1     || parent.surface1,
    surface2:     child.surface2     || parent.surface2,
    surface3:     child.surface3     || parent.surface3,
    brandSurface: child.brandSurface || parent.brandSurface,
    glass:        mergeGlassStyle(parent.glass, child.glass),
  }
}

function mergeGlassStyle(parent: any, child: any): any {
  if (!parent) return child
  if (!child) return parent
  return {
    backgroundOklch: child.backgroundOklch || parent.backgroundOklch,
    backdropBlur:    child.backdropBlur    !== undefined ? child.backdropBlur    : parent.backdropBlur,
    borderColor:     child.borderColor     || parent.borderColor,
    borderWidth:     child.borderWidth     !== undefined ? child.borderWidth     : parent.borderWidth,
  }
}

function mergeFormInputTheme(
  parent: FormInputTheme | undefined,
  child: FormInputTheme | undefined
): FormInputTheme | undefined {
  if (!parent) return child
  if (!child) return parent
  return {
    background:      child.background      || parent.background,
    border:          child.border          || parent.border,
    text:            child.text            || parent.text,
    placeholder:     child.placeholder     || parent.placeholder,
    focusBorder:     child.focusBorder     || parent.focusBorder,
    errorBorder:     child.errorBorder     || parent.errorBorder,
    successBorder:   child.successBorder   || parent.successBorder,
    disabledOpacity: child.disabledOpacity !== undefined
      ? child.disabledOpacity
      : parent.disabledOpacity,
  }
}

function mergeFormInput(
  parent: FormInput | undefined,
  child: FormInput | undefined
): FormInput | undefined {
  if (!parent) return child
  if (!child) return parent
  return {
    lightTheme: mergeFormInputTheme(parent.lightTheme, child.lightTheme),
    darkTheme:  mergeFormInputTheme(parent.darkTheme,  child.darkTheme),
  }
}
