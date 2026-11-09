/**
 * Which uploaded image a website uses as its browser-tab icon and its
 * home-screen icon — one rule for the page's <link> tags (tenant layout) and
 * for `/favicon.ico` (api/site-favicon).
 *
 * The SIGN (Website Settings → Sign: the small square logo, e.g. abluo's "a.")
 * is the master: when a site has no favicon / home-screen icon of its own, they
 * are rendered from the sign at the size they need. Never the other way round —
 * a favicon is drawn for 16–64px and blurs when enlarged (Tom, 2026-11-09).
 * Fields set explicitly always win, so sites that have them do not change.
 */

export type IconRef = { asset?: { _ref?: string } } | null | undefined

export interface SiteIconSources {
  faviconSvg?: IconRef
  faviconPng?: IconRef
  appleTouchIcon?: IconRef
  /** The sign, for dark backgrounds. */
  brandMark?: IconRef
  /** The sign, for light backgrounds. */
  brandMarkLight?: IconRef
}

export const hasAsset = (icon: IconRef): icon is { asset: { _ref: string } } => !!icon?.asset?._ref

const first = (...icons: IconRef[]) => icons.find(hasAsset) ?? null

/**
 * Browser tab: favicon SVG → favicon PNG → the sign. Most tab bars are light,
 * so the light-background version of the sign comes first.
 */
export function pickTabIcon(c: SiteIconSources | null | undefined) {
  return first(c?.faviconSvg, c?.faviconPng, c?.brandMarkLight, c?.brandMark)
}

/**
 * Home screen: the Apple touch icon → the sign. iOS fills a transparent icon
 * with black, so the dark-background version of the sign comes first.
 */
export function pickHomeScreenIcon(c: SiteIconSources | null | undefined) {
  return first(c?.appleTouchIcon, c?.brandMark, c?.brandMarkLight)
}

/** Sanity image refs carry size and format: `image-<hash>-<w>x<h>-<ext>`. */
export function assetInfo(ref: string | null | undefined): { width: number; height: number; ext: string } | null {
  const m = ref?.match(/-(\d+)x(\d+)-([a-z0-9]+)$/i)
  return m ? { width: Number(m[1]), height: Number(m[2]), ext: m[3].toLowerCase() } : null
}

/** Smallest side a raster sign may have: it is enlarged for home-screen icons and cards. */
export const MIN_RASTER_SIGN = 512

/**
 * Why an uploaded sign would look bad when enlarged, or null when it is fine.
 * An SVG always scales; a raster image needs at least 512 × 512.
 */
export function signProblem(ref: string | null | undefined): string | null {
  const info = assetInfo(ref)
  if (!info || info.ext === 'svg') return null
  if (Math.min(info.width, info.height) < MIN_RASTER_SIGN) {
    return `This image is ${info.width} × ${info.height} px and will look blurry when enlarged. Upload an SVG, or a PNG of at least ${MIN_RASTER_SIGN} × ${MIN_RASTER_SIGN} px.`
  }
  return null
}
