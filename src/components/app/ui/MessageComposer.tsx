'use client'

import { useId, type KeyboardEvent } from 'react'
import { Button } from './Button'
import { SegmentedControl } from './SegmentedControl'
import { TextArea } from './TextInput'

/**
 * The box under a conversation: a text area and a send button.
 *
 *   • `maxLength` + `remainingLabel`: the count of characters left shows once
 *     the text gets near the limit (the last 10 %), never before.
 *   • `pending`: the send button shows `labels.sending` and the field locks.
 *   • `disabled` + `disabledReason`: nothing can be typed; the reason is
 *     written under the box (a disabled action must say why).
 *   • `modes`: a segmented switch above the box (e.g. Reply | Internal note).
 *     A mode with `tone: 'note'` turns the box a different colour and its
 *     send button reads `sendLabel`, so a note can never be mistaken for a
 *     reply. Ctrl / Cmd + Enter sends.
 *
 * Controlled — the parent owns the text and the mode. All text via props.
 */
export type ComposerMode = { id: string; label: string; sendLabel: string; tone?: 'reply' | 'note'; hint?: string }

export function MessageComposer({
  value,
  onChange,
  onSend,
  labels,
  maxLength,
  remainingLabel,
  pending = false,
  disabled = false,
  disabledReason,
  error,
  modes,
  mode,
  onModeChange,
  modeSwitchLabel,
  rows = 4,
}: {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  labels: { placeholder: string; label: string; send: string; sending: string }
  maxLength?: number
  /** "{count} characters left" — called with the number left. */
  remainingLabel?: (remaining: number) => string
  pending?: boolean
  disabled?: boolean
  disabledReason?: string
  error?: string | null
  modes?: ComposerMode[]
  mode?: string
  onModeChange?: (id: string) => void
  /** Accessible name of the mode switch. */
  modeSwitchLabel?: string
  rows?: number
}) {
  const reasonId = useId()
  const current = modes?.find((m) => m.id === mode) ?? modes?.[0] ?? null
  const isNote = current?.tone === 'note'
  const remaining = maxLength === undefined ? null : maxLength - value.length
  const nearLimit = remaining !== null && maxLength !== undefined && remaining <= Math.max(20, Math.floor(maxLength * 0.1))
  const locked = disabled || pending
  const canSend = !locked && value.trim().length > 0 && (remaining === null || remaining >= 0)

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSend) {
      e.preventDefault()
      onSend()
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      {modes && modes.length > 1 && current ? (
        <SegmentedControl
          label={modeSwitchLabel ?? ''}
          value={current.id}
          onChange={(id) => onModeChange?.(id)}
          options={modes.map((m) => ({ value: m.id, label: m.label }))}
          appearance="soft"
        />
      ) : null}
      {current?.hint ? <p className="text-sm leading-5 text-muted-foreground">{current.hint}</p> : null}
      <div className={`w-full rounded-2xl ${isNote ? 'bg-accent p-2' : ''}`}>
      <TextArea
        flush
        aria-label={labels.label}
        aria-describedby={disabledReason ? reasonId : undefined}
        placeholder={labels.placeholder}
        value={value}
        rows={rows}
        disabled={locked}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        className={isNote ? 'border-dashed' : ''}
      />
      </div>
      {nearLimit && remainingLabel && remaining !== null ? (
        <p aria-live="polite" className={`text-sm leading-5 ${remaining < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
          {remainingLabel(remaining)}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm leading-5 text-destructive">
          {error}
        </p>
      ) : null}
      {disabledReason ? (
        <p id={reasonId} className="text-sm leading-5 text-muted-foreground">
          {disabledReason}
        </p>
      ) : null}
      <Button variant="primary" disabled={!canSend} onClick={onSend}>
        {pending ? labels.sending : (current?.sendLabel ?? labels.send)}
      </Button>
    </div>
  )
}
