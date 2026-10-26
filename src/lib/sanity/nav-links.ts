import type { NavLink, ResolvedNavLink, SupportedLocale } from './types'
import { isPassThroughHref, toPublicPath } from './href'
import { NEWS_ROUTE_SEGMENT } from './cta'
import { LOCALE_CODES } from '@/lib/i18n/locales'
import { catalogueNavPath } from '@/lib/modules/catalogue/nav-target'
import { parseAccessPolicy, parseNavigationMode } from '@/lib/access/policy'
import { getAccessMessages } from '@/lib/i18n/access-messages'

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
    // News module index (ADR-020). Additive — no link stored before this
    // option existed carries the value.
    case 'news':
      return NEWS_ROUTE_SEGMENT
    default:
      return ''
  }
}

/**
 * Public segment of the module a `module` link points at, or null when the
 * module is not installed / switched off / has no public segment.
 */
export function moduleNavSegment(link: NavLink): string | null {
  if (!link.moduleId) return null
  const hit = link.moduleSegments?.find((m) => m?.moduleId === link.moduleId)
  const segment = typeof hit?.segment === 'string' ? hit.segment.replace(/^\/+|\/+$/g, '').trim() : ''
  return segment || null
}

/**
 * ADR-040 — how a link to a restricted page appears in the menu: 'hidden'
 * (default, for every visitor) or 'locked' (shown with a lock). Public targets
 * and non-page links are 'public'. Fail-closed: a malformed access object is
 * restricted, and an unset menu mode is hidden.
 */
export function navAccessMode(link: NavLink): 'public' | 'hidden' | 'locked' {
  if (link.linkType !== 'internal') return 'public'
  const ownOpen = !link.pageAccess || parseAccessPolicy(link.pageAccess).visibility === 'public'
  if (ownOpen && link.pageUnderClosed !== true) return 'public'
  // Restricted only through a parent: the child's own menu mode is not set, so
  // it takes the default — hidden.
  return ownOpen ? 'hidden' : parseNavigationMode(link.pageAccess)
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
  //   1. pageRef (preferred): links to any page document by its slug, or
  //      (ADR-033 Amendment G) to a catalogue landing page / collection / item
  //   2. internalPage (legacy): links to special routes (homepage, live, events)
  if (link.linkType === 'internal') {
    // Path 1b: catalogue target — /{segment} or /{segment}/{slug in this locale}.
    // Only a public target of this project reaches here (GROQ); without a
    // path in this locale isRenderableNavLink() omits the link.
    const cataloguePath = catalogueNavPath(link.catalogueTarget)
    if (cataloguePath) {
      return {
        label: link.label,
        href: `/${locale}/${tenantId}/${cataloguePath}`,
        external: false,
        children: renderableChildren(link)?.map((child) => resolveNavLink(child, locale, tenantId, supportedLocales)),
      }
    }

    // Path 1: page document reference — slug resolved by GROQ
    if (link.pageSlug) {
      return {
        label: link.label,
        href: `/${locale}/${tenantId}/${link.pageSlug}`,
        external: false,
        ...(navAccessMode(link) === 'locked' ? { lockedLabel: getAccessMessages(locale).lockedLinkLabel } : {}),
        children: renderableChildren(link)?.map((child) => resolveNavLink(child, locale, tenantId, supportedLocales)),
      }
    }

    // Path 2: special section (Live, Events, Homepage)
    const pagePath = resolveInternalPage(link.internalPage)
    const href = pagePath ? `/${locale}/${tenantId}/${pagePath}` : `/${locale}/${tenantId}`
    return {
      label: link.label,
      href,
      external: false,
      children: renderableChildren(link)?.map((child) => resolveNavLink(child, locale, tenantId, supportedLocales)),
    }
  }

  // Anchor on the home page — resolves to `<home href>#<anchorId>`, built the
  // same way as the 'homepage' internal link above (`/{locale}/{tenantId}`;
  // toPublicNavLink() drops the tenant segment on a site's own host). A bare
  // `#id` did nothing on any page but the home page. On the home page itself
  // the href is the current path plus a hash, which Next's <Link> scrolls to
  // without a reload. Purely additive: no link stored before this existed can
  // have linkType 'anchor'.
  if (link.linkType === 'anchor') {
    return {
      label: link.label,
      href: link.anchorId ? `/${locale}/${tenantId}#${link.anchorId}` : '#',
      external: false,
      children: renderableChildren(link)?.map((child) => resolveNavLink(child, locale, tenantId, supportedLocales)),
    }
  }

  // Module public page — `/{locale}/{tenantId}/{segment}`, where the segment is
  // the enabled installation's public segment (GROQ: moduleSegments). Additive.
  if (link.linkType === 'module') {
    const segment = moduleNavSegment(link)
    return {
      label: link.label,
      href: segment ? `/${locale}/${tenantId}/${segment}` : '#',
      external: false,
      children: renderableChildren(link)?.map((child) => resolveNavLink(child, locale, tenantId, supportedLocales)),
    }
  }

  if (link.linkType === 'external' && link.externalUrl) {
    return {
      label: link.label,
      href: link.externalUrl,
      external: link.openInNewTab ?? false,
      children: renderableChildren(link)?.map((child) => resolveNavLink(child, locale, tenantId, supportedLocales)),
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
      children: renderableChildren(link)?.map((child) => resolveNavLink(child, locale, tenantId, supportedLocales)),
    }
  }

  // Fallback: empty link
  return {
    label: link.label,
    href: '#',
    external: false,
    children: renderableChildren(link)?.map((child) => resolveNavLink(child, locale, tenantId, supportedLocales)),
  }
}

