import type { NavLink, ResolvedNavLink, SupportedLocale } from './types'
import { isPassThroughHref } from './href'
import { LOCALE_CODES } from '@/lib/i18n/locales'

/**
 * Locale codes recognised as a URL prefix when no project locale list is given.
 *
 * Defaults to the whole Platform Locale Registry (src/lib/i18n/locales.ts) —
 * the same list `src/i18n/routing.ts` gives next-intl, so any locale the router
 * can serve is also recognised here. Callers that know the project's
 * `siteConfig.supportedLocales` should pass them so a segment is only treated
 * as a locale when that project actually serves it.
 */
const DEFAULT_LOCALE_SEGMENTS: readonly string[] = LOCALE_CODES

/**
 * Resolve internal page to URL path (without locale prefix).
 *
 * These cases match the `internalPage` values in the `navigationLink` schema.
 * Any new built-in route (a coded page with no Sanity page document) must be
 * added here AND to the schema's `internalPage` options list.
 */
function resolveInternalPage(page: string | undefined): string {
  switch (page) {
    case 'homepage':
      return ''
    case 'live':
      return 'live'
    case 'events':
      return 'events'
    case 'blog':
      return 'blog'
    default:
      return ''
  }
}

/**
 * Resolve a single navigation link to its final href
 * Handles both internal page selection and external URLs
 *
 * @param link - The raw navigation link from Sanity
 * @param locale - Current locale for internal links
 * @param tenantId - Current tenant for internal links
 * @param supportedLocales - Locale codes this project serves, used to decide
 *   whether a legacy href already carries a locale prefix. Optional: defaults
 *   to every platform locale, so existing 3-argument callers keep working.
 * @returns Resolved link with computed href
 */
export function resolveNavLink(
  link: NavLink,
  locale: SupportedLocale,
  tenantId: string,
  supportedLocales: readonly string[] = DEFAULT_LOCALE_SEGMENTS
): ResolvedNavLink {
  // Internal page — two resolution paths:
  //   1. pageRef (preferred): links to any page document by its slug
  //   2. internalPage (legacy): links to special routes (homepage, live, events)
  if (link.linkType === 'internal') {
    // Path 1: page document reference — slug resolved by GROQ
    if (link.pageSlug) {
      return {
        label: link.label,
        href: `/${locale}/${tenantId}/${link.pageSlug}`,
        external: false,
        children: link.children?.map((child) => resolveNavLink(child, locale, tenantId, supportedLocales)),
      }
    }

    // Path 2: special section (Live, Events, Homepage)
    const pagePath = resolveInternalPage(link.internalPage)
    const href = pagePath ? `/${locale}/${tenantId}/${pagePath}` : `/${locale}/${tenantId}`
    return {
      label: link.label,
      href,
      external: false,
      children: link.children?.map((child) => resolveNavLink(child, locale, tenantId, supportedLocales)),
    }
  }

  // Same-page anchor — resolves to `#<anchorId>`. Purely additive: no link
  // stored before this existed can have linkType 'anchor', so the 'internal'
  // and 'external' paths above/below are unreachable from here and unchanged.
  if (link.linkType === 'anchor') {
    return {
      label: link.label,
      href: link.anchorId ? `#${link.anchorId}` : '#',
      external: false,
      children: link.children?.map((child) => resolveNavLink(child, locale, tenantId, supportedLocales)),
    }
  }

  if (link.linkType === 'external' && link.externalUrl) {
    return {
      label: link.label,
      href: link.externalUrl,
      external: link.openInNewTab ?? false,
      children: link.children?.map((child) => resolveNavLink(child, locale, tenantId, supportedLocales)),
    }
  }

  // Fallback to legacy href/external for backward compatibility
  if (link.href) {
    let href = link.href

    // If href is a relative path starting with /, it needs locale and tenantId
    // prefix. isPassThroughHref() keeps fragments (#faq), scheme URLs
    // (mailto:, tel:, sms:, http:, https:) and protocol-relative URLs
    // (//cdn.example.com/x) verbatim — a protocol-relative URL also starts
    // with '/' and used to be mangled into an internal route here.
    if (!isPassThroughHref(href) && href.startsWith('/')) {
      // Check if path already includes the tenant slug
      // Paths like /livener/live or /en/livener/live are already correct
      // Paths like /live need to be converted to /{locale}/{tenantId}/live
      const pathParts = href.split('/').filter(Boolean) // Remove empty strings from leading /

      // If path doesn't start with locale and tenantId, add them.
      // A first segment counts as a locale only when the project serves it
      // (siteConfig.supportedLocales, defaulting to the platform registry) —
      // never a hardcoded language list. The tenant check compares against the
      // `tenantId` argument, so it works for every client, not just one.
      const startsWithLocale = supportedLocales.includes(pathParts[0])
      const hasTenantSlug = startsWithLocale && pathParts.length > 1 && pathParts[1] === tenantId

      if (!startsWithLocale) {
        // Path like /live -> /{locale}/{tenantId}/live
        href = `/${locale}/${tenantId}${href}`
      } else if (startsWithLocale && !hasTenantSlug) {
        // Path like /en/live -> /en/{tenantId}/live
        href = `/${pathParts[0]}/${tenantId}/${pathParts.slice(1).join('/')}`
      }
      // Otherwise it's already in correct format
    }

    return {
      label: link.label,
      href,
      external: link.external ?? false,
      children: link.children?.map((child) => resolveNavLink(child, locale, tenantId, supportedLocales)),
    }
  }

  // Fallback: empty link
  return {
    label: link.label,
    href: '#',
    external: false,
    children: link.children?.map((child) => resolveNavLink(child, locale, tenantId, supportedLocales)),
  }
}

/**
 * Resolve an array of navigation links
 */
export function resolveNavLinks(
  links: NavLink[] | undefined,
  locale: SupportedLocale,
  tenantId: string,
  supportedLocales: readonly string[] = DEFAULT_LOCALE_SEGMENTS
): ResolvedNavLink[] {
  if (!links?.length) return []
  return links.map((link) => resolveNavLink(link, locale, tenantId, supportedLocales))
}
