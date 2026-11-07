import { ArrowRight } from 'lucide-react'
import type { CourseListCourse, CourseListSection as CourseListSectionType, DesignSystem, ResolvedImage } from '@/lib/sanity/types'
import { siteBasePath } from '@/lib/sanity/href'
import { getSurfaceStyles, type SurfaceType } from '@/lib/sanity/surfaces'
import { imageSrcSet, imageUrl } from '@/lib/sanity/image'
import { focalObjectPosition } from '@/lib/gallery/focal'
import { resolveEasing } from '@/lib/motion/easing'
import { courseHref, courseSegmentFor } from '@/lib/modules/courses/website'
import type { ProjectModuleConfig } from '@/lib/modules/config'
import { getCoursePageMessages } from '@/lib/i18n/course-page-messages'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'

interface Props {
  section: CourseListSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
  /** Module config — the Courses `courseSegment`, for the card links. */
  moduleConfig?: ProjectModuleConfig
  /** Page (content) locale. */
  locale?: string
  /** The `[tenant]` URL segment. */
  tenantSlug: string
  hostScoped?: boolean
}

const heading = { fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' } as const

function CourseCard({ course, href, withMedia, linkLabel }: { course: CourseListCourse; href: string | null; withMedia: boolean; linkLabel: string }) {
  const img = (course.image ?? null) as (ResolvedImage & { alt?: string | null }) | null
  const src = img?.asset ? imageUrl(img, 800) : undefined
  const title = course.title?.trim() ?? ''
  return (
    <li
      className="group relative flex h-full flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, var(--radius-lg))' }}
    >
      {withMedia &&
        (src ? (
          <img
            src={src}
            srcSet={imageSrcSet(img!, [400, 800, 1200]) || undefined}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 380px"
            alt={img?.alt?.trim() || ''}
            loading="lazy"
            decoding="async"
            className="aspect-[4/3] w-full object-cover"
            style={{ objectPosition: focalObjectPosition(img) }}
          />
        ) : (
          // No image: a quiet tinted panel keeps the cards of one row aligned.
          <div aria-hidden="true" className="flex aspect-[4/3] w-full items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 9%, var(--color-surface))' }}>
            <span className="text-5xl" style={{ ...heading, color: 'color-mix(in srgb, var(--color-primary) 55%, var(--color-text-muted))' }}>
              {title.charAt(0)}
            </span>
          </div>
        ))}
      <div className="flex flex-1 flex-col p-6">
        <h3 className="text-[1.375rem] font-semibold leading-snug" style={heading}>
          {href ? (
            // The whole card is the link's hit area (::after), the title its accessible name.
            <a href={href} className="after:absolute after:inset-0 after:content-['']">
              {title}
            </a>
          ) : (
            title
          )}
        </h3>
        {course.shortDescription && (
          <p className="mt-3 line-clamp-4 text-[15px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            {course.shortDescription}
          </p>
        )}
        {href && (
          <p aria-hidden="true" className="mt-auto inline-flex items-center gap-1.5 pt-6 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {linkLabel}
            <ArrowRight width={16} height={16} strokeWidth={2} className="transition-transform group-hover:translate-x-0.5" style={{ color: 'var(--color-primary)' }} />
          </p>
        )}
      </div>
    </li>
  )
}

/**
 * CourseListSection — the site's courses as cards (Sections vs Modules: the
 * section owns no data). Courses are hydrated per request by hydrateSections
 * (course-list-section.ts); a section that was not hydrated, or has nothing to
 * show, renders nothing. A card links to the course's own page when the course
 * has one in this language (its slug + the module's course segment).
 */
export function CourseListSection({ section, surface, designSystem, moduleConfig, locale = 'en', tenantSlug, hostScoped }: Props) {
  const courses = section.courseList
  if (!courses?.length) return null

  const { eyebrow, title, intro } = section
  const msg = getCoursePageMessages(locale)
  const surfaceStyles = getSurfaceStyles(designSystem, surface)
  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  const links = { siteBase: siteBasePath(locale, tenantSlug, hostScoped), segment: moduleConfig ? courseSegmentFor(moduleConfig, locale) : null }
  const withMedia = courses.some((c) => c.image?.asset)
  const hasHeader = !!(eyebrow || title || intro)

  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      {hasHeader && (
        <SlideUp duration={duration} ease={ease} delay={0} className="mb-12 max-w-2xl">
          {eyebrow && <EyebrowLabel eyebrow={eyebrow} designSystem={designSystem} className="mb-4" />}
          {title && (
            <h2
              className="[--fs-h2:1.875rem] md:[--fs-h2:2.25rem]"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-h2, var(--fs-h2))', fontWeight: 'var(--font-weight-h2, 600)', lineHeight: 'var(--line-height-h2, 1.375)', letterSpacing: 'var(--letter-spacing-h2, -0.025em)' }}
            >
              {title}
            </h2>
          )}
          {intro && (
            <p className="mt-6 text-base leading-relaxed" style={{ color: 'var(--color-text-secondary)', whiteSpace: 'pre-line' }}>
              {intro}
            </p>
          )}
        </SlideUp>
      )}
      <SlideUp duration={duration} ease={ease} delay={0.08}>
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          {courses.map((c) => (
            <CourseCard key={c.publicId} course={c} href={courseHref(c.slug, links)} withMedia={withMedia} linkLabel={msg.viewCourse} />
          ))}
        </ul>
      </SlideUp>
    </SectionContainer>
  )
}
