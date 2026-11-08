'use client'

import { useTranslations } from 'next-intl'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import type { CourseRow } from './course-bits'

/**
 * Every delete in the Courses list asks first (Tom, 2026-11-08): this names the
 * courses that will be deleted and says their classes go too. Used by the row
 * menu (one course) and the selection bar (several). `skipped` = selected
 * courses that can't be deleted (published ones: archive them first).
 */
export function CoursesDeleteDialog({
  courses,
  skipped,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  /** The courses that will be deleted; empty = closed. */
  courses: CourseRow[]
  skipped: number
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useTranslations('clientDashboard.courses.list.bulk.delete')
  const count = courses.length
  const tl = useTranslations('clientDashboard.courses.list')
  const nameOf = (c: CourseRow) => c.title || tl('untitled')
  const classes = courses.reduce((n, c) => n + (c.schedule?.classes ?? 0), 0)
  const body = [classes > 0 ? t(count === 1 ? 'classes' : 'classesMany', { count: classes }) : '', t('body'), skipped > 0 ? t('skipped', { count: skipped }) : ''].filter(Boolean).join(' ')
  return (
    <ConfirmDialog open={count > 0} title={t('title', { count, name: courses[0] ? nameOf(courses[0]) : '' })} body={body} confirmLabel={t('confirm')} busy={busy} error={error} onConfirm={onConfirm} onCancel={onCancel}>
      {count > 1 ? (
        <ul aria-label={t('list')} className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-[0.9375rem] leading-6 text-foreground">
          {courses.map((c) => (
            <li key={c.id}>
              {nameOf(c)}
              {c.schedule?.classes ? <span className="text-muted-foreground"> · {t('classCount', { count: c.schedule.classes })}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </ConfirmDialog>
  )
}
