'use client'

import { useCallback } from 'react'
import { createPersonAction, searchPersonsAction } from '@/app/[locale]/(client)/[tenant]/people/actions'
import { PersonPicker, type PersonPickerPerson } from '@/components/app/ui/PersonPicker'

/**
 * The shared PersonPicker wired to this project's People list (ADR-043 D8):
 * search and "Add new person" go through the People server actions, which
 * re-check the project and the caller's permissions. Used by the post editor
 * (authors) and the event editor (hosts). `canCreate` = people.person.write.
 */
export function PersonPickerField({
  projectSlug,
  label,
  value,
  onChange,
  primaryLabel,
  max,
  canCreate = false,
  disabled,
  disabledReason,
}: {
  projectSlug: string
  label: string
  value: PersonPickerPerson[]
  onChange: (next: PersonPickerPerson[]) => void
  primaryLabel?: string
  max?: number
  canCreate?: boolean
  disabled?: boolean
  disabledReason?: string
}) {
  const search = useCallback(
    async (query: string): Promise<PersonPickerPerson[]> => {
      const r = await searchPersonsAction({ projectSlug, query, limit: 20 })
      if (!r.ok) throw new Error(r.error)
      return r.items.map((p) => ({ id: p.id, name: p.name, photoUrl: p.photoUrl, jobTitle: p.jobTitle, groups: p.groups, archived: p.archived }))
    },
    [projectSlug]
  )
  const create = useCallback(
    async ({ firstName, lastName }: { firstName: string; lastName: string }): Promise<PersonPickerPerson> => {
      const r = await createPersonAction({ projectSlug, firstName, lastName })
      if (!r.ok) throw new Error(r.error)
      return { id: r.id, name: `${firstName.trim()} ${lastName.trim()}`.trim() }
    },
    [projectSlug]
  )
  return (
    <PersonPicker
      label={label}
      value={value}
      onChange={onChange}
      search={search}
      onCreate={canCreate && !disabled ? create : undefined}
      primaryLabel={primaryLabel}
      max={max}
      disabled={disabled}
      disabledReason={disabledReason}
    />
  )
}
