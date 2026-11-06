import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { tenantClient, fetchDesignSystemById } from '@/lib/sanity/client'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { designSystemQuery, localeConfigQuery, projectModuleConfigQuery, websiteSiteConfigQuery } from '@/lib/sanity/queries'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { getEnabledModuleIds, type ProjectModuleConfig } from '@/lib/modules/config'
import type { DesignSystem, LocaleConfig, SupportedLocale, TimetableSection, WebsiteSiteConfig } from '@/lib/sanity/types'
import { SectionRenderer } from '@/components/sections/SectionRenderer'
import { SlugMapProvider } from '@/components/SlugMapContext'
import { asUrlProjectSegment, unbrand } from '@/lib/tenancy/ids'
import { isHostScopedRequest } from '@/lib/tenancy/link-scope.server'
import { authorizeCoursePreview } from '@/lib/preview/authorize'
import { COURSE_PREVIEW_QUERY, previewCourseFrom } from '@/lib/modules/courses/preview-query'
import { coursePreviewBanner } from '@/lib/modules/courses/preview-banner'
import { hydrateTimetableSection } from '@/lib/modules/courses/timetable-section.server'

/**
 * PRIVATE preview of a course in the website timetable (Courses module · ADR-045).
 *
 * Same rules as the other previews (`../../post/[id]/page.tsx`): a valid signed
 * token of kind 'course' for exactly this course and project, or 404; never
 * cached or indexed (`noindex` here plus the proxy's `X-Robots-Tag` /
 * `Cache-Control: no-store`).
 *
 * What it shows: the site's real timetable for the current month — every course
 * the website would show, plus THIS course (draft fields when a draft exists,
 * else the published ones) with its classes, as if it were published. The
 * course is passed to the hydration through the one `previewCourse` seam, which
 * only this route sets, after the token is verified. Online meeting details are
 * never shown (showOnlineDetails off, page not protected).
 *
 * Month navigation is off (no page id): the preview shows the current month.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps {
  params: Promise<{ tenant: string; locale: string; id: string }>
  searchParams?: Promise<{ t?: string | string[]; theme?: string }>
}

export const metadata: Metadata = {
  title: 'Preview',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: 'no-referrer',
}

export default async function CoursePreviewPage({ params, searchParams }: PageProps) {
  const { tenant: rawTenantId, locale, id } = await params
  const tenantId = asUrlProjectSegment(rawTenantId)
  const search = (await searchParams) ?? {}
  const h = await headers()

  const claims = await authorizeCoursePreview({
    token: Array.isArray(search.t) ? undefined : search.t,
    courseId: id,
    urlProject: unbrand(tenantId),
    host: h.get('x-forwarded-host') ?? h.get('host'),
    getDoc: (documentId) => sanityWriteClient.getDocument(documentId),
  })
  if (!claims) notFound()

  const { fetchForTenant } = tenantClient(tenantId)
  const hostScoped = await isHostScopedRequest(tenantId)
  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  const read = (docId: string) =>
    sanityWriteClient.fetch<Record<string, unknown> | null>(
      COURSE_PREVIEW_QUERY,
      { docId, projectSlug: claims.projectSlug, locale, defaultLocale },
      { perspective: 'raw' },
    )

  const [raw, siteConfig, designSystem, moduleConfig] = await Promise.all([
    (async () => (await read(`drafts.${claims.draftId}`)) ?? (await read(claims.draftId)))(),
    fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale }),
    (async () => resolveDesignSystemInheritance(await fetchForTenant<DesignSystem>(designSystemQuery, {}), fetchDesignSystemById))(),
    fetchForTenant<ProjectModuleConfig>(projectModuleConfigQuery, { locale, defaultLocale }),
  ])
  const previewCourse = previewCourseFrom(raw)
  if (!previewCourse) notFound()

  // A standalone Timetable section (all courses, month view, week/month switch, print button, no meeting details).
  const section: TimetableSection = {
    _type: 'timetableSection',
    _key: 'course-preview',
    courseScope: 'all',
    defaultView: 'month',
    allowViewSwitch: true,
    showOnlineDetails: false,
    // The owner can test printing here: the Print button, and the "About the courses" page so its look can be checked too.
    showPrintButton: true,
    showCourseDescriptions: true,
  }
  await hydrateTimetableSection(section, {
    projectSlug: claims.projectSlug,
    locale,
    defaultLocale,
    fetchForTenant,
    pageId: null,
    pageProtected: false,
    previewCourse,
  })

  const enabledModuleIds = getEnabledModuleIds(moduleConfig)
  const banner = coursePreviewBanner(locale)

  return (
    <SlugMapProvider slugMap={{}}>
      <div
        role="status"
        data-course-preview-banner
        style={{ background: 'var(--color-surface, #f4f4f5)', color: 'var(--color-text-primary, #111)', borderBottom: '1px solid var(--color-border, #d4d4d8)', padding: '0.75rem 1rem', fontSize: '0.875rem', lineHeight: 1.4 }}
      >
        <strong>{banner.title}</strong>
        <span style={{ display: 'block', opacity: 0.8 }}>{banner.body}</span>
      </div>
      <SectionRenderer
        hostScoped={hostScoped}
        section={section}
        siteConfig={siteConfig}
        designSystem={designSystem}
        backgroundPattern={undefined}
        sectionIndex={0}
        locale={locale}
        tenantSlug={tenantId}
        enabledModuleIds={enabledModuleIds}
        moduleConfig={moduleConfig}
      />
    </SlugMapProvider>
  )
}
