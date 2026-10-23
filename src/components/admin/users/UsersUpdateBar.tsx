'use client'

import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Button } from '@/components/app/ui/Button'
import { UpdatedNote } from '@/components/app/analytics/UpdatedNote'

/**
 * "Updated 23 Oct, 14:32 · Update" (ADR-030 A1): the Users page is a snapshot
 * read when it opens; Update reads it again. Nothing is live.
 */
export function UsersUpdateBar({ readAt }: { readAt: string }) {
  const t = useTranslations('admin.users')
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <div className="flex flex-wrap items-start gap-3">
      <UpdatedNote iso={readAt} stale={false} />
      <Button disabled={pending} onClick={() => start(() => router.refresh())}>
        {pending ? t('updating') : t('update')}
      </Button>
    </div>
  )
}
