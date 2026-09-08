import type { WebsiteSiteConfig, FAQSection } from '@/lib/sanity/types'
import { canonicalOrigin, canonicalUrl } from '@/lib/seo/canonical'

interface Props {
  siteConfig: WebsiteSiteConfig | null
  faqSection?: FAQSection | null
  locale: string
  tenantId?: string
  /** Public path segments below the locale, for the page being rendered. */
  pathSegments?: (string | null | undefined)[]
  /** Absolute logo URL, when the tenant has one. Used as the entity's image. */
  logoUrl?: string
}

/**
 * Schema.org JSON-LD.
 *
 * This is the machine-readable half of the page, and the half that answer
 * engines actually read: it is what lets an assistant say what No!Logo IS,
 * rather than paraphrasing whichever paragraph it happened to retrieve. Three
 * graphs are emitted — the organisation, the website, and the FAQ.
 *
 * ── What was wrong before ────────────────────────────────────────────────────
 * The file's own header already told this story once: `'Dentist'` sat hardcoded
 * as the business type, so every tenant — a psychotherapist included — was
 * described to Google as a dental practice. That one was fixed. Two more of
 * exactly the same kind survived it, and both were still live:
 *
 *   foundingDate: '1991'   asserted for EVERY tenant. Studio Martegani's year,
 *                          claimed by Livener, by Abluo and by No!Logo.
 *   addressCountry: 'IT'   asserted for every tenant with an address, including
 *                          Livener, which is registered in England.
 *
 * Both are now driven by authored fields and simply absent when unset. A fact
 * you cannot source is worse than a fact you omit: structured data is consumed
 * without a human reading it, so a wrong value propagates silently — which is
 * precisely how '1991' survived this long.
 *
 * The default type is now `Organization` rather than `LocalBusiness`.
 * `LocalBusiness` asserts a physical place of business open to customers, which
 * is true of the dental studio and false of a white-label reservation engine.
 * `Organization` is the parent of every business type and is never wrong, so it
 * is the right thing to fall back to when a tenant has not said what it is.
 * Tenants that ARE local businesses should set `businessType` explicitly.
 */
// `tenantId` stays in the props for call-site symmetry with the rest of this
// route, and because a BreadcrumbList will need it. It is deliberately absent
// from every URL emitted below.
export function JsonLd({ siteConfig, faqSection, locale, pathSegments = [], logoUrl }: Props) {
  const origin = canonicalOrigin(siteConfig?.customDomain)
  // Same URL the canonical tag names — no project segment. If these two
  // disagree, the entity is attached to a page Google is not indexing.
  const url = canonicalUrl(origin, locale, ...pathSegments)

  // Social profiles are the strongest identity signal an entity can carry:
  // `sameAs` is how a knowledge graph links this organisation to the LinkedIn
  // company page it already trusts. The URLs were in siteConfig all along and
  // simply never reached the schema.
  const sameAs = (siteConfig?.socialLinks ?? [])
    .map((s) => s.url)
    .filter((u): u is string => Boolean(u))

  const organizationSchema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': siteConfig?.businessType || 'Organization',
    '@id': origin ? `${origin}#organization` : undefined,
    name: siteConfig?.legalName || siteConfig?.siteName,
    ...(siteConfig?.siteName && siteConfig?.legalName && siteConfig.legalName !== siteConfig.siteName
      ? { alternateName: siteConfig.siteName }
      : {}),
    url: origin ?? undefined,
    ...(logoUrl && { logo: logoUrl, image: logoUrl }),
    ...(siteConfig?.tagline && { description: siteConfig.tagline }),
    ...(sameAs.length > 0 && { sameAs }),
    ...(siteConfig?.phone && { telephone: siteConfig.phone }),
    ...(siteConfig?.email && { email: siteConfig.email }),
    // Authored, never assumed. Absent when the tenant has not set a year.
    ...(siteConfig?.foundedYear && { foundingDate: String(siteConfig.foundedYear) }),
    ...(siteConfig?.address && {
      address: {
        '@type': 'PostalAddress',
        streetAddress: siteConfig.address,
        // Only claimed when authored. This was 'IT' for everyone.
        ...(siteConfig?.addressCountry && { addressCountry: siteConfig.addressCountry }),
      },
    }),
  }

  // The WebSite entity ties the pages together under one name and declares the
  // language of this rendering, which is what disambiguates seven translations
  // of the same site from seven different sites.
  const websiteSchema = origin
    ? {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        '@id': `${origin}#website`,
        url: origin,
        name: siteConfig?.siteName,
        inLanguage: locale,
        publisher: { '@id': `${origin}#organization` },
      }
    : null

  // ── FAQPage ───────────────────────────────────────────────────────────────
  // Google narrowed FAQ rich results to authoritative sites in 2023, so this no
  // longer wins a snippet for most tenants. It is emitted anyway because it is
  // the cleanest question-and-answer structure an answer engine can consume,
  // and answer engines are the audience that still reads it.
  const faqItems = faqSection?.items?.filter((i) => i.question && i.answer) ?? []
  const faqSchema =
    faqItems.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          ...(url && { '@id': `${url}#faq` }),
          ...(origin && { isPartOf: { '@id': `${origin}#website` } }),
          mainEntity: faqItems.map((item) => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: { '@type': 'Answer', text: item.answer },
          })),
        }
      : null

  // `undefined` values are dropped by JSON.stringify; this keeps the emitted
  // JSON free of null-valued keys without each spread having to guard itself.
  const render = (schema: Record<string, unknown>) => JSON.stringify(schema)

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: render(organizationSchema) }} />
      {websiteSchema && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: render(websiteSchema) }} />
      )}
      {faqSchema && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: render(faqSchema) }} />
      )}
    </>
  )
}
