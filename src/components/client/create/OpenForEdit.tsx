'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { ButtonLink } from '@/components/app/ui/Button'
import { Skeleton } from '@/components/app/ui/Skeleton'
import { openPostForEditAction } from '@/app/[locale]/(client)/[tenant]/posts/lifecycle-actions'

/**
 * Opening a published post for editing: creates its editable copy
 * (`drafts.<id>`) through a server action, then reloads the route, which now
 * finds the draft and shows the overview. Runs only in the browser, once.
 */
export function OpenForEdit({ projectSlug, id, postsHref }: { projectSlug: string; id: string; postsHref: string }) {
  const t = useTranslations('clientDashboard.create.open')
  const router = useRouter()
  const [failed, setFailed] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    openPostForEditAction({ projectSlug, id })
      .then((r) => (r.ok ? router.refresh() : setFailed(true)))
      .catch(() => setFailed(true))
  }, [projectSlug, id, router])

  return (
    <div data-surface="create" className="mx-auto flex max-w-md flex-col items-start gap-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground" aria-live="polite">
        {failed ? t('failed') : t('title')}
      </h1>
      {failed ? (
        <ButtonLink href={postsHref} size="lg">
          {t('back')}
        </ButtonLink>
      ) : (
        <Skeleton className="h-1 w-40 rounded-full" />
      )}
    </div>
  )
}
