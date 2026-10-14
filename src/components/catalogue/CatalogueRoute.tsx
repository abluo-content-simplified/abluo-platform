// ── Catalogue routes inside the tenant catch-all (ADR-033 C1, C2; spec §6) ────
//
// `[...slug]/page.tsx` calls these BEFORE its page lookup, and only when
// planCatalogueRoute() returned a dispatch — i.e. the project has an enabled
// catalogue installation with a segment, and the path is under it (or under a
// historic one). Everything else falls through to the page lookup unchanged.
//
//   landing   /{segment}         cataloguePage, its own lifecycle (C1); not
//                                public → the branded unavailable page
//   entry     /{segment}/{slug}  item → collection → item redirect →
//                                collection redirect → notFound()
//   redirect  /{historic}/…      301 to the same path under the current segment
//
// Metadata and page share the same pure helpers (website.ts), so the two can
// never disagree about which document a URL is.

import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { PortableText } from '@portabletext/react'
import type { tenantClient } from '@/lib/sanity/client'
import type { DesignSystem, ResolvedImage, SupportedLocale, WebsiteSiteConfig } from '@/lib/sanity/types'
import type { ProjectModuleConfig } from '@/lib/modules/config'
import type { CatalogueCollectionDTO, CatalogueConfigDTO, CatalogueItemPageDTO } from '@/lib/modules/catalogue/dto'
import type { CatalogueDispatch } from '@/lib/modules/catalogue/segment'
import { catalogueCollectionJsonLd, catalogueItemJsonLd } from '@/lib/modules/catalogue/structured'
import {
  catalogueAlternates,
  catalogueItemCanonical,
  catalogueItemHref,
  catalogueLandingAlternates,
  catalogueRobots,
  catalogueSlugMap,
  loadCataloguePage,
  resolveCatalogueEntry,
} from '@/lib/modules/catalogue/website'
import { isDev, isProduction } from '@/lib/deployment'
import { siteHostsForProject } from '@/lib/links/link-target'
import { canonicalOrigin, seoAlternates } from '@/lib/seo/canonical'
import { ogLocale } from '@/lib/seo/og-locale'
import { safeJsonLd } from '@/lib/seo/safe-json-ld'
import { unavailableMetadata } from '@/lib/lifecycle/unavailable-metadata'
import { imageUrl, imageSrcSet, ogImageUrl } from '@/lib/sanity/image'
import { indexRouteSlugMap } from '@/lib/i18n/language-switch'
import { resolveEasing } from '@/lib/motion/easing'
import type { UrlProjectSegment } from '@/lib/tenancy/ids'
import { SlugMapProvider } from '@/components/SlugMapContext'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionRenderer, hydrateSections } from '@/components/sections/SectionRenderer'
import { articlePortableTextComponents } from '@/components/portable-text/article-components'
import { CatalogueCollectionView } from './CatalogueCollectionView'
import { AllergensAndDietary, Byline, ItemLinks, OfferList, optionAllergenText } from './CatalogueItemParts'
import { getCatalogueWebsiteMessages, optionRuleText, fillMessage } from './messages'

type FetchForTenant = ReturnType<typeof tenantClient>['fetchForTenant']

export interface CatalogueRouteContext {
  dispatch: CatalogueDispatch
  config: CatalogueConfigDTO
  fetchForTenant: FetchForTenant
  locale: string
  defaultLocale: SupportedLocale
  tenantId: UrlProjectSegment
  siteBase: string
  siteConfig: WebsiteSiteConfig | null
}

