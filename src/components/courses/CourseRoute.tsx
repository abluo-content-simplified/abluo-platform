// ── Courses — the course page route body (ADR-045 D5) ─────────────────────────
//
// Dispatched from the tenant catch-all (`[...slug]/page.tsx`), after the People
// profiles, the same way: the base path is module config (`courseSegment`),
// never a route folder. Requirements 1–5 of the Publicly Routable Content
// Pattern: slug lookup without fallback, redirect lookup (route.ts),
// SlugMapProvider, hreflang only for languages with a slug AND a segment,
// Course JSON-LD (structured.ts), sitemap (src/lib/seo/sitemap-courses.ts).
//
// The classes are read with the timetable section's own reader
// (timetableForSection) for this one course, WITHOUT meeting details.

import type { Metadata } from 'next'
import { SlugMapProvider, type SlugMap } from '@/components/SlugMapContext'
import { JsonLd } from '@/components/JsonLd'
import { canonicalOrigin, canonicalUrl, hreflangAlternates, seoAlternates } from '@/lib/seo/canonical'
import { safeJsonLd } from '@/lib/seo/safe-json-ld'
import { ogLocale } from '@/lib/seo/og-locale'
import { isDev, isProduction } from '@/lib/deployment'
import { imageSrcSet, imageUrl } from '@/lib/sanity/image'
import { focalObjectPosition } from '@/lib/gallery/focal'
import { addDays } from '@/lib/scheduling/recurrence'
import { siteTimeZone, timetableForSection } from '@/lib/scheduling/timetable.server'
import { todayIn, type TimetableCourseInput } from '@/lib/modules/courses/timetable'
import { COURSE_PAGE_WINDOW_DAYS, courseClasses, timetablePageHref } from '@/lib/modules/courses/course-page'
import { buildCourseSchema } from '@/lib/modules/courses/structured'
import { loadTimetablePages } from '@/lib/modules/courses/route'
import { coursePathsByLocale, courseSegments, type CoursesFetch } from '@/lib/modules/courses/website'
import { isPeopleModuleOn, profileSegmentFor } from '@/lib/modules/people/website'
import { getEnabledModuleIds, type ProjectModuleConfig } from '@/lib/modules/config'
import type { LocalizedSlugMap, ResolvedImage, SupportedLocale, WebsiteSiteConfig } from '@/lib/sanity/types'
import { CoursePage } from './CoursePage'

/** What COURSE_BY_SLUG_QUERY returns. */
export type CourseRouteRecord = TimetableCourseInput & {
  _id: string
  _updatedAt?: string | null
  slugMap?: LocalizedSlugMap | null
}

function pathsOf(course: CourseRouteRecord, moduleConfig: ProjectModuleConfig, siteConfig: WebsiteSiteConfig | null, locale: string) {
  const locales = siteConfig?.supportedLocales ?? [locale as SupportedLocale]
  return coursePathsByLocale(course.slugMap as Record<string, { current?: string | null }> | null, courseSegments(moduleConfig), locales)
}

export function courseRouteMetadata(opts: {
  course: CourseRouteRecord
  moduleConfig: ProjectModuleConfig
  siteConfig: WebsiteSiteConfig | null
  tenantId: string
  locale: string
  defaultLocale: SupportedLocale
}): Metadata {
  const { course, moduleConfig, siteConfig, tenantId, locale, defaultLocale } = opts
  const origin = canonicalOrigin(siteConfig?.customDomain)
  const paths = pathsOf(course, moduleConfig, siteConfig, locale)
  const own = paths[locale]
  const canonical = own ? canonicalUrl(origin, locale as SupportedLocale, ...own) : undefined
  const languages = hreflangAlternates(origin, paths as Record<SupportedLocale, string[] | undefined>, defaultLocale)

  const siteName = siteConfig?.siteName ?? tenantId
  const name = course.title?.trim() || siteName
  const title = `${name} — ${siteName}`
  const description = course.shortDescription?.trim() || siteConfig?.seoDefaultDescription || undefined
  const image = imageUrl((course.image ?? undefined) as ResolvedImage | undefined, 1200)

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
      type: 'website',
      ...(image ? { images: [{ url: image, alt: (course.image as { alt?: string } | null)?.alt || name }] } : {}),
    },
  }
}

