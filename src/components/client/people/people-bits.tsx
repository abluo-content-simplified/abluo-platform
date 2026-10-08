'use client'

import { useTranslations } from 'next-intl'
import { Pill, type PillTone } from '@/components/app/ui/list/cells'
import type { PersonStatus } from '@/lib/people/service'
import { svg } from '@/components/client/posts/post-bits'

const TONE: Record<PersonStatus, PillTone> = { active: 'success', invited: 'highlight', expired: 'outline', archived: 'muted' }

/** Active / Invited / Expired / Archived — 1.5rem pills, same family as the posts status. */
export function StatusPill({ status }: { status: PersonStatus }) {
  const t = useTranslations('clientDashboard.people.status')
  return <Pill tone={TONE[status]}>{t(status)}</Pill>
}

/** Two-step verification: On / Off. */
export function TwoFactorPill({ on }: { on: boolean }) {
  const t = useTranslations('clientDashboard.people.twoFactor')
  return <Pill tone={on ? 'success' : 'outline'}>{on ? t('on') : t('off')}</Pill>
}

export const PEOPLE_ICONS = {
  plus: svg('M12 5v14M5 12h14', 18, 2.2),
}