const segmentOf = (config: CatalogueConfigDTO): string => config.segment ?? ''

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function catalogueRouteMetadata(ctx: CatalogueRouteContext): Promise<Metadata> {
  const { dispatch, config, fetchForTenant, locale, defaultLocale, siteConfig } = ctx
  // A historic segment redirects; the page does it, metadata says nothing.
  if (dispatch.kind === 'redirect') return {}

  const segment = segmentOf(config)
  const origin = canonicalOrigin(siteConfig?.customDomain)
  const supportedLocales = siteConfig?.supportedLocales ?? [defaultLocale]
  const siteName = siteConfig?.siteName ?? ctx.tenantId
  const env = { isProduction: isProduction(), isDev: isDev() }
  const siteOg =
    siteConfig?.openGraphImage?.asset ? ogImageUrl(siteConfig.openGraphImage as never) : undefined

  if (dispatch.kind === 'landing') {
    const page = await loadCataloguePage(fetchForTenant, { locale, defaultLocale })
    if (!page) return unavailableMetadata(locale)
    const title = page.seoTitle ?? (page.heroTitle ? `${page.heroTitle} — ${siteName}` : siteName)
    const description = page.seoDescription ?? page.heroSubtitle ?? undefined
    const { canonical, languages } = catalogueLandingAlternates({ origin, locale, defaultLocale, supportedLocales, segment })
    return {
      title,
      description,
      alternates: seoAlternates(origin, canonical, languages, env),
      openGraph: {
        title,
        description,
        url: canonical,
        siteName,
        locale: ogLocale(locale),
        type: 'website',
        ...(siteOg ? { images: [{ url: siteOg, width: 1200, height: 630 }] } : {}),
      },
    }
  }

  const entry = await resolveCatalogueEntry(fetchForTenant, dispatch.slug, { locale, defaultLocale, config, now: new Date() })
  if (entry.kind === 'redirect') return {}
  if (entry.kind === 'notFound') return unavailableMetadata(locale)

  const doc = entry.kind === 'item' ? entry.item : entry.collection
  const page = doc.page!
  const { canonical, languages } = catalogueAlternates({ origin, locale, defaultLocale, supportedLocales, segment, page })
  const title = `${doc.name} — ${siteName}`
  const description = doc.description ?? undefined
  const firstImage = entry.kind === 'item' ? entry.item.images[0] : undefined
  const og = (firstImage ? ogImageUrl(firstImage.image as never) : undefined) ?? siteOg
  const robots = catalogueRobots(doc.visibility)
  return {
    title,
    description,
    alternates: seoAlternates(origin, canonical, languages, env),
    ...(robots ? { robots } : {}),
    openGraph: {
      title,
      description,
      url: canonical,
      siteName,
      locale: ogLocale(locale),
      type: 'website',
      ...(og ? { images: [{ url: og, width: 1200, height: 630 }] } : {}),
    },
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export async function CatalogueRoute(
  ctx: CatalogueRouteContext & {
    designSystem: DesignSystem | null
    moduleConfig: ProjectModuleConfig | null | undefined
    enabledModuleIds: string[] | null
    hostScoped: boolean
  },
) {
  const { dispatch, config, fetchForTenant, locale, defaultLocale, siteBase, siteConfig, designSystem } = ctx
  const segment = segmentOf(config)

  if (dispatch.kind === 'redirect') {
    permanentRedirect(`${siteBase}/${dispatch.to.map(encodeURIComponent).join('/')}`)
  }

  if (dispatch.kind === 'landing') {
    const page = await loadCataloguePage(fetchForTenant, { locale, defaultLocale })
    // C1 — not public (or absent): the branded unavailable page.
    if (!page) notFound()
    const sections = page.sections as Parameters<typeof hydrateSections>[0]
    await hydrateSections(sections, {
      fetchForTenant,
      locale: locale as SupportedLocale,
      defaultLocale,
      enabledModuleIds: ctx.enabledModuleIds,
      moduleConfig: ctx.moduleConfig ?? undefined,
    })
    const supportedLocales = siteConfig?.supportedLocales ?? [defaultLocale]
    return (
      <SlugMapProvider slugMap={indexRouteSlugMap(supportedLocales, segment)}>
        {(sections ?? []).map((section, index) => (
          <SectionRenderer
            hostScoped={ctx.hostScoped}
            key={section._key}
            section={section}
            siteConfig={siteConfig}
            designSystem={designSystem}
            backgroundPattern={undefined}
            sectionIndex={index}
            locale={locale}
            tenantSlug={ctx.tenantId}
            fromParam={segment}
            enabledModuleIds={ctx.enabledModuleIds}
            moduleConfig={ctx.moduleConfig ?? undefined}
          />
        ))}
      </SlugMapProvider>
    )
  }

  const now = new Date()
  const entry = await resolveCatalogueEntry(fetchForTenant, dispatch.slug, { locale, defaultLocale, config, now })
  if (entry.kind === 'redirect') permanentRedirect(`${siteBase}/${segment}/${encodeURIComponent(entry.slug)}`)
  if (entry.kind === 'notFound') notFound()

  const origin = canonicalOrigin(siteConfig?.customDomain)
  const itemHref = (item: Parameters<typeof catalogueItemHref>[0]) => catalogueItemHref(item, siteBase, segment)
  const itemUrl = (item: Parameters<typeof catalogueItemCanonical>[0]) => catalogueItemCanonical(item, origin, locale, segment)
  const messages = getCatalogueWebsiteMessages(locale)
  const siteHosts = siteHostsForProject(ctx.tenantId)

  if (entry.kind === 'item') {
    const item = entry.item
    const url = catalogueItemCanonical(item, origin, locale, segment)
    const jsonLd = url ? catalogueItemJsonLd(item, { url, locale, itemUrl }) : null
    return (
      <SlugMapProvider slugMap={catalogueSlugMap(item.page, segment)}>
        {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />}
        <CatalogueItemPageView item={item} designSystem={designSystem} messages={messages} showPrices={config.showPricesByDefault} siteHosts={siteHosts} />
      </SlugMapProvider>
    )
  }

  const collection = entry.collection
  const url = catalogueItemCanonical(collection, origin, locale, segment)
  const jsonLd = url ? catalogueCollectionJsonLd(collection, { url, locale, itemUrl }) : null
  return (
    <SlugMapProvider slugMap={catalogueSlugMap(collection.page!, segment)}>
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />}
      <CatalogueCollectionPageView
        collection={collection}
        designSystem={designSystem}
        messages={messages}
        showPrices={config.showPricesByDefault}
        siteHosts={siteHosts}
        itemHref={itemHref}
      />
    </SlugMapProvider>
  )
}

// ─── Views ────────────────────────────────────────────────────────────────────

function motionOf(designSystem: DesignSystem | null) {
  const m = designSystem?.motion
  return {
    duration: m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35,
    ease: resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1]),
  }
}