export async function CourseRoute(props: {
  course: CourseRouteRecord
  moduleConfig: ProjectModuleConfig
  siteConfig: WebsiteSiteConfig | null
  fetchForTenant: CoursesFetch
  tenantId: string
  locale: string
  defaultLocale: SupportedLocale
  siteBase: string
}) {
  const { course, moduleConfig, siteConfig, fetchForTenant, tenantId, locale, defaultLocale, siteBase } = props
  const paths = pathsOf(course, moduleConfig, siteConfig, locale)
  const origin = canonicalOrigin(siteConfig?.customDomain)

  // Language switcher: the course path per language, only where it exists.
  const slugMap: SlugMap = {}
  for (const [loc, path] of Object.entries(paths)) if (path) slugMap[loc as SupportedLocale] = path.join('/')

  // Teachers link to their People page when the site has profile pages in this language.
  const profileSegment = isPeopleModuleOn(getEnabledModuleIds(moduleConfig)) ? profileSegmentFor(moduleConfig, locale) : null
  const teacherHref = (t: { hasPage: boolean; slug: string | null }) => (profileSegment && t.hasPage && t.slug ? `${siteBase}/${profileSegment}/${t.slug}` : null)
  const teacherUrl = (t: { hasPage: boolean; slug: string | null }) => (profileSegment && t.hasPage && t.slug ? (canonicalUrl(origin, locale, profileSegment, t.slug) ?? null) : null)

  const fetch = fetchForTenant as <T>(query: string, params?: Record<string, unknown>) => Promise<T>
  const timeZone = await siteTimeZone(tenantId, fetch)
  const today = todayIn(timeZone)
  const [data, pages] = await Promise.all([
    timetableForSection(
      tenantId,
      {
        from: today,
        to: addDays(today, COURSE_PAGE_WINDOW_DAYS),
        coursePublicIds: [course.publicId],
        // Never on a course page: no join links, meeting numbers or passcodes.
        includeOnlineDetails: false,
        includeEvents: false,
        locale,
        defaultLocale,
      },
      { fetchForTenant: fetch },
    ),
    loadTimetablePages(fetchForTenant),
  ])
  const classes = courseClasses(data, course.publicId, today, teacherHref)
  const zone = data.timeZone ?? timeZone

  const img = (course.image ?? null) as (ResolvedImage & { alt?: string }) | null
  const src = img?.asset ? imageUrl(img, 1000) : undefined
  const image = src ? { src, srcSet: imageSrcSet(img!, [480, 800, 1000, 1400]) || null, alt: img?.alt?.trim() || '', position: focalObjectPosition(img) } : null

  const schema = paths[locale]
    ? buildCourseSchema({
        origin,
        locale,
        pathSegments: paths[locale]!,
        title: course.title,
        description: course.shortDescription,
        imageUrl: img?.asset ? (imageUrl(img, 1200) ?? null) : null,
        timeZone: zone,
        classes: classes.map((c) => {
          const series = data.series.find((s) => s.id === c.id)
          return {
            rule: c.rule,
            anchor: c.anchor,
            start: c.start,
            end: c.end,
            startsOn: c.startsOn,
            endsOn: c.endsOn,
            mode: c.mode,
            place: c.place ? { name: c.place.name, lines: c.place.lines } : null,
            teachers: (series?.teacherIds ?? []).flatMap((id) => (data.teachers[id] ? [{ name: data.teachers[id].name, url: teacherUrl(data.teachers[id]) }] : [])),
            languages: c.languages,
          }
        }),
      })
    : null

  return (
    <SlugMapProvider slugMap={slugMap}>
      <JsonLd siteConfig={siteConfig} locale={locale} tenantId={tenantId} pathSegments={paths[locale] ?? []} />
      {schema && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(schema) }} />}
      <CoursePage
        locale={locale}
        title={course.title?.trim() || ''}
        description={course.shortDescription}
        image={image}
        classes={classes}
        timeZone={zone}
        timetableHref={timetablePageHref(pages, course._id, locale, siteBase)}
      />
    </SlugMapProvider>
  )
}