/**
 * ADR-021. Two kinds of link never become an <a>:
 *  - a link to a page that is not published yet (pageRef set, no slug resolves) —
 *    hidden until the page goes live, instead of silently pointing at the home
 *    page. This is how "prepare the legal pages now, show them later" works.
 *    ADR-033 Amendment G applies the same rule to a catalogue target: hidden
 *    when it is not public, belongs to another project, has no page, has no
 *    slug in this language, or the catalogue is not installed / switched off;
 *  - `cookieSettings`, which the footer renders as the consent-panel button.
 */
export function isRenderableNavLink(link: NavLink): boolean {
  if (link.linkType === 'cookieSettings') return false
  // ADR-040 — a restricted page is left out of the menu unless set to "shown with a lock".
  if (navAccessMode(link) === 'hidden') return false
  // A module link whose module is not installed / enabled has no page: hide it.
  if (link.linkType === 'module' && !moduleNavSegment(link)) return false
  if (link.linkType === 'internal' && link.hasPageRef && !link.pageSlug && !catalogueNavPath(link.catalogueTarget)) return false
  return true
}

/** Children that may render — the same rule as top-level links (ADR-021, ADR-040). */
function renderableChildren(link: NavLink): NavLink[] | undefined {
  return link.children?.filter(isRenderableNavLink)
}

/**
 * Resolve an array of navigation links
 */
export function resolveNavLinks(
  links: NavLink[] | undefined,
  locale: SupportedLocale,
  tenantId: string,
  supportedLocales: readonly string[] = DEFAULT_LOCALE_SEGMENTS,
  /** True on the site's own host — internal hrefs drop the project segment. */
  hostScoped = false
): ResolvedNavLink[] {
  if (!links?.length) return []
  return links
    .filter(isRenderableNavLink)
    .map((link) => toPublicNavLink(resolveNavLink(link, locale, tenantId, supportedLocales), tenantId, hostScoped))
}

/**
 * The public form of a resolved link (and its children): on the site's own
 * host `/{locale}/{tenant}/x` becomes `/{locale}/x` — see toPublicPath().
 */
export function toPublicNavLink(link: ResolvedNavLink, tenantId: string, hostScoped: boolean): ResolvedNavLink {
  if (!hostScoped) return link
  return {
    ...link,
    href: link.external ? link.href : toPublicPath(link.href, tenantId, true),
    children: link.children?.map((child) => toPublicNavLink(child, tenantId, true)),
  }
}
