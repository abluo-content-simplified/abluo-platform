/**
 * The colours a website ACTUALLY renders, per theme, with where each one came
 * from. One function for two readers:
 *
 *  - buildCssVars() in the tenant layout, which emits them as --color-* and
 *    --btn-* custom properties;
 *  - the Brand Hub (ADR-036), which documents them and labels each value
 *    "Design system" or "Platform default".
 *
 * Before this file the fallback chains lived only inside buildCssVars(). A
 * second copy in the hub would drift the first time someone changed a chain,
 * and the hub would then describe a site that does not exist.
 *
 * Pure: no React, no Sanity. The chains are exactly the historical ones —
 * changing any of them changes every website.
 */

import type { DesignSystem } from '@/lib/sanity/types'
import { FALLBACK_DARK, FALLBACK_LIGHT, FALLBACK_STATE } from './fallback-tokens'

export type ResolvedColourRole =
  | 'background' | 'backgroundAlt' | 'surface'
  | 'primary' | 'secondary' | 'accent'
  | 'textPrimary' | 'textSecondary' | 'textMuted'
  | 'border'
  | 'success' | 'warning' | 'danger'

export interface ResolvedColour {
  /** The CSS colour the website renders. */
  value: string
  /** 'designSystem' when it comes from the design system (own role or another role), else the platform fallback. */
  source: 'designSystem' | 'platformDefault'
  /**
   * Set when the value is borrowed from ANOTHER role because this one is unset
   * (e.g. surface → backgroundAlt). For light `primary`/`secondary` it names
   * the dark-theme role of the same name, which light falls back to.
   */
  sameAs: ResolvedColourRole | null
}

export type ResolvedTheme = Record<ResolvedColourRole, ResolvedColour | null>

export interface ResolvedButtonTheme {
  background: ResolvedColour
  text: ResolvedColour
  hoverBackground: ResolvedColour
}

export interface ResolvedColours {
  dark: ResolvedTheme
  light: ResolvedTheme
  buttons: {
    primary: { dark: ResolvedButtonTheme; light: ResolvedButtonTheme }
    secondary: { dark: ResolvedButtonTheme; light: ResolvedButtonTheme }
  }
}

type Theme = NonNullable<NonNullable<DesignSystem['colors']>['darkTheme']>

const own = (v: string | undefined | null): ResolvedColour | null =>
  v ? { value: v, source: 'designSystem', sameAs: null } : null

const borrow = (from: ResolvedColour | null, role: ResolvedColourRole): ResolvedColour | null =>
  from ? { value: from.value, source: from.source, sameAs: from.sameAs ?? role } : null

const fallback = (v: string): ResolvedColour => ({ value: v, source: 'platformDefault', sameAs: null })

function first(...candidates: (ResolvedColour | null)[]): ResolvedColour | null {
  for (const c of candidates) if (c) return c
  return null
}

function resolveTheme(
  t: Theme | undefined,
  base: { background: string; backgroundAlt: string; surface: string; primary: string; secondary: string; textPrimary: string; textSecondary: string; textMuted: string; border: string },
  state: { success: string; warning: string; danger: string },
  primaryFrom: ResolvedColour | null,
  secondaryFrom: ResolvedColour | null,
): ResolvedTheme {
  const backgroundAlt = first(own(t?.backgroundAlt), fallback(base.backgroundAlt))
  const textSecondary = first(own(t?.textSecondary), fallback(base.textSecondary))
  return {
    background: first(own(t?.background), fallback(base.background)),
    backgroundAlt,
    // surface → backgroundAlt (when the design system set it) → platform
    surface: first(own(t?.surface), t?.backgroundAlt ? borrow(backgroundAlt, 'backgroundAlt') : null, fallback(base.surface)),
    primary: first(own(t?.primary), primaryFrom ? borrow(primaryFrom, 'primary') : null, fallback(base.primary)),
    secondary: first(own(t?.secondary), secondaryFrom ? borrow(secondaryFrom, 'secondary') : null, fallback(base.secondary)),
    // No platform accent: the website emits no --color-accent at all.
    accent: own(t?.accent),
    textPrimary: first(own(t?.textPrimary), fallback(base.textPrimary)),
    textSecondary,
    textMuted: first(own(t?.textMuted), t?.textSecondary ? borrow(textSecondary, 'textSecondary') : null, fallback(base.textMuted)),
    border: first(own(t?.border), fallback(base.border)),
    success: first(own(t?.success), fallback(state.success)),
    warning: first(own(t?.warning), fallback(state.warning)),
    danger: first(own(t?.danger), fallback(state.danger)),
  }
}

type ButtonTheme = { background?: string; text?: string; hover?: { background?: string } } | undefined

function resolveButton(
  b: ButtonTheme,
  defaults: { background: ResolvedColour; text: ResolvedColour; hoverBackground: ResolvedColour },
): ResolvedButtonTheme {
  return {
    background: own(b?.background) ?? defaults.background,
    text: own(b?.text) ?? defaults.text,
    hoverBackground: own(b?.hover?.background) ?? defaults.hoverBackground,
  }
}

const TRANSPARENT: ResolvedColour = { value: 'transparent', source: 'platformDefault', sameAs: null }

export function resolveColours(ds: DesignSystem | null | undefined): ResolvedColours {
  const darkT = ds?.colors?.darkTheme as Theme | undefined
  const lightT = ds?.colors?.lightTheme as Theme | undefined

  const dark = resolveTheme(
    darkT,
    FALLBACK_DARK,
    { success: FALLBACK_STATE.successDark, warning: FALLBACK_STATE.warningDark, danger: FALLBACK_STATE.dangerDark },
    null,
    null,
  )
  // Light primary/secondary fall back to the DARK theme's (historical chain).
  const light = resolveTheme(
    lightT,
    { ...FALLBACK_LIGHT, primary: dark.primary!.value, secondary: dark.secondary!.value },
    { success: FALLBACK_STATE.successLight, warning: FALLBACK_STATE.warningLight, danger: FALLBACK_STATE.dangerLight },
    dark.primary!.source === 'designSystem' ? dark.primary : null,
    dark.secondary!.source === 'designSystem' ? dark.secondary : null,
  )

  const btn = ds?.buttons
  const primaryDefaults = (th: ResolvedTheme) => ({
    background: th.primary!, text: th.background!, hoverBackground: th.primary!,
  })
  const secondaryDefaults = (th: ResolvedTheme) => ({
    background: TRANSPARENT, text: th.textPrimary!, hoverBackground: TRANSPARENT,
  })

  return {
    dark,
    light,
    buttons: {
      primary: {
        dark: resolveButton(btn?.primary?.darkTheme as ButtonTheme, primaryDefaults(dark)),
        light: resolveButton(btn?.primary?.lightTheme as ButtonTheme, primaryDefaults(light)),
      },
      secondary: {
        dark: resolveButton(btn?.secondary?.darkTheme as ButtonTheme, secondaryDefaults(dark)),
        light: resolveButton(btn?.secondary?.lightTheme as ButtonTheme, secondaryDefaults(light)),
      },
    },
  }
}
