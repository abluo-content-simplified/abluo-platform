import type { WebsiteSiteConfig, FAQSection } from '@/lib/sanity/types'

interface Props {
  siteConfig: WebsiteSiteConfig | null
  faqSection?: FAQSection | null
  locale: string
  tenantId: string
}

/**
 * Renders Schema.org JSON-LD structured data for:
 * - Dentist (LocalBusiness) — powers knowledge panel, maps, voice search
 * - FAQPage — enables expandable FAQ rich results in Google
 *
 * Both scripts are invisible to users but read by search engines.
 */
export function JsonLd({ siteConfig, faqSection, locale, tenantId }: Props) {
  const canonicalBase = siteConfig?.customDomain ? `https://${siteConfig.customDomain}` : null
  const url = canonicalBase ? `${canonicalBase}/${locale}/${tenantId}` : undefined

  // ── Dentist / LocalBusiness ───────────────────────────────────────────────
  const dentistSchema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Dentist',
    name: siteConfig?.siteName,
    url,
    ...(siteConfig?.phone && { telephone: siteConfig.phone }),
    ...(siteConfig?.email && { email: siteConfig.email }),
    ...(siteConfig?.address && {
      address: {
        '@type': 'PostalAddress',
        streetAddress: siteConfig.address,
        addressCountry: 'IT',
      },
    }),
    ...(siteConfig?.tagline && { description: siteConfig.tagline }),
    foundingDate: '1991',
  }

  // ── FAQPage ───────────────────────────────────────────────────────────────
  const faqItems = faqSection?.items?.filter((i) => i.question && i.answer) ?? []
  const faqSchema =
    faqItems.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: faqItems.map((item) => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: {
              '@type': 'Answer',
              text: item.answer,
            },
          })),
        }
      : null

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(dentistSchema) }}
      />
      {faqSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        />
      )}
    </>
  )
}
