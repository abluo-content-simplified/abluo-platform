/**
 * Locked themes — what `siteConfig.themeMode` decides about the PALETTE.
 *
 * The root layout ships a boot script that reads `localStorage['abluo-theme']`
 * and `prefers-color-scheme` and writes `class="light"` onto <html>. It has no
 * idea which project it is rendering, so on its own it decides the theme for
 * every site on the platform — including sites that are supposed to have only
 * one.
 *
 * Until this existed, `themeMode` controlled exactly ONE thing: whether the
 * ThemeSwitcher rendered. That made "Light Only" worse than leaving the setting
 * alone — the site still followed the visitor's OS preference, so a visitor on
 * a dark-mode machine got the dark palette, and hiding the switcher removed the
 * only control that could have put it right.
 *
 * The fix is a SELECTOR, not more JavaScript: the winning palette is decided
 * when the CSS is built, so there is no flash and nothing races the boot script.
 */
export type ThemeMode = 'lightOnly' | 'darkOnly' | 'toggle' | 'system'

/**
 * The selector the LIGHT tokens are emitted under, or `null` to emit no light
 * block at all.
 *
 * The dark tokens are always emitted on bare `:root` and come first, so:
 *   • 'html.light'        — the class decides, as it always has.
 *   • ':root, html.light' — light also lands on `:root`, later in the file than
 *                           the dark block, so it wins with or without the class.
 *   • null                — no light block, so `:root` dark stands even when the
 *                           boot script has already added the class.
 */
export function lightThemeSelector(themeMode: ThemeMode = 'toggle'): string | null {
  if (themeMode === 'darkOnly') return null
  if (themeMode === 'lightOnly') return ':root, html.light'
  return 'html.light'
}
