'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { createCourseAction } from '@/app/[locale]/(client)/[tenant]/courses/actions'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { Field } from '@/components/app/ui/Field'
import { TextInput } from '@/components/app/ui/TextInput'
import { COURSE_UI_LIMITS } from './course-bits'

/**
 * "New course" (ADR-045): only the title, in the site's main language —
 * everything else (other languages, short description, colour, classes) is
 * filled in later in the editor. Creates the draft and opens the editor.
 */
export function NewCourseDialog({ open, onClose, projectSlug, languageName }: { open: boolean; onClose: () => void; projectSlug: string; languageName: string }) {
  const t = useTranslations('clientDashboard.courses.newCourse')
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    // Each opening starts fresh.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on open
    setTitle('')
    setError(null)
  }, [open])

  const ready = Boolean(title.trim())

  async function create() {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await createCourseAction({ projectSlug, title: title.trim() })
      if (!r.ok) {
        setError(r.error === 'forbidden' ? t('errors.forbidden') : r.error === 'too_large' ? t('errors.tooMany') : r.error === 'missing_title' ? t('errors.missingTitle') : t('errors.failed'))
        return
      }
      router.push(`/${projectSlug}/courses/${r.id}`)
    } catch {
      setError(t('errors.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} title={t('title')} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('intro')}</p>
        <Field label={t('titleLabel', { language: languageName })} hint={ready ? undefined : t('titleNeeded')} error={error}>
          {(p) => (
            <TextInput
              {...p}
              autoFocus
              autoComplete="off"
              value={title}
              maxLength={COURSE_UI_LIMITS.title}
              onChange={(e) => {
                setTitle(e.target.value)
                setError(null)
              }}
            />
          )}
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={!ready || busy}>
            {busy ? t('creating') : t('create')}
          </Button>
        </div>
      </form>
    </BottomSheet>
  )
}
