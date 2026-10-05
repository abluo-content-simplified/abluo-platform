'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
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
        <Link
          href={postsHref}
          className="inline-flex h-12 items-center rounded-xl border border-border px-5 text-[15px] font-semibold text-foreground hover:bg-hover"
        >
          {t('back')}
        </Link>
      ) : (
        <span aria-hidden="true" className="h-1 w-40 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
      )}
    </div>
  )
}
