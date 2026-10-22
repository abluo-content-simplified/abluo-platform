// Brand Hub page order for previous / next links — the side navigation's
// order, flattened, so the pager can never disagree with the menu.
import { BRAND_HUB_NAV_GROUPS, type BrandHubPageId } from './types'

export const BRAND_HUB_PAGE_ORDER: readonly BrandHubPageId[] = BRAND_HUB_NAV_GROUPS.flatMap((g) => g.pages)

export function adjacentPages(page: BrandHubPageId): { previous: BrandHubPageId | null; next: BrandHubPageId | null } {
  const i = BRAND_HUB_PAGE_ORDER.indexOf(page)
  if (i === -1) return { previous: null, next: null }
  return {
    previous: i > 0 ? BRAND_HUB_PAGE_ORDER[i - 1] : null,
    next: i < BRAND_HUB_PAGE_ORDER.length - 1 ? BRAND_HUB_PAGE_ORDER[i + 1] : null,
  }
}

/**
 * localStorage key for "don't show the welcome again", per website. On shared
 * hosts (dev.abluo.app/en/<tenant>/brand) several sites share one origin, so
 * the key carries the path without the language: one choice per site, not per
 * language.
 */
export function introDismissKey(basePath: string): string {
  const withoutLocale = basePath.split('/').filter(Boolean).slice(1).join('/')
  return `abluo:brand-hub:intro-dismissed:${withoutLocale || 'site'}`
}
