'use client'

import { useTranslations } from 'next-intl'
import type { CourseListItem, CourseState } from '@/lib/api/course-drafts'
import type { FilterableCourse } from '@/lib/client/courses-filter'
import type { CourseColor } from '@/lib/modules/courses/model'
import { LifecycleBadge } from '@/components/app/lifecycle/LifecycleBadge'
import { Pill } from '@/components/app/ui/list/cells'

/** Shared bits of the Courses screens (ADR-045): the list row type, the status badge, colour, limits and icons. */

/** One row of the Courses list (table, cards, phone rows). */
export type CourseRow = FilterableCourse & {
  publicId: string
  shortDescription: string
  color: CourseColor
  isPublished: boolean
  hasDraft: boolean
  schedule: CourseListItem['schedule']
  missingLanguages: string[]
  createdAt: string
  /** The course's editor. */
  href: string
}

/**
 * Input limits, mirroring COURSE_LIMITS in src/lib/api/course-drafts.ts (the
 * server enforces them; the browser only stops typing past them). Kept here so
 * the client bundle never imports the server module.
 */
export const COURSE_UI_LIMITS = { title: 120, shortDescription: 600 } as const

export function toCourseRow(c: CourseListItem, projectSlug: string): CourseRow {
  return {
    id: c.id,
    publicId: c.publicId,
    title: c.title,
    shortDescription: c.shortDescription,
    color: c.color,
    searchText: c.searchText,
    state: c.state,
    isPublished: c.isPublished,
    hasDraft: c.hasDraft,
    schedule: c.schedule,
    missingLanguages: c.missingLanguages,
    updatedAt: c.updatedAt,
    createdAt: c.createdAt,
    href: `/${projectSlug}/courses/${c.id}`,
  }
}

/** The course's status as the shared lifecycle badge: Draft · Published (+ Pending changes) · Archived. */
export function CourseStateBadge({ state, oneLine = false }: { state: CourseState; oneLine?: boolean }) {
  if (state === 'changes') return <LifecycleBadge status="published" changes oneLine={oneLine} />
  return <LifecycleBadge status={state} oneLine={oneLine} />
}

/** The course's colour, as the background of its media area (design-system tokens only). */
export function colorClass(color: CourseColor): string {
  return color === 'accent' ? 'bg-accent' : color === 'muted' ? 'bg-muted' : 'bg-card'
}

/** "Missing DE, EN" — site languages with no title yet (calm outline pill). */
export function MissingPills({ languages, state }: { languages: string[]; state: CourseState }) {
  const t = useTranslations('clientDashboard.courses.list')
  if (state === 'archived' || !languages.length) return null
  return (
    <span className="flex flex-wrap items-start gap-1.5">
      <Pill tone="outline" icon={<span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-attention" />}>
        {t('missing', { languages: languages.map((l) => l.toUpperCase()).join(', ') })}
      </Pill>
    </span>
  )
}

/** "3 classes" / "—" (the number of weekly classes; unknown until scheduling is connected). */
export function useClassesText() {
  const t = useTranslations('clientDashboard.courses.list')
  return (schedule: CourseRow['schedule']): string => (schedule ? t('classesCount', { count: schedule.classes }) : '—')
}

export function svg(d: string, size = 20, width = 2) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export const COURSE_ICONS = {
  plus: svg('M12 5v14M5 12h14', 18, 2.2),
  list: svg('M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', 20, 2.2),
  grid: svg('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', 20, 1.8),
  calendar: svg('M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 28, 1.5),
}
