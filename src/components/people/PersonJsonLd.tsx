import { canonicalUrl } from '@/lib/seo/canonical'
import { safeJsonLd } from '@/lib/seo/safe-json-ld'
import { imageUrl } from '@/lib/sanity/image'
import { personDisplayName } from '@/lib/modules/people/model'
import type { PersonPublic } from '@/lib/modules/people/projection'
import { contactLink } from './contacts'
import { getPeopleMessages } from '@/lib/i18n/people-messages'

export interface PersonSchemaInput {
  /** `https://<customDomain>`; null → nothing is emitted (no canonical address). */
  origin: string | null
  locale: string
  /** Public path segments below the locale: [profileSegment, slug]. */
  pathSegments: string[]
  person: PersonPublic
}

/**
 * schema.org Person for a profile page (ADR-043 D7). Pure. Only what the
 * public projection carries and the page shows: no e-mail address (it is
 * deliberately not in the HTML), no telephone. Social profiles go in `sameAs`.
 */
export function buildPersonSchema(input: PersonSchemaInput): Record<string, unknown> | null {
  const { origin, locale, pathSegments, person } = input
  const name = personDisplayName(person)
  const url = canonicalUrl(origin, locale, ...pathSegments)
  if (!name || !origin || !url) return null

  const msg = getPeopleMessages(locale)
  const sameAs = [
    person.website,
    ...(person.contacts ?? [])
      .filter((c) => c.kind === 'instagram' || c.kind === 'linkedin' || c.kind === 'website')
      .map((c) => {
        const l = contactLink(c, msg)
        return l && l.type === 'link' ? l.href : null
      }),
  ].filter((u, i, all): u is string => !!u && /^https?:\/\//i.test(u) && all.indexOf(u) === i)
  const image = imageUrl(person.photo ?? undefined, 800)

  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': `${url}#person`,
    url,
    mainEntityOfPage: url,
    name,
    ...(person.firstName && { givenName: person.firstName }),
    ...(person.lastName && { familyName: person.lastName }),
    ...(person.honorific && { honorificPrefix: person.honorific }),
    ...(person.jobTitle && { jobTitle: person.jobTitle }),
    ...(person.shortBio && { description: person.shortBio }),
    ...(image && { image }),
    ...(person.languages?.length && { knowsLanguage: person.languages }),
    ...(sameAs.length > 0 && { sameAs }),
    worksFor: { '@id': `${origin}#organization` },
  }
}

export function PersonJsonLd(props: PersonSchemaInput) {
  const schema = buildPersonSchema(props)
  if (!schema) return null
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(schema) }} />
}
