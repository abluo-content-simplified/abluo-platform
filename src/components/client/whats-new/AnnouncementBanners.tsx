'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'
import { Notice } from '@/components/app/ui/Notice'
import { PAGE_WIDTH } from '@/components/app/ui/PageShell'
import { SidePanel } from '@/components/app/ui/SidePanel'
import { acknowledgeNoticeAction, dismissNoticeAction } from '@/app/[locale]/(client)/[tenant]/whats-new-actions'
import { stillActive, type ClientNotice } from '@/lib/whats-new/notices'

/**
 * Announcements on top of the client dashboard (planned maintenance, a known
 * issue). The server sends the notices that are active for this person right
 * now; here the window is re-checked every minute so a banner ends on time
 * without a reload. Info notices can be closed (remembered per person);
 * warnings have no close button and stay until they end. ADR-050 D8: a notice
 * may have a "Read more" text (opens a side panel) and may ask for
 * "OK, understood" instead of a close button — one-way, never a reply.
 * `notices` null or empty = nothing is rendered.
 */
export function AnnouncementBanners({ notices, projectSlug, canAcknowledge = true }: { notices: ClientNotice[] | null; projectSlug: string; canAcknowledge?: boolean }) {
  const t = useTranslations('clientDashboard.announcements')
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set())
  const [now, setNow] = useState(() => Date.now())
  const [reading, setReading] = useState<ClientNotice | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  if (!notices || notices.length === 0) return null
  const visible = stillActive(notices, now, closed).filter((n) => !(n.requiresAck && closed.has(n.id)))
  if (visible.length === 0) return null
  const close = (id: string) => setClosed((prev) => new Set([...prev, id]))

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-6">
      <div className={`space-y-2 ${PAGE_WIDTH}`}>
        {visible.map((n) => (
          <Notice
            key={n.id}
            tone={n.tone === 'warning' ? 'neutral' : 'info'}
            layout="row"
            className={n.tone === 'warning' ? 'border-2' : ''}
            title={n.tone === 'warning' ? t('warning') : undefined}
            action={
              n.body || (n.requiresAck && canAcknowledge) ? (
                <span className="flex flex-wrap items-start gap-2">
                  {n.body ? (
                    <Button variant="link" onClick={() => setReading(n)}>
                      {t('readMore')}
                    </Button>
                  ) : null}
                  {n.requiresAck && canAcknowledge ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        close(n.id)
                        void acknowledgeNoticeAction(projectSlug, n.id)
                      }}
                    >
                      {t('acknowledge')}
                    </Button>
                  ) : null}
                </span>
              ) : undefined
            }
            onDismiss={
              n.dismissible
                ? () => {
                    close(n.id)
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
      <SidePanel open={reading !== null} title={t('readMoreTitle')} closeLabel={t('close')} onClose={() => setReading(null)}>
        {reading ? (
          <div className="flex flex-col gap-4" lang={reading.lang}>
            <p className="text-[0.9375rem] leading-6 font-semibold">{reading.message}</p>
            <p className="text-[0.9375rem] leading-6 whitespace-pre-wrap">{reading.body}</p>
          </div>
        ) : null}
      </SidePanel>
    </div>
  )
}
