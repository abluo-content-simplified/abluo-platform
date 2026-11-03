'use client'

import { useTranslations } from 'next-intl'
import { Field } from '@/components/app/ui/Field'
import { Select } from '@/components/app/ui/Select'
import { isItemProfile, type ItemProfile } from '@/lib/modules/catalogue/profiles'
import { useProfileUseFor } from '../use-for-ui'

/**
 * D-22 (C1.12.6) — "Show for": filter the category tree or the tag list by item type
 * (All item types = no filter). Shared by the Categories and Tags panels.
 */
export function ProfileFilter({ value, onChange }: { value: ItemProfile | null; onChange: (next: ItemProfile | null) => void }) {
  const t = useTranslations('catalogue.useFor')
  const { options, allLabel } = useProfileUseFor()
  return (
    <Field label={t('filter')}>
      {(p) => (
        <Select {...p} value={value ?? ''} onChange={(e) => onChange(isItemProfile(e.target.value) ? e.target.value : null)}>
          <option value="">{allLabel}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  )
}
