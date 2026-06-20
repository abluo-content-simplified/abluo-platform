import type { NavLink, ResolvedNavLink, SupportedLocale } from './types'

/**
 * Resolve internal page to URL path (without locale prefix)
 */
function resolveInternalPage(page: string | undefined): string {
  switch (page) {
    case 'homepage':
      return ''
    case 'live':
      return 'live'
    case 'events':
      return 'events'
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
 * @returns Resolved link with computed href
 */
export function resolveNavLink(
  link: NavLink,
  locale: SupportedLocale,
  tenantId: string
): ResolvedNavLink {
  // Use new linkType-based resolution first
  if (link.linkType === 'internal') {
    // internalPage may be unset on brand-new documents — default to homepage
    const pagePath = resolveInternalPage(link.internalPage)
    const href = pagePath ? `/${locale}/${tenantId}/${pagePath}` : `/${locale}/${tenantId}`

    return {
      label: link.label,
      href,
      external: false,
      children: link.children?.map((child) => resolveNavLink(child, locale, tenantId)),
    }
  }

  if (link.linkType === 'external' && link.externalUrl) {
    return {
      label: link.label,
      href: link.externalUrl,
      external: link.openInNewTab ?? false,
      children: link.children?.map((child) => resolveNavLink(child, locale, tenantId)),
    }
  }

  // Fallback to legacy href/external for backward compatibility
  if (link.href) {
    let href = link.href

    // If href is a relative path starting with /, it needs locale and tenantId prefix
    if (href.startsWith('/') && !href.startsWith('http')) {
      // Check if path already includes the tenant slug
      // Paths like /livener/live or /en/livener/live are already correct
      // Paths like /live need to be converted to /{locale}/{tenantId}/live
      const pathParts = href.split('/').filter(Boolean) // Remove empty strings from leading /

      // If path doesn't start with locale and tenantId, add them
      // Simple heuristic: if path has fewer than 2 parts or first part is not a locale, add locale and tenantId
      const startsWithLocale = ['en', 'it', 'de'].includes(pathParts[0])
      const hasTenantSlug = startsWithLocale && pathParts.length > 1 && ['livener'].includes(pathParts[1])

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
      children: link.children?.map((child) => resolveNavLink(child, locale, tenantId)),
    }
  }

  // Fallback: empty link
  return {
    label: link.label,
    href: '#',
    external: false,
    children: link.children?.map((child) => resolveNavLink(child, locale, tenantId)),
  }
}

/**
 * Resolve an array of navigation links
 */
export function resolveNavLinks(
  links: NavLink[] | undefined,
  locale: SupportedLocale,
  tenantId: string
): ResolvedNavLink[] {
  if (!links?.length) return []
  return links.map((link) => resolveNavLink(link, locale, tenantId))
}
