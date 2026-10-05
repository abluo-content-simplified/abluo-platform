/**
 * Abluo App theme preference (ADR-025 D7).
 *
 * The app (client dashboard, wizard, later the admin) has its own light/dark
 * preference, separate from the tenant websites' theme switch (`abluo-theme`,
 * `html.light`). It lives in one cookie so the server can render the right
 * theme on the first paint — no boot script, no flash:
 *   - 'system' → no `data-theme` on `.abluo-app`; CSS follows the device
 *   - 'light' | 'dark' → `data-theme` set; CSS uses that palette
 *
 * Pure module: no I/O. The cookie is read in `(client)/layout.tsx` and written
 * by `AppThemeSwitch`.
 */

export const APP_THEME_COOKIE = 'abluo-app-theme'

/** One year — a preference, not a session. */
export const APP_THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export const APP_THEMES = ['system', 'light', 'dark'] as const
export type AppTheme = (typeof APP_THEMES)[number]

/** Anything unknown, missing or tampered with means "follow the device". */
export function parseAppTheme(value: string | undefined | null): AppTheme {
  return value === 'light' || value === 'dark' ? value : 'system'
}

/** The `data-theme` attribute for `.abluo-app`: absent for 'system'. */
export function appThemeAttribute(theme: AppTheme): 'light' | 'dark' | undefined {
  return theme === 'system' ? undefined : theme
}

/** The cookie string the switch writes (client side). */
export function appThemeCookie(theme: AppTheme): string {
  return `${APP_THEME_COOKIE}=${theme}; path=/; max-age=${APP_THEME_COOKIE_MAX_AGE}; SameSite=Lax`
}

// ── Text size (accessibility) ────────────────────────────────────────────────
// Per-person preference, same cookie pattern as the theme so the first paint is
// already right. Applied as `data-text-size` on `.abluo-app` (absent = default);
// globals.css scales the whole app (text, controls, spacing) with CSS `zoom`, so
// fixed px sizes scale too and tap targets grow with the text.

export const APP_TEXT_SIZE_COOKIE = 'abluo-app-text'
export const APP_TEXT_SIZES = ['sm', 'md', 'lg', 'xl'] as const
export type AppTextSize = (typeof APP_TEXT_SIZES)[number]

export function parseAppTextSize(value: string | undefined | null): AppTextSize {
  return value === 'sm' || value === 'lg' || value === 'xl' ? value : 'md'
}

/** The `data-text-size` attribute for `.abluo-app`: absent for the default. */
export function appTextSizeAttribute(size: AppTextSize): Exclude<AppTextSize, 'md'> | undefined {
  return size === 'md' ? undefined : size
}

export function appTextSizeCookie(size: AppTextSize): string {
  return `${APP_TEXT_SIZE_COOKIE}=${size}; path=/; max-age=${APP_THEME_COOKIE_MAX_AGE}; SameSite=Lax`
}
