// ── Catalogue Section (Catalogue module, ADR-033; spec §4.6, §10.5) ────────────
//
// Presentation only (D13): renders ONE collection, chosen by the editor, as it
// was ordered and nested in the collection. The data arrives pre-hydrated on
// `section.catalogue` (hydrateSections → hydrateCatalogueListing).
//
// Website states (spec §10.5):
//   - not hydrated (module off, error)          → nothing; the page renders
//   - no collection / not public                → nothing
//   - collection with no items                  → the authored empty state, or nothing
//   - a section heading with no items           → still printed (AC 19)
//
// No JSON-LD here: Menu / ItemList markup belongs to the collection's OWN page
// (ADR-033 B1), so the same menu is not described at two URLs.

import type { CatalogueListingSection as CatalogueListingSectionType, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles, type SurfaceType } from '@/lib/sanity/surfaces'
import { siteBasePath } from '@/lib/sanity/href'
import { resolveEasing } from '@/lib/motion/easing'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { SectionEmptyState } from '@/components/sections/shared/SectionEmptyState'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'
import { CatalogueCollectionView } from '@/components/catalogue/CatalogueCollectionView'
import { siteHostsForProject } from '@/lib/links/link-target'
import { getCatalogueWebsiteMessages } from '@/components/catalogue/messages'
import { AffiliateDisclosure } from '@/components/catalogue/CatalogueItemParts'
import { affiliateDisclosureText, collectionHasAffiliateLink } from '@/lib/modules/catalogue/affiliate'
import { collectionHasAmazonAffiliateLink } from '@/lib/modules/catalogue/amazon-delivery'
import { catalogueItemHref, collectionHasItems, collectionUsesCards, listingAllergenPresentation, listingShowsPrices } from '@/lib/modules/catalogue/website'

interface Props {
  section: CatalogueListingSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
  locale: string
  tenantSlug: string
  hostScoped?: boolean
}

export function CatalogueListingSection({ section, surface, designSystem, locale, tenantSlug, hostScoped }: Props) {
  const data = section.catalogue
  const collection = data?.collection
  if (!data || !collection) return null

  const surfaceStyles = getSurfaceStyles(designSystem, surface)
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  if (!collectionHasItems(collection)) {
    if (!section.emptyStateHeading) return null
    return (
      <SectionContainer id={section.anchorId} style={surfaceStyles}>
        <SectionEmptyState heading={section.emptyStateHeading} body={section.emptyStateBody} duration={duration} ease={ease} />
      </SectionContainer>
    )
  }

  const { eyebrow, title, subtitle } = section
  const siteBase = siteBasePath(locale, tenantSlug, hostScoped)
  const display = {
    showPrices: listingShowsPrices(section.showPrices, data.showPricesByDefault),
    allergens: listingAllergenPresentation(section.allergenPresentation),
    siteHosts: siteHostsForProject(tenantSlug),
    shopOrder: data.shopOrder,
  }

  const messages = getCatalogueWebsiteMessages(locale)
  // Amendment K — once per listing, only when it shows at least one affiliate link.
  const disclosure = affiliateDisclosureText(collectionHasAffiliateLink(collection), data.affiliateDisclosure, messages.affiliateDisclosureDefault)

  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      {(eyebrow || title || subtitle) && (
        <SlideUp duration={duration} ease={ease} delay={0} className="mb-12 max-w-2xl">
          {eyebrow && <EyebrowLabel eyebrow={eyebrow} designSystem={designSystem} defaultAccent="none" className="mb-4" />}
          {title && (
            <h2
              className="[--fs-h2:1.875rem] md:[--fs-h2:2.25rem]"
              style={{
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-heading)',
                fontSize: 'var(--font-size-h2, var(--fs-h2))',
                fontWeight: 'var(--font-weight-h2, 600)',
                lineHeight: 'var(--line-height-h2, 1.375)',
                letterSpacing: 'var(--letter-spacing-h2, -0.025em)',
              }}
            >
              {title}
            </h2>
          )}
          {subtitle && (
            <p className="mt-3 text-base leading-relaxed" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}>
              {subtitle}
            </p>
          )}
        </SlideUp>
      )}
      {/* A card grid (books, products) uses the full width; rows (menus) keep the reading column. */}
      <div className={collectionUsesCards(collection) ? undefined : 'max-w-3xl'}>
        <CatalogueCollectionView
          collection={collection}
          display={display}
          messages={messages}
          designSystem={designSystem}
          itemHref={(item) => catalogueItemHref(item, siteBase, data.segment)}
          rootHeadingLevel={title ? 3 : 2}
        />
        <AffiliateDisclosure text={disclosure} amazonStatement={collectionHasAmazonAffiliateLink(collection) ? messages.amazonStatement || null : null} className="mt-12 max-w-3xl text-sm leading-relaxed" />
      </div>
    </SectionContainer>
  )
}
