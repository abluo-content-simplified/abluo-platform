// ── Digital Cards — what the /card pages and vCard routes read (ADR-049) ───────
//
// Server-only glue between the request (params, host) and the pure decisions
// of website.ts. One cached loader per request, shared by generateMetadata and
// the page, so a card is read once per render.

import { cache } from 'react'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { tenantClient, fetchDesignSystemById } from '@/lib/sanity/client'
import { designSystemQuery, localeConfigQuery, projectModuleConfigQuery, websiteSiteConfigQuery } from '@/lib/sanity/queries'
import { getEnabledModuleIds, type ProjectModuleConfig } from '@/lib/modules/config'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { resolveNavLinks } from '@/lib/sanity/nav-links'
import { siteBasePath } from '@/lib/sanity/href'
import { isHostScopedRequest } from '@/lib/tenancy/link-scope.server'
import { asUrlProjectSegment } from '@/lib/tenancy/ids'
import { isKnownProjectSegment } from '@/lib/tenancy/host-scope'
import { isProduction } from '@/lib/deployment'
import type { DesignSystem, LocaleConfig, NavLink, SupportedLocale, WebsiteSiteConfig } from '@/lib/sanity/types'
import { isProductionHostFor } from './hit'
import { loadPersonCard, loadSiteCard, type CardRouteOutcome } from './website'
import type { DigitalCardPersonResult, DigitalCardSiteResult } from './projection'
import type { PersonPublic } from '@/lib/modules/people/projection'

export interface CardRequestContext {
  tenantId: string
  locale: string
  defaultLocale: string
  siteBase: string
  hostScoped: boolean
  enabledModuleIds: string[] | null
  fetchForTenant: ReturnType<typeof tenantClient>['fetchForTenant']
}

/** Tenant, languages, site base and installed modules of this request. null = unknown project segment. */
export const cardRequestContext = cache(async (rawTenant: string, locale: string): Promise<CardRequestContext | null> => {
  const tenantId = asUrlProjectSegment(rawTenant)
  if (!isKnownProjectSegment(tenantId)) return null
  const { fetchForTenant } = tenantClient(tenantId)
  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'
  const modules = await fetchForTenant<ProjectModuleConfig>(projectModuleConfigQuery, { locale, defaultLocale })
  const hostScoped = await isHostScopedRequest(tenantId)
  return {
    tenantId: String(tenantId),
    locale,
    defaultLocale,
    siteBase: siteBasePath(locale, tenantId, hostScoped),
    hostScoped,
    enabledModuleIds: getEnabledModuleIds(modules),
    fetchForTenant,
  }
})

export const loadSiteCardForRequest = cache(async (rawTenant: string, locale: string): Promise<{ ctx: CardRequestContext | null; outcome: CardRouteOutcome<DigitalCardSiteResult> }> => {
  const ctx = await cardRequestContext(rawTenant, locale)
  if (!ctx) return { ctx, outcome: { kind: 'not-found' } }
  const outcome = await loadSiteCard(ctx.fetchForTenant, { locale, defaultLocale: ctx.defaultLocale, enabledModuleIds: ctx.enabledModuleIds, siteBase: ctx.siteBase })
  return { ctx, outcome }
})

export const loadPersonCardForRequest = cache(
  async (
    rawTenant: string,
    locale: string,
    urlName: string,
  ): Promise<{ ctx: CardRequestContext | null; outcome: CardRouteOutcome<DigitalCardPersonResult & { person: PersonPublic }> }> => {
    const ctx = await cardRequestContext(rawTenant, locale)
    if (!ctx) return { ctx, outcome: { kind: 'not-found' } }
    const outcome = await loadPersonCard(ctx.fetchForTenant, {
      locale,
      defaultLocale: ctx.defaultLocale,
      enabledModuleIds: ctx.enabledModuleIds,
      siteBase: ctx.siteBase,
      urlName,
    })
    return { ctx, outcome }
  },
)

/**
 * The card's automatic footer: the site's Legal pages, found the way the site
 * Footer finds them — footer links (and footer-column links) whose target page
 * is a `legal` page — resolved for this host.
 */
export async function cardLegalLinks(ctx: CardRequestContext): Promise<Array<{ label: string; href: string; external: boolean }>> {
  const config = await ctx.fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale: ctx.locale, defaultLocale: ctx.defaultLocale })
  const raw: NavLink[] = [
    ...(config?.footerLinks ?? []),
    ...(config?.footerColumns ?? []).flatMap((c) => c.links ?? []),
  ].filter((l) => (l as { pageType?: string | null }).pageType === 'legal')
  const seen = new Set<string>()
  return resolveNavLinks(raw, ctx.locale as SupportedLocale, ctx.tenantId, undefined, ctx.hostScoped)
    .filter((l) => l.href && !seen.has(l.href) && (seen.add(l.href), true))
    .map((l) => ({ label: l.label, href: l.href, external: l.external }))
}

/** The design system's motion tokens (the card animates only through FadeIn / SlideUp). */
export async function cardDesignSystem(ctx: CardRequestContext): Promise<DesignSystem | null> {
  const raw = await ctx.fetchForTenant<DesignSystem>(designSystemQuery, {})
  return resolveDesignSystemInheritance(raw, fetchDesignSystemById)
}

/** Counting only on the production deployment, on the project's own domain (D11). */
export async function cardCountable(ctx: CardRequestContext): Promise<boolean> {
  if (!isProduction()) return false
  return isProductionHostFor((await headers()).get('host'), ctx.tenantId)
}

/** D9 / D10: never indexed, never followed; a share preview with no contact data. */
export function cardMetadata(share: { title: string; description: string | null; image: { asset?: unknown } | null }, ogImage: string | undefined): Metadata {
  return {
    title: { absolute: share.title },
    ...(share.description ? { description: share.description } : {}),
    robots: { index: false, follow: false },
    openGraph: {
      title: share.title,
      ...(share.description ? { description: share.description } : {}),
      ...(ogImage ? { images: [{ url: ogImage, width: 1200, height: 630 }] } : {}),
    },
    twitter: {
      card: ogImage ? 'summary_large_image' : 'summary',
      title: share.title,
      ...(share.description ? { description: share.description } : {}),
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  }
}

/** A card that does not render (404 / redirect) still says noindex. */
export const CARD_NOINDEX_METADATA: Metadata = { robots: { index: false, follow: false } }