const H1_STYLE = {
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-heading)',
  fontSize: 'var(--font-size-h1, clamp(2.25rem, 6vw, 3.5rem))',
  fontWeight: 'var(--font-weight-h1, 700)',
  lineHeight: 'var(--line-height-h1, 1.1)',
} as const

const H2_STYLE = {
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-heading)',
  fontSize: 'var(--font-size-h3, 1.5rem)',
  fontWeight: 'var(--font-weight-h3, 600)',
} as const

function CatalogueCollectionPageView({
  collection,
  designSystem,
  messages,
  showPrices,
  siteHosts,
  itemHref,
}: {
  collection: CatalogueCollectionDTO
  designSystem: DesignSystem | null
  messages: ReturnType<typeof getCatalogueWebsiteMessages>
  showPrices: boolean
  siteHosts: readonly string[]
  itemHref: (item: Parameters<typeof catalogueItemHref>[0]) => string | null
}) {
  const { duration, ease } = motionOf(designSystem)
  return (
    <div style={{ backgroundColor: 'var(--color-background)' }}>
      <div className="mx-auto max-w-3xl px-5 py-12 md:px-10 md:py-20">
        <SlideUp duration={duration} ease={ease} className="mb-12">
          <h1 style={H1_STYLE}>{collection.name}</h1>
          {collection.description && (
            <p className="mt-4 text-lg leading-relaxed" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}>
              {collection.description}
            </p>
          )}
        </SlideUp>
        <CatalogueCollectionView
          collection={collection}
          display={{ showPrices, allergens: 'compact', siteHosts }}
          messages={messages}
          designSystem={designSystem}
          itemHref={itemHref}
          rootHeadingLevel={2}
        />
      </div>
    </div>
  )
}

