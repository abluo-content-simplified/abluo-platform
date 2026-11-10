'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'
import { Chip } from '@/components/app/ui/Chip'
import { Field } from '@/components/app/ui/Field'
import { Select } from '@/components/app/ui/Select'
import { MESSAGE_LIMITS } from '@/lib/messages/model'

/**
 * "Open in dashboard" cards for a message (ADR-050 D4): up to 3 dashboard
 * destinations of the recipient's site, picked from a list — never a free
 * URL. Chosen ones show as removable chips.
 */
export function LinkChooser({ targets, value, onChange, disabled = false }: { targets: string[]; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const t = useTranslations('admin.messages.links')
  const tNav = useTranslations('clientDashboard.nav')
  const [pick, setPick] = useState('')
  const label = (id: string) => (tNav.has(id) ? tNav(id) : id)
  const left = targets.filter((id) => !value.includes(id))
  const full = value.length >= MESSAGE_LIMITS.linksMax
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('label')} hint={t('hint', { max: MESSAGE_LIMITS.linksMax })} hintBelow className="min-w-0 flex-1">
          {(p) => (
            <Select {...p} value={pick} disabled={disabled || full} onChange={(e) => setPick(e.target.value)}>
              <option value="">{t('choose')}</option>
              {left.map((id) => (
                <option key={id} value={id}>
                  {label(id)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button
          variant="secondary"
          disabled={disabled || full || !pick}
          onClick={() => {
            if (!pick) return
            onChange([...value, pick])
            setPick('')
          }}
        >
          {t('add')}
        </Button>
      </div>
      {value.length > 0 ? (
        <div className="flex flex-wrap items-start gap-2">
          {value.map((id) => (
            <Chip key={id} selected removable aria-label={t('remove', { place: label(id) })} disabled={disabled} onClick={() => onChange(value.filter((x) => x !== id))}>
              {label(id)}
            </Chip>
          ))}
        </div>
      ) : null}
    </div>
  )
}
