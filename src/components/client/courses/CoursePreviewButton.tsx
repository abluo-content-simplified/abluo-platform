'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { mintCoursePreviewAction } from '@/app/[locale]/(client)/[tenant]/courses/preview-actions'
import { coursePreviewUrl } from '@/lib/client/preview-url'

/**
 * "Preview" for a course: opens the website timetable with this course in it
 * (draft else published, as if it were online) in a new tab, through a private
 * 15-minute link (same flow as the people / posts preview).
 *
 *   <CoursePreviewButton projectSlug={projectSlug} courseId={id} language={lang} beforeOpen={flushed} />
 *
 * `beforeOpen` runs first (return false to stop): the editor passes its
 * autosave flush so the preview shows what is on screen. `language` = the
 * website language to preview (defaults to the dashboard language).
 */
export function CoursePreviewButton({
  projectSlug,
  courseId,
  language,
  beforeOpen,
  disabled,
  variant = 'secondary',
}: {
  projectSlug: string
  /** The course's Sanity base id (no `drafts.` prefix). */
  courseId: string
  language?: string
  beforeOpen?: () => Promise<boolean>
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'quiet'
}) {
  const t = useTranslations('clientDashboard.courses.preview')
  const uiLocale = useLocale()
  const [busy, setBusy] = useState(false)
  const { toast, show } = useUndo()

  const open = async () => {
    if (busy) return
    setBusy(true)
    // The tab is opened inside the click so a popup blocker allows it; the link follows once minted.
    const tab = window.open('about:blank', '_blank')
    if (tab) tab.opener = null
    try {
      if (beforeOpen && !(await beforeOpen())) throw new Error('unsaved')
      const r = await mintCoursePreviewAction({ projectSlug, id: courseId })
      if (!r.ok) throw new Error(r.error)
      const url = coursePreviewUrl({ origin: r.origin, locale: language ?? uiLocale, projectSlug: r.projectSlug, id: courseId, token: r.token })
      if (tab) tab.location.href = url
      else window.location.assign(url)
    } catch {
      tab?.close()
      show({ message: t('failed'), tone: 'error' }, 7000)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant={variant} disabled={disabled || busy} aria-busy={busy || undefined} title={t('hint')} onClick={() => void open()}>
        {t('button')}
      </Button>
      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </>
  )
}
