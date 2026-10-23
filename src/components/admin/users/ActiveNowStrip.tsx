'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Avatar } from '@/components/app/ui/Avatar'
import { Panel } from '@/components/app/ui/Panel'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import type { AdminPerson } from '@/lib/admin/users-model'
import { liveAccess, userHref } from './users-bits'

/**
 * Who has a dashboard open right now (seen in the last 5 minutes, ADR-030
 * A1), as of the page's snapshot. Each person links to their page.
 */
export function ActiveNowStrip({ people }: { people: AdminPerson[] }) {
  const t = useTranslations('admin.users')
  return (
    <section aria-labelledby="users-active-now" className="flex flex-col gap-3">
      <SectionHeading id="users-active-now" title={t('activeNowHeading', { count: people.length })} />
      <Panel>
        {people.length === 0 ? (
          <p className="text-sm leading-6 text-muted-foreground">{t('activeNowEmpty')}</p>
        ) : (
          <ul className="flex flex-wrap gap-x-6 gap-y-3">
            {people.map((p) => {
              const where = p.superAdmin ? t('superAdmin') : (liveAccess(p)[0]?.placeName ?? '')
              return (
                <li key={p.key}>
                  <Link href={userHref(p.key)} className="flex min-h-11 items-start gap-3 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                    <Avatar name={p.name} email={p.email} src={p.avatarUrl} size="sm" />
                    <span className="flex flex-col">
                      <span className="text-[0.9375rem] leading-[1.375rem] font-medium text-foreground">{p.name || p.email}</span>
                      {where ? <span className="text-sm leading-5 text-muted-foreground">{where}</span> : null}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </section>
  )
}
