'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { createPersonAction } from '@/app/[locale]/(client)/[tenant]/people/actions'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { Field } from '@/components/app/ui/Field'
import { TextInput } from '@/components/app/ui/TextInput'
import { PERSON_UI_LIMITS } from './person-bits'

/**
 * "New person" (ADR-043 D8): first and last name only — everything else is
 * filled in later in the editor. Creates the draft and opens the editor, or,
 * with `onCreated`, keeps the new person in place (the People page never
 * passes it; the picker's "Add new person" uses its own injected callback).
 */
export function NewPersonDialog({
  open,
  onClose,
  projectSlug,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  projectSlug: string
  onCreated?: (created: { id: string; publicId: string; rev: string; firstName: string; lastName: string }) => void
}) {
  const t = useTranslations('clientDashboard.persons.newPerson')
  const router = useRouter()
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    // Each opening starts fresh.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on open
    setFirst('')
    setLast('')
    setError(null)
  }, [open])

  const firstName = first.trim()
  const lastName = last.trim()
  const ready = Boolean(firstName && lastName)

  async function create() {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await createPersonAction({ projectSlug, firstName, lastName })
      if (!r.ok) {
        setError(r.error === 'forbidden' ? t('errors.forbidden') : r.error === 'too_large' ? t('errors.tooMany') : r.error === 'missing_name' ? t('errors.missingName') : t('errors.failed'))
        return
      }
      if (onCreated) {
        onCreated({ id: r.id, publicId: r.publicId, rev: r.rev, firstName, lastName })
        onClose()
        return
      }
      router.push(`/${projectSlug}/people/${r.id}`)
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
        <Field label={t('firstName')}>
          {(p) => (
            <TextInput
              {...p}
              autoFocus
              autoComplete="off"
              value={first}
              maxLength={PERSON_UI_LIMITS.name}
              onChange={(e) => {
                setFirst(e.target.value)
                setError(null)
              }}
            />
          )}
        </Field>
        <Field label={t('lastName')} hint={ready ? undefined : t('namesNeeded')} error={error}>
          {(p) => (
            <TextInput
              {...p}
              autoComplete="off"
              value={last}
              maxLength={PERSON_UI_LIMITS.name}
              onChange={(e) => {
                setLast(e.target.value)
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
