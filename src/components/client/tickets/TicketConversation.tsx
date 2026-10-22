'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { replyToTicketAction } from '@/app/[locale]/(client)/[tenant]/support/ticket-actions'
import { BackLink } from '@/components/app/ui/BackLink'
import { ButtonLink } from '@/components/app/ui/Button'
import { MessageComposer } from '@/components/app/ui/MessageComposer'
import { MessageThread } from '@/components/app/ui/MessageThread'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { ticketErrorKey } from '@/lib/support-tickets/client-form'
import { TICKET_LIMITS, type TicketDetail } from '@/lib/support-tickets/model'
import { TicketStatusPill, TicketTime, useEventFormatter } from './ticket-bits'

/**
 * One request as the client sees it: reference, title, status, the
 * conversation, and the reply box — or, when replying is not possible, the
 * reason (closed → "Open a New Request"; read-only; support mode).
 */
export function TicketConversation({ ticket, projectSlug, supportMode }: { ticket: TicketDetail; projectSlug: string; supportMode: boolean }) {
  const t = useTranslations('clientDashboard.supportTickets')
  const router = useRouter()
  const formatEvent = useEventFormatter()
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    if (pending || !text.trim()) return
    setPending(true)
    setError(null)
    try {
      const result = await replyToTicketAction(projectSlug, ticket.id, text)
      if (result.ok) {
        setText('')
        router.refresh()
      } else {
        setError(t(`errors.${ticketErrorKey(result.reason, result.field)}`))
      }
    } catch {
      setError(t('errors.error'))
    }
    setPending(false)
  }

  return (
    <>
      <BackLink href={`/${projectSlug}/support`} label={t('ticket.back')} />
      <div>
        <p className="text-sm leading-5 font-medium text-muted-foreground">{ticket.reference}</p>
        <PageHeader title={<span className="break-words">{ticket.title}</span>} />
        <div className="mt-2 flex flex-wrap items-start gap-x-3 gap-y-1.5">
          <TicketStatusPill status={ticket.status} />
          <TicketTime iso={ticket.createdAt} className="text-sm leading-6 text-muted-foreground" />
        </div>
      </div>

      <div className="max-w-2xl space-y-5">
        <MessageThread
          entries={ticket.thread}
          formatEvent={formatEvent}
          labels={{
            support: t('ticket.support'),
            redacted: t('ticket.redacted'),
            internalNote: t('ticket.internalNote'),
            screenshotDeleted: t('ticket.screenshotDeleted'),
            openScreenshot: (n) => t('ticket.openScreenshot', { n }),
            thread: t('ticket.threadLabel'),
          }}
        />

        {ticket.reply === 'closed' ? (
          <Notice
            tone="info"
            title={t('ticket.closedTitle')}
            action={
              <ButtonLink variant="primary" href={`/${projectSlug}/support/new?relatedTo=${encodeURIComponent(ticket.reference)}`}>
                {t('ticket.openNew')}
              </ButtonLink>
            }
          >
            {t('ticket.closedBody')}
          </Notice>
        ) : (
          <MessageComposer
            value={text}
            onChange={setText}
            onSend={() => void send()}
            labels={{ label: t('ticket.replyLabel'), placeholder: t('ticket.replyPlaceholder'), send: t('ticket.send'), sending: t('ticket.sending') }}
            maxLength={TICKET_LIMITS.bodyMax}
            remainingLabel={(count) => t('ticket.remaining', { count })}
            pending={pending}
            disabled={ticket.reply === 'forbidden' || supportMode}
            disabledReason={supportMode ? t('ticket.readOnlySupport') : ticket.reply === 'forbidden' ? t('ticket.readOnlyForbidden') : undefined}
            error={error}
          />
        )}
      </div>
    </>
  )
}
