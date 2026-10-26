'use client'

/**
 * Small pieces the Access screens share (ADR-040 B2.5): the password field,
 * the "who can open it" checklist, the error sentence for an action code and
 * a few formatters. All text comes from `clientDashboard.access`.
 */
import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'
import { CheckboxCard } from '@/components/app/ui/CheckboxCard'
import { Field } from '@/components/app/ui/Field'
import { FieldLabel } from '@/components/app/ui/FieldLabel'
import { TextInput } from '@/components/app/ui/TextInput'
import type { AccessGroupView } from '@/lib/access/dashboard'
import type { UploadProblem } from './upload'

export type AccessT = ReturnType<typeof useTranslations>

/** Every code an action or an upload can answer, as one sentence. */
const KNOWN = new Set([
  'unauthenticated', 'forbidden', 'support_mode', 'not_ready', 'not_found', 'limit_reached', 'name_needed', 'name_too_long',
  'password_blank', 'password_too_short', 'password_too_long', 'password_duplicate', 'groups_needed', 'file_too_large',
  'page_home', 'page_file_download', 'page_conflict', 'invalid', 'not_a_pdf', 'empty', 'size_mismatch', 'hash_mismatch',
  'too_large', 'not_uploaded_yet', 'network',
])

export function errorText(t: AccessT, code: UploadProblem | string, limits?: { passwordMinLength: number }): string {
  if (!KNOWN.has(code)) return t('errors.failed')
  if (code === 'password_too_short') return t('errors.password_too_short', { min: limits?.passwordMinLength ?? 10 })
  return t(`errors.${code}` as 'errors.failed')
}

/** Unambiguous characters only (no 0/O, 1/l/I): easy to read out and type. */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
export function suggestPassword(groups = 3, size = 4): string {
  const bytes = new Uint8Array(groups * size)
  crypto.getRandomValues(bytes)
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length])
  return Array.from({ length: groups }, (_, i) => chars.slice(i * size, (i + 1) * size).join('')).join('-')
}

/**
 * A new password: typed or suggested, shown on request. Never pre-filled with
 * an existing password — those are not known to anyone, not even the server.
 */
export function PasswordField({
  label,
  value,
  onChange,
  error,
  minLength,
  maxLength,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  error?: string | null
  minLength: number
  maxLength: number
  autoFocus?: boolean
}) {
  const t = useTranslations('clientDashboard.access')
  const [shown, setShown] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <Field label={label} hint={t('password.hint', { min: minLength })} error={error}>
        {(p) => (
          <TextInput
            {...p}
            type={shown ? 'text' : 'password'}
            autoComplete="new-password"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus={autoFocus}
            value={value}
            maxLength={maxLength}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="quiet"
          size="md"
          onClick={() => {
            onChange(suggestPassword())
            setShown(true)
          }}
        >
          {t('password.suggest')}
        </Button>
        <Button variant="quiet" size="md" aria-pressed={shown} onClick={() => setShown((s) => !s)}>
          {shown ? t('password.hide') : t('password.show')}
        </Button>
      </div>
    </div>
  )
}

/** "Who can open it": one card per live group. */
export function GroupChecklist({
  legend,
  groups,
  value,
  onChange,
  disabled,
}: {
  legend: string
  groups: AccessGroupView[]
  value: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}) {
  const live = groups.filter((g) => !g.archived)
  return (
    <fieldset className="flex flex-col gap-2">
      <FieldLabel as="legend" className="mb-1">{legend}</FieldLabel>
      {live.map((g) => (
        <CheckboxCard
          key={g.id}
          label={g.name}
          checked={value.includes(g.id)}
          disabled={disabled}
          onChange={(on) => onChange(on ? [...value, g.id] : value.filter((x) => x !== g.id))}
        />
      ))}
    </fieldset>
  )
}

export function useLanguageName() {
  const locale = useLocale()
  return (code: string) => {
    try {
      const name = new Intl.DisplayNames([locale], { type: 'language' }).of(code)
      return name ? name.charAt(0).toLocaleUpperCase(locale) + name.slice(1) : code
    } catch {
      return code
    }
  }
}

export function useFileSize() {
  const locale = useLocale()
  return (bytes: number) => {
    const mb = bytes / (1024 * 1024)
    if (mb >= 1) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(mb)} MB`
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.max(1, Math.round(bytes / 1024)))} KB`
  }
}

/** Group names for a list of ids, in the screen's order; archived groups are marked. */
export function groupNames(groups: AccessGroupView[], ids: string[], archivedLabel: (name: string) => string): string[] {
  return groups.filter((g) => ids.includes(g.id)).map((g) => (g.archived ? archivedLabel(g.name) : g.name))
}
