'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'
import { Panel } from '@/components/app/ui/Panel'
import { decideSupportAction } from '@/app/[locale]/(client)/[tenant]/support-actions'
import { useLocalTime } from './SupportBanner'

/**
 * What the client's Owner / Site admin sees when Abluo support asks for, or
 * holds, edit access to their site (ADR-028 §8). Rendered at the top of every
 * page of the project — so on Home too — by `[tenant]/layout.tsx`, only for
 * people holding `users.manage` on the project and never inside a support
 * visit. One tap allows / declines; "End access" withdraws it at any time.
 */
export type SupportNoticeView = {
  sessionId: string
  status: 'requested' | 'allowed'
  adminName: string
  expiresAt: string | null
}

export function SupportAccessNotice({
  projectSlug,
  notices,
  minutes,
}: {
  projectSlug: string
  notices: SupportNoticeView[]
  /** Edit-access duration (SUPPORT_EDIT_MINUTES), for the request text. */
  minutes: number
}) {
  if (!notices.length) return null
  return (
    <div className="mb-4 flex flex-col gap-3">
      {notices.map((n) => (
        <NoticeCard key={n.sessionId} projectSlug={projectSlug} notice={n} minutes={minutes} />
      ))}
    </div>
  )
}

function NoticeCard({ projectSlug, notice, minutes }: { projectSlug: string; notice: SupportNoticeView; minutes: number }) {
  const t = useTranslations('clientDashboard.support.notice')
  const router = useRouter()
  const [pending, start] = useTransition()
  const [failed, setFailed] = useState(false)
  const until = useLocalTime(notice.status === 'allowed' ? notice.expiresAt : null)
  const name = notice.adminName.trim()

  const decide = (decision: 'allow' | 'decline' | 'revoke') =>
    start(async () => {
      setFailed(false)
      const r = await decideSupportAction({ projectSlug, sessionId: notice.sessionId, decision })
      if (!r.ok) setFailed(true)
      router.refresh()
    })

  const title =
    notice.status === 'requested'
      ? name
        ? t('requestTitle', { name })
        : t('requestTitleNoName')
      : t('allowedTitle', { time: until || '…' })
  const body =
    notice.status === 'requested' ? t('requestBody', { minutes }) : name ? t('allowedBody', { name }) : t('allowedBodyNoName')

  return (
    <Panel as="section">
      <div role="status" className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-base font-semibold leading-6">{title}</p>
          <p className="text-sm leading-5 text-muted-foreground">{body}</p>
          {failed ? (
            <p role="alert" className="text-sm leading-5 text-destructive">
              {t('error')}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {notice.status === 'requested' ? (
            <>
              <Button variant="primary" disabled={pending} onClick={() => decide('allow')}>
                {t('allow')}
              </Button>
              <Button disabled={pending} onClick={() => decide('decline')}>
                {t('decline')}
              </Button>
            </>
          ) : (
            <Button disabled={pending} onClick={() => decide('revoke')}>
              {t('end')}
            </Button>
          )}
        </div>
      </div>
    </Panel>
  )
}
