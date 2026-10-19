'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { createFaqSetAction } from '@/app/[locale]/(client)/[tenant]/faq-sets/actions'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { Field } from '@/components/app/ui/Field'
import { TextInput } from '@/components/app/ui/TextInput'
import { FAQ_UI_LIMITS } from './faq-bits'

/**
 * "New FAQ set" (ADR-037 D9): asks for the name only, creates the draft and
 * opens the editor. No wizard — a set is a name plus a list.
 *
 * Reused by the post editor's FAQ sheet (Builder C): pass `onCreated` to keep
 * the new set in place instead of navigating to its editor, and
 * `defaultName` to suggest a name (e.g. the post's title).
 */
export function NewFaqSetDialog({
  open,
  onClose,
  projectSlug,
  defaultName = '',
  onCreated,
}: {
  open: boolean
  onClose: () => void
  projectSlug: string
  defaultName?: string
  /** Called with the new set instead of opening its editor. */
  onCreated?: (created: { id: string; rev: string; name: string }) => void
}) {
  const t = useTranslations('clientDashboard.faq.newSet')
  const router = useRouter()
  const [name, setName] = useState(defaultName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    // Each opening starts fresh with the suggested name.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on open
    setName(defaultName)
    setError(null)
  }, [open, defaultName])

  const trimmed = name.trim()
  async function create() {
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await createFaqSetAction({ projectSlug, name: trimmed.slice(0, FAQ_UI_LIMITS.name) })
      if (!r.ok) {
        setError(r.error === 'forbidden' ? t('errors.forbidden') : r.error === 'too_large' ? t('errors.tooMany') : t('errors.failed'))
        return
      }
      if (onCreated) {
        onCreated({ id: r.id, rev: r.rev, name: trimmed })
        onClose()
        return
      }
      router.push(`/${projectSlug}/faq-sets/${r.id}`)
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
        <Field label={t('name')} hint={trimmed ? t('nameHint') : t('nameNeeded')} error={error}>
          {(p) => (
            <TextInput
              {...p}
              autoFocus
              value={name}
              maxLength={FAQ_UI_LIMITS.name}
              placeholder={t('namePlaceholder')}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
            />
          )}
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={!trimmed || busy}>
            {busy ? t('creating') : t('create')}
          </Button>
        </div>
      </form>
    </BottomSheet>
  )
}
