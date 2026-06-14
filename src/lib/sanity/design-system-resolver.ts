/**
 * Design System Inheritance Resolver
 *
 * Handles parent/child design system inheritance with merge rules.
 * Runtime resolution: child fields override parent fields, empty fields inherit.
 *
 * Rules:
 * - LOCAL ONLY: Brand identity (logos, favicons) — never inherit
 * - INHERIT WITH OVERRIDE: Colors, typography, spacing, components — use child if set, else parent
 * - INHERIT + ARRAY_MERGE: Background assets — combine parent + child
 */

import type { DesignSystem } from '@/lib/sanity/types'

interface DesignSystemWithRef extends DesignSystem {
  _id?: string
  parentDesignSystem?: { _ref: string; _type: string } | null
}

/**
 * Check if a value is "empty" (null, undefined, empty string, empty object)
 */
function isEmpty(value: any): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (typeof value === 'object' && Object.keys(value).length === 0) return true
  return false
}

/**
 * Recursively resolve design system inheritance.
 *
 * Fetches parent design system if parentDesignSystem is set, merges values,
 * and returns a complete design system with inherited + local values.
 *
 * @param ds - Child design system
 * @param fetchFn - Function to fetch a design system by ID
 * @param maxDepth - Max inheritance chain depth (prevents infinite recursion)
 * @returns Merged design system with inheritance applied
 */
export async function resolveDesignSystemInheritance(
  ds: DesignSystemWithRef | null,
  fetchFn: (id: string) => Promise<DesignSystemWithRef | null>,
  maxDepth: number = 5
): Promise<DesignSystem | null> {
  if (!ds || maxDepth === 0) return ds

  // Base case: no parent
  if (!ds.parentDesignSystem?._ref) return ds

  // Recursive case: fetch parent and merge
  const parentId = ds.parentDesignSystem._ref
  const parent = await fetchFn(parentId)

  if (!parent) return ds

  // Recursively resolve parent's inheritance
  const resolvedParent = await resolveDesignSystemInheritance(parent, fetchFn, maxDepth - 1)

  // Merge parent + child
  return mergeDesignSystems(resolvedParent, ds)
}

/**
 * Merge parent and child design systems according to inheritance rules.
 *
 * Priority: child values override parent, empty child fields inherit from parent.
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

    // ─── Branding: LOCAL ONLY ─────────────────────────────────
    branding: {
      logo: child.branding?.logo || undefined, // Never inherit
      logoLight: child.branding?.logoLight || undefined, // Never inherit
      favicon: child.branding?.favicon || undefined, // Never inherit
      openGraphImage: child.branding?.openGraphImage || undefined, // Never inherit
      appleTouchIcon: child.branding?.appleTouchIcon || undefined, // Never inherit
    },

    // ─── Background Assets: INHERIT + ARRAY_MERGE ──────────────
    backgroundAssets: mergeBackgroundAssets(parent.backgroundAssets, child.backgroundAssets),

    // ─── Colors: INHERIT WITH OVERRIDE ────────────────────────
    colors: {
      lightTheme: mergeColorTheme(parent.colors?.lightTheme, child.colors?.lightTheme),
      darkTheme: mergeColorTheme(parent.colors?.darkTheme, child.colors?.darkTheme),
    },

    // ─── Typography: INHERIT WITH OVERRIDE ────────────────────
    typography: {
      headingFont: child.typography?.headingFont || parent.typography?.headingFont,
      bodyFont: child.typography?.bodyFont || parent.typography?.bodyFont,
      h1: child.typography?.h1 || parent.typography?.h1,
      h2: child.typography?.h2 || parent.typography?.h2,
      h3: child.typography?.h3 || parent.typography?.h3,
      h4: child.typography?.h4 || parent.typography?.h4,
      bodyLarge: child.typography?.bodyLarge || parent.typography?.bodyLarge,
      body: child.typography?.body || parent.typography?.body,
      small: child.typography?.small || parent.typography?.small,
    },

    // ─── Shape & Spacing: INHERIT WITH OVERRIDE ───────────────
    radius: {
      small: child.radius?.small !== undefined ? child.radius.small : parent.radius?.small,
      medium: child.radius?.medium !== undefined ? child.radius.medium : parent.radius?.medium,
      large: child.radius?.large !== undefined ? child.radius.large : parent.radius?.large,
    },

    spacing: {
      xs: child.spacing?.xs !== undefined ? child.spacing.xs : parent.spacing?.xs,
      s: child.spacing?.s !== undefined ? child.spacing.s : parent.spacing?.s,
      m: child.spacing?.m !== undefined ? child.spacing.m : parent.spacing?.m,
      l: child.spacing?.l !== undefined ? child.spacing.l : parent.spacing?.l,
      xl: child.spacing?.xl !== undefined ? child.spacing.xl : parent.spacing?.xl,
    },

    // ─── Components: INHERIT WITH OVERRIDE ────────────────────
    buttons: {
      primary: {
        lightTheme: mergeButtonStyleTheme(
          parent.buttons?.primary?.lightTheme,
          child.buttons?.primary?.lightTheme
        ),
        darkTheme: mergeButtonStyleTheme(
          parent.buttons?.primary?.darkTheme,
          child.buttons?.primary?.darkTheme
        ),
      },
      secondary: {
        lightTheme: mergeButtonStyleTheme(
          parent.buttons?.secondary?.lightTheme,
          child.buttons?.secondary?.lightTheme
        ),
        darkTheme: mergeButtonStyleTheme(
          parent.buttons?.secondary?.darkTheme,
          child.buttons?.secondary?.darkTheme
        ),
      },
    },

    cards: {
      lightTheme: mergeCardStyleTheme(parent.cards?.lightTheme, child.cards?.lightTheme),
      darkTheme: mergeCardStyleTheme(parent.cards?.darkTheme, child.cards?.darkTheme),
    },

    sectionSurfaces: {
      lightTheme: mergeSectionSurfacesTheme(
        parent.sectionSurfaces?.lightTheme,
        child.sectionSurfaces?.lightTheme
      ),
      darkTheme: mergeSectionSurfacesTheme(
        parent.sectionSurfaces?.darkTheme,
        child.sectionSurfaces?.darkTheme
      ),
    },
  }
}

/**
 * Merge color theme — child values override parent
 */
