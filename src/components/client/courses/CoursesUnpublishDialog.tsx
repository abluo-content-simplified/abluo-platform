'use client'

import { useTranslations } from 'next-intl'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'

/**
 * "Unpublish" always asks first (Tom, 2026-11-08) and says what happens: the
 * course leaves the website — its classes disappear from the website's
 * timetable and its course page goes away — while its classes stay in the
 * dashboard, and "Publish again" puts it back. One course (row menu) or
 * several (selection bar; `skipped` = selected ones it does not apply to).
 */
export function CoursesUnpublishDialog({
  courses,
  skipped = 0,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  /** The courses to unpublish; empty = closed. */
  courses: ReadonlyArray<{ id: string; title: string }>
  skipped?: number
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useTranslations('clientDashboard.courses.list.unpublish')
  const tl = useTranslations('clientDashboard.courses.list')
  const count = courses.length
  const nameOf = (c: { title: string }) => c.title || tl('untitled')
  const body = [t('body', { count }), skipped > 0 ? t('skipped', { count: skipped }) : ''].filter(Boolean).join(' ')
  return (
    <ConfirmDialog open={count > 0} title={t('title', { count, name: courses[0] ? nameOf(courses[0]) : '' })} body={body} confirmLabel={t('confirm')} cancelLabel={t('cancel')} busy={busy} error={error} onConfirm={onConfirm} onCancel={onCancel}>
      {count > 1 ? (
        <ul aria-label={t('list')} className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-[0.9375rem] leading-6 text-foreground">
          {courses.map((c) => (
            <li key={c.id}>{nameOf(c)}</li>
          ))}
        </ul>
      ) : null}
    </ConfirmDialog>
  )
}
