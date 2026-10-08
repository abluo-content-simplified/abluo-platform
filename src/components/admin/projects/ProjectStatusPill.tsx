'use client'

import { useTranslations } from 'next-intl'
import { Pill, type PillTone } from '@/components/app/ui/list/cells'

/** Live reads as success, preview highlighted, draft muted, retired outlined. The word carries the meaning. */
const TONE: Record<string, PillTone> = { active: 'success', preview: 'highlight', draft: 'muted', inactive: 'outline' }

/** A project's status as a pill. A status the platform adds later still shows, as its stored value. */
export function ProjectStatusPill({ status }: { status: string }) {
  const t = useTranslations('admin.projects.status')
  const label = t.has(status as 'active') ? t(status as 'active') : status
  return <Pill tone={TONE[status] ?? 'muted'}>{label}</Pill>
}