function mergeColorTheme(
  parent: any,
  child: any
): any {
  if (!parent) return child
  if (!child) return parent
  return {
    background: child.background || parent.background,
    backgroundAlt: child.backgroundAlt || parent.backgroundAlt,
    surface: child.surface || parent.surface,
    primary: child.primary || parent.primary,
    secondary: child.secondary || parent.secondary,
    accent: child.accent || parent.accent,
    textPrimary: child.textPrimary || parent.textPrimary,
    textSecondary: child.textSecondary || parent.textSecondary,
    textMuted: child.textMuted || parent.textMuted,
    border: child.border || parent.border,
    success: child.success || parent.success,
    warning: child.warning || parent.warning,
    danger: child.danger || parent.danger,
  }
}

/**
 * Merge button style theme — child values override parent
 */
function mergeButtonStyleTheme(parent: any, child: any): any {
  if (!parent) return child
  if (!child) return parent
  return {
    background: child.background || parent.background,
    text: child.text || parent.text,
    borderRadius:
      child.borderRadius !== undefined && child.borderRadius !== null
        ? child.borderRadius
        : parent.borderRadius,
    hover: {
      background: child.hover?.background || parent.hover?.background,
      text: child.hover?.text || parent.hover?.text,
    },
  }
}

/**
 * Merge card style theme — child values override parent
 */
function mergeCardStyleTheme(parent: any, child: any): any {
  if (!parent) return child
  if (!child) return parent
  return {
    background: child.background || parent.background,
    border: child.border || parent.border,
  }
}

/**
 * Merge section surfaces theme — child values override parent
 */
function mergeSectionSurfacesTheme(parent: any, child: any): any {
  if (!parent) return child
  if (!child) return parent
  return {
    surface1: child.surface1 || parent.surface1,
    surface2: child.surface2 || parent.surface2,
    surface3: child.surface3 || parent.surface3,
    brandSurface: child.brandSurface || parent.brandSurface,
    glass: mergeGlassStyle(parent.glass, child.glass),
  }
}

/**
 * Merge glass style — child values override parent
 */
function mergeGlassStyle(parent: any, child: any): any {
  if (!parent) return child
  if (!child) return parent
  return {
    backgroundOklch: child.backgroundOklch || parent.backgroundOklch,
    backdropBlur: child.backdropBlur !== undefined ? child.backdropBlur : parent.backdropBlur,
    borderColor: child.borderColor || parent.borderColor,
    borderWidth: child.borderWidth !== undefined ? child.borderWidth : parent.borderWidth,
  }
}

/**
 * Merge background assets arrays — combine parent + child, deduplicate by key
 */
function mergeBackgroundAssets(parent: any[], child: any[]): any[] {
  if (!parent) return child || []
  if (!child) return parent || []

  // Create a map by key to avoid duplicates
  const assetMap = new Map()

  // Add parent assets
  (parent || []).forEach((asset) => {
    if (asset.key) assetMap.set(asset.key, asset)
  })

  // Add/override with child assets
  (child || []).forEach((asset) => {
    if (asset.key) assetMap.set(asset.key, asset)
  })

  return Array.from(assetMap.values())
}
