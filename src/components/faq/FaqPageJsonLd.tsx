import type { Post } from '@/lib/sanity/types'
import { placementFaqGroups } from '@/lib/faq/items'
import { buildFaqPageSchema, faqJsonLdItems } from '@/lib/faq/jsonld'
import { faqJsonLdLinks } from '@/lib/faq/collect'
import { canonicalUrl } from '@/lib/seo/canonical'
import { safeJsonLd } from '@/lib/seo/safe-json-ld'

// ── FAQPage for a detail page (ADR-037 D7) ────────────────────────────────────
// A blog post's (later an event's) FAQs as the URL's ONE FAQPage — built from
// the same placementFaqGroups PostArticle renders, so it lists exactly the
// visible questions in this language. Detail pages carry no FAQ sections, so
// the post's placement is the page's whole FAQ.

export function FaqPageJsonLd({
  post,
  locale,
  siteBase,
  origin,
  pathSegments,
}: {
  post: Pick<Post, 'faqSets' | 'faqSetCount' | 'legacyFaq' | 'projectSlug'>
  locale: string
  siteBase: string
  origin: string | null
  pathSegments: string[]
}) {
  const groups = placementFaqGroups({ faqSets: post.faqSets, faqSetCount: post.faqSetCount, legacyItems: post.legacyFaq })
  const items = faqJsonLdItems(groups, faqJsonLdLinks({ locale, siteBase, origin, projectSlug: post.projectSlug }))
  const schema = buildFaqPageSchema({ items, url: canonicalUrl(origin, locale as never, ...pathSegments), origin })
  if (!schema) return null
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(schema) }} />
}
