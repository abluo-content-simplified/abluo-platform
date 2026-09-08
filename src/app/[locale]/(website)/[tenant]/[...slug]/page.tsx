import { tenantClient } from '@/lib/sanity/client'
import { pageBySlugQuery, pageByOldSlugQuery, localeConfigQuery, websiteSiteConfigQuery, designSystemQuery, projectModuleConfigQuery } from '@/lib/sanity/queries'
import { getEnabledModuleIds, type ProjectModuleConfig } from '@/lib/modules/config'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { fetchDesignSystemById } from '@/lib/sanity/client'
import { SectionRenderer, hydrateSections } from '@/components/sections/SectionRenderer'
import type { WebsitePage, WebsiteSiteConfig, LocaleConfig, FAQSection as FAQSectionType, SupportedLocale, DesignSystem } from '@/lib/sanity/types'
import type { Metadata } from 'next'
import { JsonLd } from '@/components/JsonLd'
import { notFound, permanentRedirect } from 'next/navigation'
import { SlugMapProvider } from '@/components/SlugMapContext'
import { isProduction, isDev } from '@/lib/deployment'
import { canonicalOrigin, canonicalUrl, hreflangAlternates, seoAlternates } from '@/lib/seo/canonical'
import { ogImageUrl, imageUrl } from '@/lib/sanity/image'
import { asUrlProjectSegment } from '@/lib/tenancy/ids'
import { joinSlugSegments } from '@/lib/sanity/fields/nested-slug'

export const dynamic = 'force-dynamic'

// ─── Nested paths (D1) ────────────────────────────────────────────────────────
//
// This segment is a CATCH-ALL. It used to be `[slug]`, one segment, which meant
// a page could only ever live at the root of a site — there was no way to serve
// `/servizi/terapia-individuale`.
//
// The nesting is expressed in the DATA, not in the route tree: `page.slug` holds
// the full path for that locale ("servizi/terapia-individuale"), and this route
// joins the captured segments back into the same string before querying. Three
// consequences, all of them the reason it is done this way:
//
//   • It is locale-aware for free, and cannot be otherwise. The path lives in
//     `slug[locale]`, so German is `slug.de` — a different path, not a prefix
//     bolted onto an Italian one. `dienstleistungen/einzeltherapie` needs no
//     code. A parent/child document model would have made the PARENT segment a
//     single shared value and forced a second, locale-blind mechanism on top;
//     that is the retrofit this avoids.
//   • Nothing existing changes. A one-segment slug is a one-element catch-all,
//     so every current page on every live site resolves exactly as before, with
//     no data migration.
//   • hreflang, the slug map, the language switcher and `redirectFrom` keep
//     working unchanged, because all four already read whole slug STRINGS.
//
// Static sibling routes (`blog`, `events`, `live`, `news`) still win over this
// catch-all — Next resolves static segments first — so the module routes are
// unaffected.

