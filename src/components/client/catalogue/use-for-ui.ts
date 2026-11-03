'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { PROFILE_ORDER, type ItemProfile } from '@/lib/modules/catalogue/profiles'
import { labelsForUseFor, type UseForOption } from '@/components/app/ui/UseForField'
import { applicabilityTagsOf, isOptionListCompatible, isTagCompatible, type UseForCarrier } from '@/lib/modules/catalogue/taxonomy/profile-applicability'

/**
 * D-22 (C1.12) — the "Use for" vocabulary of the dashboard: Food or drink · Book · Other product ·
 * Service · All item types (Tom's labels), in the profile registry's order.
 */
export function useProfileUseFor() {
  const t = useTranslations('catalogue.useFor')
  return useMemo(() => {
    const options: UseForOption[] = PROFILE_ORDER.map((p) => ({ value: p, label: t(`profiles.${p}`) }))
    const allLabel = t('all')
    const labelOf = (p: ItemProfile | string) => options.find((o) => o.value === p)?.label ?? p
    /** The chips of a value ([] = "All item types"). */
    const chips = (useFor: readonly string[] | undefined) => labelsForUseFor(useFor ?? [], options, allLabel)
    /** One line, e.g. "Book, Other product". */
    const text = (useFor: readonly string[] | undefined) => chips(useFor).join(', ')
    return { options, allLabel, labelOf, chips, text }
  }, [t])
}

/**
 * D-22 for one item: what the readiness facts need (`applicability`, the same data the publish gate
 * reads) and the tag picker's filter. Absent profile = nothing restricted yet.
 */
export function useItemApplicability(
  tags: readonly ({ value: string; label?: Record<string, string> } & UseForCarrier)[],
  optionLists: readonly ({ id: string; name: string } & UseForCarrier)[],
  profile: ItemProfile | null,
) {
  const t = useTranslations('catalogue.useFor')
  const { labelOf } = useProfileUseFor()
  return useMemo(() => {
    const applicability = { tags: applicabilityTagsOf(tags), optionLists }
    const byKey = new Map(applicability.tags.map((x) => [x.key, x]))
    const text = () => (profile ? t('notUsedFor', { profile: labelOf(profile) }) : '')
    const tag = profile ? (key: string) => isTagCompatible(byKey.get(key), profile) : undefined
    const list = profile ? (id: string) => isOptionListCompatible(optionLists.find((l) => l.id === id), profile) : undefined
    return { applicability, profileFit: { tag, list, text } }
  }, [tags, optionLists, profile, t, labelOf])
}
