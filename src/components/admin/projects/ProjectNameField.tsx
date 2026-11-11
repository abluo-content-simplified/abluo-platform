'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { renameProjectAction } from '@/app/[locale]/(admin)/projects/[slug]/name-actions'
import { Button } from '@/components/app/ui/Button'
import { Field } from '@/components/app/ui/Field'
import { TextInput } from '@/components/app/ui/TextInput'
import { PROJECT_NAME_MAX } from '@/lib/admin/project-name'

/**
 * The project's name, with Rename (Tom, 2026-11-11): the short name the
 * dashboards list it by. Shown as text; Rename opens the field in place.
 */
export function ProjectNameField({ projectId, name }: { projectId: string; name: string }) {
  const t = useTranslations('admin.projectPage.name')
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    const r = await renameProjectAction(projectId, value).catch(() => ({ ok: false as const, reason: 'error' as const }))
    setBusy(false)
    if (r.ok) {
      setEditing(false)
      router.refresh()
    } else setError(t(r.reason === 'invalid' ? 'invalid' : 'error', { max: PROJECT_NAME_MAX }))
  }

  if (!editing) {
    return (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="break-words">{name}</span>
        <Button
          variant="link"
          onClick={() => {
            setValue(name)
            setEditing(true)
          }}
        >
          {t('rename')}
        </Button>
      </span>
    )
  }
  return (
    <span className="flex w-full flex-col gap-3 py-1">
      <Field label={t('label')} hint={t('hint', { max: PROJECT_NAME_MAX })} error={error}>
        {(p) => <TextInput {...p} value={value} maxLength={PROJECT_NAME_MAX} autoFocus onChange={(e) => setValue(e.target.value)} />}
      </Field>
      <span className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy} aria-busy={busy || undefined} onClick={() => void save()}>
          {t('save')}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
          {t('cancel')}
        </Button>
      </span>
    </span>
  )
}
