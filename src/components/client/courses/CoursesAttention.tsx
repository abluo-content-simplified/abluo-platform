'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Button, ButtonLink } from '@/components/app/ui/Button'
import { Notice } from '@/components/app/ui/Notice'
import { useDateLocale } from '@/lib/i18n/date-locale-context'
import { formatDateTime } from '@/lib/i18n/date-locale'
import { courseAttention, type AttentionCourse } from '@/lib/modules/courses/list-overview'
import type { CourseListContext } from './course-bits'

/**
 * "Needs attention" above the Courses list (Tom, 2026-11-08): a calm info
 * Notice with only what is true, each line a link —
 *   · the schedule ends soon and nothing is set up after it → the Timetable
 *   · this week's changed dates → the Timetable
 *   · courses without image or description → filters the list to them
 * Nothing to say → nothing rendered.
 */
export function CoursesAttention({
  courses,
  terms,
  ctx,
  timetableHref,
  onShowIncomplete,
}: {
  courses: readonly AttentionCourse[]
  terms: ReadonlyArray<{ startsOn: string; endsOn: string }>
  ctx: CourseListContext
  timetableHref: string
  onShowIncomplete: () => void
}) {
  const t = useTranslations('clientDashboard.courses.list.attention')
  const dateLocale = useDateLocale()
  const items = useMemo(() => courseAttention(courses, terms, ctx.today), [courses, terms, ctx.today])
  if (!items.length) return null
  const day = (d: string) => formatDateTime(dateLocale, Date.parse(`${d}T12:00:00Z`), { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const LINK = 'justify-start text-left'
  return (
    <Notice tone="info" title={t('title')}>
      <ul className="-mb-1 flex flex-col">
        {items.map((item) => (
          <li key={item.kind}>
            {item.kind === 'termEnding' ? (
              <ButtonLink variant="link" className={LINK} href={timetableHref}>
                {t('termEnding', { date: day(item.date) })}
              </ButtonLink>
            ) : item.kind === 'weekChanges' ? (
              <ButtonLink variant="link" className={LINK} href={timetableHref}>
                {t('weekChanges', { changes: item.changes, cancelled: item.cancelled, onlyCancelled: item.cancelled === item.changes ? 'yes' : 'no' })}
              </ButtonLink>
            ) : (
              <Button variant="link" className={LINK} onClick={onShowIncomplete}>
                {t('incomplete', { count: item.count })}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Notice>
  )
}