// ─── Metadata ─────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ tenant: string; locale: string; slug: string[] }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tenant: rawTenantId, locale, slug: slugSegments } = await params
  const slug = joinSlugSegments(slugSegments)
  // Trust boundary: the `[tenant]` segment is a URL project segment —
  // NOT a tenant slug and NOT a Supabase `projects.slug`. See ids.ts.
  const tenantId = asUrlProjectSegment(rawTenantId)
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  const [page, config] = await Promise.all([
    fetchForTenant<WebsitePage>(pageBySlugQuery, { locale, defaultLocale, slug }),
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale }),
  ])

  if (!page) return {}

  const origin = canonicalOrigin(config?.customDomain)

  // Page-level SEO overrides the site defaults; the site defaults override
  // nothing at all, which is how the restaurant landing page ended up with a
  // title and no description. Precedence: page.seoTitle → page.title → siteName.
  const pageTitle =
    page.seoTitle ??
    (page.title ? `${page.title} — ${config?.siteName ?? tenantId}` : config?.siteName ?? tenantId)

  // A page with no description of its own inherits the site default rather than
  // emitting none — an absent description lets Google invent one from the body.
  const pageDescription = page.seoDescription ?? config?.seoDefaultDescription ?? config?.tagline

  // hreflang from the page's per-locale slug map, plus x-default. A locale with
  // no slug is omitted: the page does not exist in that language.
  const supportedLocales = config?.supportedLocales ?? [locale as SupportedLocale]
  const languages = hreflangAlternates(
    origin,
    Object.fromEntries(
      supportedLocales.map((loc) => [loc, page.slugMap?.[loc]?.current ? [page.slugMap[loc]!.current] : undefined])
    ),
    defaultLocale
  )

  const canonical = canonicalUrl(origin, locale, slug)

  // OG locale tag — maps 2-letter code to IETF format
  const ogLocaleMap: Record<string, string> = {
    en: 'en_US', it: 'it_IT', de: 'de_DE', fr: 'fr_FR',
    es: 'es_ES', pt: 'pt_PT', nl: 'nl_NL',
  }

  // Page image → site default.
  //
  // The site default must be repeated here, not inherited. Next replaces the
  // parent's `openGraph` object wholesale when a child declares its own — it
  // does not deep-merge `images` — so a page that sets openGraph without images
  // ERASES the tenant-wide og:image the layout provided. Symptom: the home page
  // carried an og:image and every other page silently carried none, which stayed
  // invisible for as long as no tenant had an OG image set at all.
  //
  // `twitter:image` survived, because this route declares no `twitter` block and
  // so inherits the layout's. That asymmetry is the tell.
  const pageOgImage =
    (page.ogImage?.asset ? ogImageUrl(page.ogImage as never) : undefined) ??
    (config?.openGraphImage?.asset ? ogImageUrl(config.openGraphImage as never) : undefined)

  return {
    title: pageTitle,
    description: pageDescription ?? undefined,
    alternates: seoAlternates(origin, canonical, languages, {
      isProduction: isProduction(),
      isDev: isDev(),
    }),
    // An authored noindex on a page beats everything else. Thank-you pages and
    // campaign duplicates need it, and there was no way to express it before.
    ...(page.noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title: pageTitle,
      description: pageDescription ?? undefined,
      url: canonical,
      siteName: config?.siteName ?? tenantId,
      locale: ogLocaleMap[locale] ?? locale,
      type: 'website',
      ...(pageOgImage ? { images: [{ url: pageOgImage, width: 1200, height: 630 }] } : {}),
    },
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────
// SectionRenderer is imported from src/components/sections/SectionRenderer.tsx
// (ADR-016 Phase 0) — shared with the home route, not duplicated here.

export default async function WebsitePageRoute({ params }: PageProps) {
  const { tenant: rawTenantId, locale, slug: slugSegments } = await params
  const slug = joinSlugSegments(slugSegments)
  // Trust boundary: the `[tenant]` segment is a URL project segment —
  // NOT a tenant slug and NOT a Supabase `projects.slug`. See ids.ts.
  const tenantId = asUrlProjectSegment(rawTenantId)
  const { fetchForTenant } = tenantClient(tenantId)

  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  const [page, siteConfig, designSystem, moduleConfig] = await Promise.all([
    fetchForTenant<WebsitePage>(pageBySlugQuery, { locale, defaultLocale, slug }),
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale }),
    (async () => {
      const raw = await fetchForTenant<DesignSystem>(designSystemQuery, {})
      return resolveDesignSystemInheritance(raw, fetchDesignSystemById)
    })(),
    fetchForTenant<ProjectModuleConfig>(projectModuleConfigQuery, { locale, defaultLocale }),
  ])

  // ── Redirect check ──────────────────────────────────────────────────────────
  // If no page was found by the current slug, check if this is an old slug
  // that was renamed. If so, 301-redirect to the new slug.
  if (!page) {
    const redirectTarget = await fetchForTenant<{ currentSlug: string } | null>(
      pageByOldSlugQuery,
      { locale, slug }
    )
    if (redirectTarget?.currentSlug) {
      permanentRedirect(`/${locale}/${tenantId}/${redirectTarget.currentSlug}`)
    }
    return notFound()
  }

  // ── Hydrate blogListingSection posts server-side ────────────────────────────
  // ADR-020 — one query now serves both section gating and module config.
  // getEnabledModuleIds preserves the null-vs-[] distinction the gating
  // contract depends on (unresolved fails open; resolved-empty gates).
  const enabledModuleIds = getEnabledModuleIds(moduleConfig)

  await hydrateSections(page.sections, { fetchForTenant, locale: locale as SupportedLocale, defaultLocale, enabledModuleIds, moduleConfig })

  // ── Slug map — passed to the language switcher via context ──────────────────
  // Maps each locale to its current slug for this page.
  const slugMap: Partial<Record<SupportedLocale, string>> = {}
  if (page.slugMap) {
    for (const [loc, slugObj] of Object.entries(page.slugMap)) {
      if (slugObj?.current) {
        slugMap[loc as SupportedLocale] = slugObj.current
      }
    }
  }

  const faqSection = page.sections?.find(
    (s): s is FAQSectionType => s._type === 'faqSection'
  ) ?? null

  return (
    <SlugMapProvider slugMap={slugMap}>
      <JsonLd
        siteConfig={siteConfig}
        faqSection={faqSection}
        locale={locale}
        tenantId={tenantId}
        pathSegments={[slug]}
        logoUrl={siteConfig?.logo ? imageUrl(siteConfig.logo as never, 512) : undefined}
      />
      {page.sections?.map((section, index) => (
        <SectionRenderer
          key={section._key}
          section={section}
          siteConfig={siteConfig}
          designSystem={designSystem}
          backgroundPattern={page.backgroundPattern}
          sectionIndex={index}
          locale={locale}
          tenantSlug={tenantId}
          fromParam={slug}
          enabledModuleIds={enabledModuleIds}
        moduleConfig={moduleConfig}
        />
      ))}
    </SlugMapProvider>
  )
}
