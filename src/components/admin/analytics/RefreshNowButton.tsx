'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { refreshAnalyticsAction, type RefreshActionState } from '@/lib/admin/analytics-actions'

/** "Refresh now" for one site: runs today's snapshot immediately and reports per source. */
export function RefreshNowButton({ slug }: { slug: string }) {
  const t = useTranslations('admin.analytics.refresh')
  const [state, action, pending] = useActionState<RefreshActionState, FormData>(refreshAnalyticsAction, { status: 'idle' })
  const router = useRouter()
  // The pages are dynamic: re-read them once the new snapshot is written.
  useEffect(() => {
    if (state.status === 'done') router.refresh()
  }, [state, router])
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="slug" value={slug} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 shrink-0 items-center rounded-xl border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
      >
        {pending ? t('running') : t('button')}
      </button>
      <p aria-live="polite" className="text-right text-xs leading-4 text-muted-foreground">
        {state.status === 'done'
          ? state.errors?.length
            ? t('doneWithErrors', { count: state.errors.length })
            : t('done')
          : state.status === 'refused'
            ? t('refused')
            : state.status === 'failed'
              ? t('failed')
              : null}
      </p>
    </form>
  )
}
