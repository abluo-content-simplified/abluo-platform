'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { deleteOwnScreenshotAction, replyToTicketAction } from '@/app/[locale]/(client)/[tenant]/support/ticket-actions'
import { AttachmentPicker } from '@/components/app/ui/AttachmentPicker'
import { BackLink } from '@/components/app/ui/BackLink'
import { Button, ButtonLink } from '@/components/app/ui/Button'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { MessageComposer } from '@/components/app/ui/MessageComposer'
import { MessageThread } from '@/components/app/ui/MessageThread'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { FactRow } from '@/components/app/ui/FactRow'
import { Panel } from '@/components/app/ui/Panel'
import { fitScreenshots } from '@/lib/client/ticket-upload'
import { CLIENT_UPLOAD_BUDGET_BYTES, ticketErrorKey } from '@/lib/support-tickets/client-form'
import { ATTACHMENT_MIME_TYPES, TICKET_LIMITS, type TicketDetail } from '@/lib/support-tickets/model'
import { TicketStatusPill, TicketTime, useEventFormatter, useStatusSentence } from './ticket-bits'

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
  const [files, setFiles] = useState<File[]>([])
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const replyRef = useRef<HTMLDivElement>(null)
  const sentence = useStatusSentence()
  const mb = Math.round(TICKET_LIMITS.attachmentBytesMax / (1024 * 1024))
  const waiting = ticket.status === 'waiting_for_user'
  const canReply = ticket.reply === 'allowed'
  const screenshots = ticket.thread.reduce((n, e) => n + (e.kind === 'message' ? e.attachments.filter((a) => a.deleted === null).length : 0), 0)

  function goToReply() {
    const box = replyRef.current
    if (!box) return
    box.scrollIntoView({ behavior: 'smooth', block: 'center' })
    box.querySelector('textarea')?.focus({ preventScroll: true })
  }

  async function confirmDelete() {
    if (!deleting || deleteBusy) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const result = await deleteOwnScreenshotAction(projectSlug, deleting)
      if (result.ok) {
        setDeleting(null)
        router.refresh()
      } else {
        setDeleteError(t(`errors.${ticketErrorKey(result.reason, result.field)}`))
      }
    } catch {
      setDeleteError(t('errors.error'))
    }
    setDeleteBusy(false)
  }

  async function send() {
    if (pending || !text.trim()) return
    setPending(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('body', text)
      const ready = await fitScreenshots(files, CLIENT_UPLOAD_BUDGET_BYTES)
      if (!ready) {
        setError(t('errors.uploadTooLarge'))
        setPending(false)
        return
      }
      for (const f of ready) form.append('files', f)
      const result = await replyToTicketAction(projectSlug, ticket.id, form)
      if (result.ok) {
        setText('')
        setFiles([])
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
        <div className="mt-2 hidden flex-wrap items-start gap-x-3 gap-y-1.5 lg:flex">
          <TicketStatusPill status={ticket.status} />
        </div>
      </div>

      {/* Phone: a compact status strip above the conversation. */}
      <Panel as="section" aria-label={t('recap.statusLabel')} highlighted={waiting} className="lg:hidden">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 space-y-0.5">
            <p className="text-[0.9375rem] leading-6 font-semibold">{sentence(ticket)}</p>
            <p className="text-sm leading-5 text-muted-foreground">
              {ticket.reference} · <TicketTime iso={ticket.lastActivityAt} />
            </p>
          </div>
          {waiting && canReply ? (
            <Button variant="secondary" onClick={goToReply}>
              {t('recap.goToReply')}
            </Button>
          ) : null}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,42rem)_20rem] lg:items-start lg:gap-10">
      <div className="min-w-0 space-y-5">
        <MessageThread
          entries={ticket.thread}
          formatEvent={formatEvent}
          labels={{
            support: t('ticket.support'),
            redacted: t('ticket.redacted'),
            internalNote: t('ticket.internalNote'),
            screenshotDeleted: t('ticket.screenshotDeleted'),
            openScreenshot: (n) => t('ticket.openScreenshot', { n }),
            removedPart: t('ticket.removedPart'),
            viewer: {
              dialog: t('ticket.viewer.dialog'),
              close: t('ticket.viewer.close'),
              previous: t('ticket.viewer.previous'),
              next: t('ticket.viewer.next'),
              counter: (n, total) => t('ticket.viewer.counter', { n, total }),
            },
            thread: t('ticket.threadLabel'),
          }}
          imageActions={(a) =>
            a.canDelete && !supportMode ? (
              <Button
                variant="destructive"
                onClick={() => {
                  setDeleteError(null)
                  setDeleting(a.id)
                }}
              >
                {t('ticket.deleteScreenshot')}
              </Button>
            ) : null
          }
        />
        <ConfirmDialog
          open={deleting !== null}
          title={t('ticket.deleteTitle')}
          body={t('ticket.deleteBody')}
          confirmLabel={t('ticket.deleteConfirm')}
          busy={deleteBusy}
          error={deleteError}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleting(null)}
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
          <div ref={replyRef} id="ticket-reply">
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
            attachments={
              <AttachmentPicker
                files={files}
                onChange={setFiles}
                max={TICKET_LIMITS.attachmentsMax}
                maxBytes={TICKET_LIMITS.attachmentBytesMax}
                accept={ATTACHMENT_MIME_TYPES}
                disabled={pending || ticket.reply === 'forbidden' || supportMode}
                labels={{
                  add: t('picker.add'),
                  hint: t('picker.hint', { max: TICKET_LIMITS.attachmentsMax, size: mb }),
                  remove: (name) => t('picker.remove', { name }),
                  problem: (p) => t(`picker.problem.${p.kind}`, { name: p.name, size: mb, max: TICKET_LIMITS.attachmentsMax }),
                }}
              />
            }
          />
          </div>
        )}
      </div>

      {/* Desktop: the recap panel beside the conversation. Phone: "Details" under it. */}
      <aside aria-label={t('recap.details')} className="space-y-4">
        <Panel className="hidden lg:block" highlighted={waiting}>
          <p className="text-sm leading-5 text-muted-foreground">{t('recap.status')}</p>
          <div className="mt-1.5">
            <TicketStatusPill status={ticket.status} />
          </div>
          <p className="mt-2 text-[0.9375rem] leading-6 font-medium">{sentence(ticket)}</p>
          {waiting && canReply ? (
            <Button variant="secondary" className="mt-3" onClick={goToReply}>
              {t('recap.goToReply')}
            </Button>
          ) : null}
        </Panel>
        <Panel>
          <h2 className="mb-1 text-[0.9375rem] leading-6 font-semibold lg:sr-only">{t('recap.details')}</h2>
          <dl>
            <FactRow label={t('recap.opened')}>
              <TicketTime iso={ticket.createdAt} />
              {ticket.createdBy.name ? <span className="block text-muted-foreground">{t('recap.by', { name: ticket.createdBy.name })}</span> : null}
            </FactRow>
            <div className="hidden lg:block">
              <FactRow label={t('recap.lastUpdate')}>
                <TicketTime iso={ticket.lastActivityAt} />
              </FactRow>
              <FactRow label={t('recap.reference')}>{ticket.reference}</FactRow>
            </div>
            {ticket.reportedFrom ? (
              <FactRow label={t('recap.reportedFrom')}>
                {ticket.reportedFrom.startsWith('/') ? (
                  <a href={ticket.reportedFrom} className="text-primary underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                    {ticket.reportedFrom}
                  </a>
                ) : (
                  ticket.reportedFrom
                )}
              </FactRow>
            ) : null}
            <FactRow label={t('recap.screenshots')}>{screenshots}</FactRow>
          </dl>
          <ButtonLink variant="secondary" className="mt-3" href={`/${projectSlug}/support/new`}>
            {t('ticket.openNew')}
          </ButtonLink>
        </Panel>
      </aside>
      </div>
    </>
  )
}
