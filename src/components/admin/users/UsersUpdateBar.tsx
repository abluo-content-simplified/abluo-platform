'use client'

import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Button } from '@/components/app/ui/Button'
import { UpdatedNote } from '@/components/app/analytics/UpdatedNote'

/**
 * The Users pages are a snapshot read when they open (ADR-030 A1); Update
 * reads them again. The button goes in the PageHeader actions (top right,
 * like every other page action); the "Updated …" note sits on its own line
 * under the page description — never next to the button (Tom, 2026-10-23).
 */
export function UsersUpdateButton() {
  const t = useTranslations('admin.users')
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button disabled={pending} onClick={() => start(() => router.refresh())}>
      {pending ? t('updating') : t('update')}
    </Button>
  )
}

export function UsersUpdatedNote({ readAt }: { readAt: string }) {
  return <UpdatedNote iso={readAt} stale={false} />
}
