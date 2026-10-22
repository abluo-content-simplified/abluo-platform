'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Notice } from '@/components/app/ui/Notice'
import { dismissNoticeAction } from '@/app/[locale]/(client)/[tenant]/whats-new-actions'
import { stillActive, type ClientNotice } from '@/lib/whats-new/notices'

/**
 * Announcements on top of the client dashboard (planned maintenance, a known
 * issue). The server sends the notices that are active for this person right
 * now; here the window is re-checked every minute so a banner ends on time
 * without a reload. Info notices can be closed (remembered per person);
 * warnings have no close button and stay until they end. `notices` null or
 * empty = nothing is rendered.
 */
export function AnnouncementBanners({ notices }: { notices: ClientNotice[] | null }) {
  const t = useTranslations('clientDashboard.announcements')
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  if (!notices || notices.length === 0) return null
  const visible = stillActive(notices, now, closed)
  if (visible.length === 0) return null

  return (
    <div className="space-y-2 px-4 pt-4 md:px-6 md:pt-6">
      {visible.map((n) => (
        <Notice
          key={n.id}
          tone={n.tone === 'warning' ? 'neutral' : 'info'}
          layout="row"
          className={n.tone === 'warning' ? 'border-2' : ''}
          title={n.tone === 'warning' ? t('warning') : undefined}
          onDismiss={
            n.dismissible
              ? () => {
                  setClosed((prev) => new Set([...prev, n.id]))
                  void dismissNoticeAction(n.id)
                }
              : undefined
          }
          dismissLabel={n.dismissible ? t('dismiss') : undefined}
        >
          <span lang={n.lang}>{n.message}</span>
        </Notice>
      ))}
    </div>
  )
}
