'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { PersonUsage } from '@/lib/api/persons'
import { getPersonAction } from '@/app/[locale]/(client)/[tenant]/people/actions'
import { Skeleton } from '@/components/app/ui/Skeleton'
import { Notice } from '@/components/app/ui/Notice'
import { UsedInList } from './person-bits'

/**
 * The list rows carry usage counts only; the titles of the pages, posts and
 * events that show a person are fetched when the "Where it's used" sheet opens.
 */
export function PersonUsedInLoader({ projectSlug, personId }: { projectSlug: string; personId: string }) {
  const t = useTranslations('clientDashboard.persons.usedIn')
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ready'; usedIn: PersonUsage[] }>({ status: 'loading' })
  useEffect(() => {
    let live = true
    getPersonAction({ projectSlug, id: personId })
      .then((r) => {
        if (live) setState(r.ok ? { status: 'ready', usedIn: r.person.usedIn } : { status: 'error' })
      })
      .catch(() => live && setState({ status: 'error' }))
    return () => {
      live = false
    }
  }, [projectSlug, personId])
  if (state.status === 'loading') {
    return (
      <div aria-busy="true" className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }
  if (state.status === 'error') return <Notice tone="error">{t('loadFailed')}</Notice>
  return <UsedInList usedIn={state.usedIn} projectSlug={projectSlug} />
}
