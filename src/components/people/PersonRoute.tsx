// ── People — the profile page route body (ADR-043 D7) ─────────────────────────
//
// Dispatched from the tenant catch-all (`[...slug]/page.tsx`), the same way the
// Catalogue serves its configurable segment: the base path is module config,
// never a route folder. Requirements 1–5 of the Publicly Routable Content
// Pattern: slug lookup without fallback, redirect lookup, archived → 308,
// SlugMapProvider, hreflang only for languages with a slug, Person JSON-LD,
// sitemap (src/lib/seo/sitemap-people.ts).

import type { Metadata } from 'next'
import { SlugMapProvider, type SlugMap } from '@/components/SlugMapContext'
import { canonicalOrigin, canonicalUrl, hreflangAlternates, seoAlternates } from '@/lib/seo/canonical'
import { isDev, isProduction } from '@/lib/deployment'
import { imageUrl } from '@/lib/sanity/image'
import { ogLocale } from '@/lib/seo/og-locale'
import { personDisplayName, personFullName } from '@/lib/modules/people/model'
import type { PersonPublic } from '@/lib/modules/people/projection'
import {
  PEOPLE_GROUP_LABELS_QUERY,
  groupLabels,
  profileSegments,
  type PeopleFetch,
} from '@/lib/modules/people/website'
import type { ProjectModuleConfig } from '@/lib/modules/config'
import type { LocalizedSlugMap, SupportedLocale, WebsiteSiteConfig } from '@/lib/sanity/types'
import { PersonJsonLd } from './PersonJsonLd'
import { PersonProfile } from './PersonProfile'

/** What PERSON_BY_SLUG_QUERY returns. */
export type PersonRouteRecord = PersonPublic & { slugMap?: LocalizedSlugMap | null }

/** locale → [segment, slug], only where BOTH exist (a language without a slug or a segment has no page). */
export function personPathsByLocale(
  slugMap: LocalizedSlugMap | null | undefined,
  segments: Record<string, string>,
  locales: readonly string[],
): Record<string, [string, string] | undefined> {
  const out: Record<string, [string, string] | undefined> = {}
  for (const loc of locales) {
    const slug = slugMap?.[loc as SupportedLocale]?.current
    const segment = segments[loc]
    if (slug && segment) out[loc] = [segment, slug]
  }
  return out
}

export function personRouteMetadata(opts: {
  person: PersonRouteRecord
  moduleConfig: ProjectModuleConfig
  siteConfig: WebsiteSiteConfig | null
  tenantId: string
  locale: string
  defaultLocale: SupportedLocale
}): Metadata {
  const { person, moduleConfig, siteConfig, tenantId, locale, defaultLocale } = opts
  const origin = canonicalOrigin(siteConfig?.customDomain)
  const locales = siteConfig?.supportedLocales ?? [locale as SupportedLocale]
  const paths = personPathsByLocale(person.slugMap, profileSegments(moduleConfig), locales)
  const own = paths[locale]
  const canonical = own ? canonicalUrl(origin, locale as SupportedLocale, ...own) : undefined
  const languages = hreflangAlternates(origin, paths as Record<SupportedLocale, string[] | undefined>, defaultLocale)

  const siteName = siteConfig?.siteName ?? tenantId
  const name = personFullName(person)
  const title = `${name} — ${siteName}`
  const description = person.shortBio ?? person.jobTitle ?? siteConfig?.seoDefaultDescription ?? undefined
  const image = imageUrl(person.photo ?? undefined, 1200)

  return {
    title,
    description,
    alternates: seoAlternates(origin, canonical, languages, { isProduction: isProduction(), isDev: isDev() }),
    openGraph: {
      title,
      description,
      url: canonical,
      siteName,
      locale: ogLocale(locale),
      type: 'profile',
      ...(image ? { images: [{ url: image, alt: personDisplayName(person) }] } : {}),
    },
  }
}

export async function PersonRoute(props: {
  person: PersonRouteRecord
  moduleConfig: ProjectModuleConfig
  siteConfig: WebsiteSiteConfig | null
  fetchForTenant: PeopleFetch
  tenantId: string
  locale: string
  defaultLocale: SupportedLocale
  siteBase: string
}) {
  const { person, moduleConfig, siteConfig, fetchForTenant, tenantId, locale, defaultLocale, siteBase } = props
  const segments = profileSegments(moduleConfig)
  const locales = siteConfig?.supportedLocales ?? [locale as SupportedLocale]
  const paths = personPathsByLocale(person.slugMap, segments, locales)

  // Language switcher: the profile path per language, only where it exists.
  const slugMap: SlugMap = {}
  for (const [loc, path] of Object.entries(paths)) if (path) slugMap[loc as SupportedLocale] = path.join('/')

  const terms = person.groups?.length
    ? await fetchForTenant<{ key?: string; label?: unknown }[]>(PEOPLE_GROUP_LABELS_QUERY, {})
    : []

  return (
    <SlugMapProvider slugMap={slugMap}>
      {paths[locale] && (
        <PersonJsonLd
          origin={canonicalOrigin(siteConfig?.customDomain)}
          locale={locale}
          pathSegments={paths[locale]!}
          person={person}
        />
      )}
      <PersonProfile
        person={person}
        locale={locale}
        siteBase={siteBase}
        projectSlug={tenantId}
        groups={groupLabels(person.groups, terms, locale, defaultLocale)}
      />
    </SlugMapProvider>
  )
}