function CatalogueItemPageView({
  item,
  designSystem,
  messages: m,
  showPrices,
  siteHosts,
}: {
  item: CatalogueItemPageDTO
  designSystem: DesignSystem | null
  messages: ReturnType<typeof getCatalogueWebsiteMessages>
  showPrices: boolean
  siteHosts: readonly string[]
}) {
  const { duration, ease } = motionOf(designSystem)
  const hero = item.images[0]
  const heroSource = hero ? (hero.image as unknown as ResolvedImage) : null
  const optionLists = item.optionLists.filter((l) => l.options.length > 0)
  const decl = item.allergenDeclaration
  const hasDietaryInfo = (decl !== null && decl.status !== 'notReviewed') || item.dietary.length > 0
  return (
    <div style={{ backgroundColor: 'var(--color-background)' }}>
      <article className="mx-auto max-w-3xl px-5 py-12 md:px-10 md:py-20" data-item={item.publicId ?? undefined}>
        {heroSource && (
          <SlideUp duration={duration} ease={ease} className="mb-10">
            <img
              src={imageUrl(heroSource, 1600)}
              srcSet={imageSrcSet(heroSource, [600, 900, 1200, 1600])}
              sizes="(min-width: 768px) 48rem, 100vw"
              alt={hero.alt ?? ''}
              className="aspect-[4/3] w-full rounded-[var(--radius-lg,1rem)] object-cover"
              style={{ objectPosition: hero.objectPosition }}
            />
          </SlideUp>
        )}

        <SlideUp duration={duration} ease={ease} delay={0.05}>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 style={H1_STYLE}>{item.name}</h1>
              <Byline byline={item.byline} className="mt-2 text-lg" />
            </div>
            {showPrices && item.offers.length > 0 && (
              <div className="sm:pt-3">
                <span className="sr-only">{m.pricesHeading}</span>
                <OfferList offers={item.offers} m={m} />
              </div>
            )}
          </div>
          {item.description && (
            <p className="mt-4 text-lg leading-relaxed" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}>
              {item.description}
            </p>
          )}
        </SlideUp>

        {item.links.length > 0 && (
          <SlideUp duration={duration} ease={ease} delay={0.08} className="mt-8">
            <ItemLinks links={item.links} siteHosts={siteHosts} compact={false} heading={m.linksHeading} />
          </SlideUp>
        )}

        {item.body && (
          <SlideUp duration={duration} ease={ease} delay={0.1} className="mt-10">
            <PortableText value={item.body as never} components={articlePortableTextComponents} />
          </SlideUp>
        )}

        {optionLists.length > 0 && (
          <SlideUp duration={duration} ease={ease} delay={0.15} className="mt-12">
            {m.optionsHeading && <h2 className="mb-6" style={H2_STYLE}>{m.optionsHeading}</h2>}
            <div className="flex flex-col gap-8">
              {optionLists.map((l) => {
                const rule = optionRuleText(m, l.min, l.max)
                return (
                  <section key={l.key} aria-label={l.name || undefined}>
                    {(l.name || rule) && (
                      <p className="mb-3 font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                        {l.name}
                        {rule && <span className="ml-2 text-sm font-normal" style={{ color: 'var(--color-text-secondary)' }}>{rule}</span>}
                      </p>
                    )}
                    <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--color-border)' }}>
                      {l.options.map((o) => (
                        <li key={o.key} className="flex justify-between gap-4 py-2.5" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}>
                          <span>
                            {o.kind === 'remove' ? fillMessage(m.without, { label: o.label }) || o.label : o.label}
                            {/* ADR-033 D-3a: the choice's allergens beside it, as text. */}
                            {optionAllergenText(o.allergenDeclaration, m) && (
                              <span className="block text-sm" style={{ color: 'var(--color-text-secondary)' }} data-option-allergens="">
                                {optionAllergenText(o.allergenDeclaration, m)}
                              </span>
                            )}
                          </span>
                          {showPrices && o.formattedDelta && (
                            <span className="tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{o.formattedDelta}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              })}
            </div>
          </SlideUp>
        )}

        {hasDietaryInfo && (
          <SlideUp duration={duration} ease={ease} delay={0.2} className="mt-12">
            <AllergensAndDietary item={item} m={m} compact={false} />
          </SlideUp>
        )}
      </article>
    </div>
  )
}
