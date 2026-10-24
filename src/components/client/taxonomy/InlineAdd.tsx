'use client'

import { Button } from '@/components/app/ui/Button'
import { FieldError } from '@/components/app/ui/FieldLabel'
import { TextInput } from '@/components/app/ui/TextInput'

/**
 * Categories & Tags — the one "+ Add …" control: a primary button that turns
 * into a one-line form (name box · Add · Cancel; Escape cancels). Used by the
 * module sections (Add category / Add tag) and the Media / Galleries tag lists
 * (Add a tag), so all of them look and behave the same. Controlled: the
 * caller owns the open state, the text, busy and the error message.
 */
export function InlineAdd({
  id,
  open,
  onOpen,
  onCancel,
  addLabel,
  placeholder,
  submitLabel,
  busyLabel,
  cancelLabel,
  value,
  onValueChange,
  busy,
  error,
  maxLength,
  onSubmit,
}: {
  id: string
  open: boolean
  onOpen: () => void
  onCancel: () => void
  /** The button ("Add category", "Add a tag"). */
  addLabel: string
  /** The box's placeholder, also its accessible name. */
  placeholder: string
  submitLabel: string
  busyLabel: string
  cancelLabel: string
  value: string
  onValueChange: (value: string) => void
  busy: boolean
  error: string | null
  maxLength: number
  onSubmit: () => void
}) {
  if (!open) {
    return (
      <Button variant="primary" onClick={onOpen}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        {addLabel}
      </Button>
    )
  }
  return (
    <form
      className="flex flex-wrap items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <div className="min-w-0 flex-1 basis-56">
        <label className="sr-only" htmlFor={id}>
          {placeholder}
        </label>
        <TextInput
          flush
          controlSize="md"
          id={id}
          value={value}
          maxLength={maxLength}
          autoFocus
          autoComplete="off"
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
          }}
        />
        <FieldError>{error}</FieldError>
      </div>
      <Button variant="primary" type="submit" disabled={busy || !value.trim()}>
        {busy ? busyLabel : submitLabel}
      </Button>
      <Button variant="quiet" onClick={onCancel}>
        {cancelLabel}
      </Button>
    </form>
  )
}
