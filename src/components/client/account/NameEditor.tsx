'use client'

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { DISPLAY_NAME_MAX, normalizeDisplayName } from '@/lib/account/display-name'
import { updateDisplayNameAction } from '@/app/[locale]/(client)/account/actions'
import { Button } from '@/components/app/ui/Button'
import { TextInput } from '@/components/app/ui/TextInput'
import { FieldError } from '@/components/app/ui/FieldLabel'

/**
 * The "Name" row of the profile (Account page and profile panel), editable in
 * place: Edit → field → Save / Cancel. Same look as a FactRow when not
 * editing; render it inside the same `<dl>`. After saving, the page data is
 * refreshed so the sidebar's account menu and the greeting show the new name.
 */
export function NameEditor({ name }: { name: string }) {
  const t = useTranslations('account')
  const router = useRouter()
  const inputId = useId()
  const errorId = useId()
  const input = useRef<HTMLInputElement>(null)
  const editButton = useRef<HTMLButtonElement>(null)
  const [shown, setShown] = useState(name)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const wasEditing = useRef(false)

  // A fresh server value (after refresh) replaces what is shown.
  const [lastName, setLastName] = useState(name)
  if (name !== lastName) {
    setLastName(name)
    setShown(name)
  }

  // Focus the field on open; give focus back to Edit on close.
  useEffect(() => {
    if (editing) input.current?.select()
    else if (wasEditing.current) editButton.current?.focus()
    wasEditing.current = editing
  }, [editing])

  function open() {
    setDraft(shown)
    setError(null)
    setEditing(true)
  }

  function cancel() {
    setError(null)
    setEditing(false)
  }

  function save(e: FormEvent) {
    e.preventDefault()
    const checked = normalizeDisplayName(draft)
    if (!checked.ok) {
      setError(t(`nameErrors.${checked.error}`, { max: DISPLAY_NAME_MAX }))
      return
    }
    if (checked.name === shown) {
      setEditing(false)
      return
    }
    setError(null)
    start(async () => {
      const r = await updateDisplayNameAction(checked.name)
      if (!r.ok) {
        setError(t(`nameErrors.${r.error}`, { max: DISPLAY_NAME_MAX }))
        return
      }
      setShown(r.name)
      setEditing(false)
      router.refresh()
    })
  }


  if (!editing) {
    return (
      <div className="flex min-h-10 items-start justify-between gap-4 border-b border-border py-2.5 text-[0.9375rem] last:border-b-0">
        <dt className="text-muted-foreground">{t('name')}</dt>
        <dd className="flex min-w-0 items-start gap-3 text-right text-foreground">
          <span className="min-w-0 break-words">{shown || <span className="text-muted-foreground">{t('notSet')}</span>}</span>
          <Button ref={editButton} variant="link" onClick={open} aria-label={t('editName')} className="-my-2.5">
            {t('edit')}
          </Button>
        </dd>
      </div>
    )
  }

  return (
    <div className="border-b border-border py-2.5 text-[0.9375rem] last:border-b-0">
      <dt>
        <label htmlFor={inputId} className="text-muted-foreground">
          {t('name')}
        </label>
      </dt>
      <dd>
        <form onSubmit={save} className="mt-2 flex flex-col gap-2">
          <TextInput
            flush
            ref={input}
            id={inputId}
            type="text"
            name="name"
            autoComplete="name"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              if (error) setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                cancel()
              }
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            disabled={pending}
          />
          <FieldError id={errorId}>{error}</FieldError>
          <div className="flex items-center gap-2">
            <Button variant="primary" type="submit" disabled={pending}>
              {pending ? t('saving') : t('save')}
            </Button>
            <Button variant="quiet" onClick={cancel} disabled={pending}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      </dd>
    </div>
  )
}
