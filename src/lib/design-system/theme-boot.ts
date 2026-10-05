/**
 * The website theme boot script (runs before first paint) and the "forced
 * theme" used by the private draft preview.
 *
 * Normal pages: read `localStorage['abluo-theme']`, else follow the device.
 * Dark-first: `:root` = dark, `html.light` = light.
 *
 * Draft preview (`…/preview/post/{id}?theme=light|dark`): the dashboard's
 * Light/Dark switch forces the palette for that page only. The script marks
 * <html data-theme-forced="…"> and the theme switchers then neither re-apply
 * nor SAVE a preference, so the visitor's own choice is never touched.
 */
export const FORCED_THEME_ATTR = 'data-theme-forced'

export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;var f=location.pathname.indexOf('/preview/post/')>-1?new URLSearchParams(location.search).get('theme'):null;if(f==='light'||f==='dark'){d.setAttribute('${FORCED_THEME_ATTR}',f);if(f==='light'){d.classList.add('light');}else{d.classList.remove('light');}return;}var t=localStorage.getItem('abluo-theme');if(t==='light'){d.classList.add('light');}else if(t==='dark'){/* default — no class needed */}else{if(!window.matchMedia('(prefers-color-scheme: dark)').matches){d.classList.add('light');}}}catch(e){}})();`

/** True on a page whose theme was forced by the draft preview. */
export function isThemeForced(): boolean {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute(FORCED_THEME_ATTR)
}
