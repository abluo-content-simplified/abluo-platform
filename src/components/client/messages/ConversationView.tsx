'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import {
  clientConversationActivityAction,
  deleteOwnMessageFileAction,
  replyToConversationAction,
} from '@/app/[locale]/(client)/[tenant]/messages/message-actions'
import { useMessageThreadLabels } from '@/components/app/messages/thread-labels'
import { AttachmentPicker } from '@/components/app/ui/AttachmentPicker'
import { BackLink } from '@/components/app/ui/BackLink'
import { Button } from '@/components/app/ui/Button'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { MessageComposer } from '@/components/app/ui/MessageComposer'
import { MessageThread } from '@/components/app/ui/MessageThread'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { useVisibleInterval } from '@/components/client/tickets/use-visible-interval'
import { TicketTime } from '@/components/client/tickets/ticket-bits'
import { fitScreenshots } from '@/lib/client/ticket-upload'
import { CLIENT_UPLOAD_BUDGET_BYTES } from '@/lib/support-tickets/client-form'
import { MESSAGE_FILE_TYPES, MESSAGE_LIMITS, messageErrorKey, type ConversationDetail } from '@/lib/messages/model'

/**
 * One conversation as its client participant sees it (ADR-050): the thread,
 * "Seen" under their last message once Abluo read it (D6), and the reply box
 * — always open for a participant (D2). In a shared conversation the reply box
 * says who will read the reply (D3).
 */
export function ConversationView({ conversation, projectSlug }: { conversation: ConversationDetail; projectSlug: string }) {
  const t = useTranslations('clientDashboard.messages')
  const tc = useTranslations('app.messages')
  const router = useRouter()
  const tNav = useTranslations('clientDashboard.nav')
  const { labels, supportName, formatEvent } = useMessageThreadLabels((id) => (tNav.has(id) ? tNav(id) : id))
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const mb = Math.round(MESSAGE_LIMITS.imageBytesMax / (1024 * 1024))

  const seen = useRef(conversation.lastActivityAt)
  seen.current = conversation.lastActivityAt
  useVisibleInterval(async () => {
    const latest = await clientConversationActivityAction(projectSlug, conversation.id)
    if (latest && latest !== seen.current) router.refresh()
  }, 20_000)

  const last = conversation.thread[conversation.thread.length - 1]
  const lastIsMine = last?.kind === 'message' && last.authorKind === 'client'
  const seenAt = conversation.receipts[0]?.readAt ?? null
  const others = conversation.participants.map((p) => p.name).filter(Boolean)

  async function send() {
    if (pending || !text.trim()) return
    setPending(true)
    setError(null)
    try {
      const ready = await fitScreenshots(files, CLIENT_UPLOAD_BUDGET_BYTES)
      if (!ready) {
        setError(tc('errors.uploadTooLarge'))
        setPending(false)
        return
      }
      const form = new FormData()
      form.set('body', text)
      for (const f of ready) form.append('files', f)
      const result = await replyToConversationAction(projectSlug, conversation.id, form)
      if (result.ok) {
        setText('')
        setFiles([])
        router.refresh()
      } else setError(tc(`errors.${messageErrorKey(result.reason, result.field)}`))
    } catch {
      setError(tc('errors.error'))
    }
    setPending(false)
  }

  async function confirmDelete() {
    if (!deleting || deleteBusy) return
    setDeleteBusy(true)
    setDeleteError(null)
    const result = await deleteOwnMessageFileAction(projectSlug, deleting).catch(() => ({ ok: false as const, reason: 'error' as const }))
    if (result.ok) {
      setDeleting(null)
      router.refresh()
    } else setDeleteError(tc(`errors.${result.reason}`))
    setDeleteBusy(false)
  }

  return (
    <>
      <BackLink href={`/${projectSlug}/messages`} label={t('back')} />
      <PageHeader title={<span className="break-words">{conversation.subject}</span>} />
      {conversation.mode === 'shared' ? <Notice>{t('sharedWith', { names: others.join(', ') })}</Notice> : null}
      <div className="max-w-[42rem] space-y-5">
        <MessageThread
          entries={conversation.thread}
          labels={labels}
          supportName={supportName}
          formatEvent={formatEvent}
          imageActions={(a) =>
            a.canDelete ? (
              <Button variant="destructive" onClick={() => setDeleting(a.id)}>
                {tc('deleteFile')}
              </Button>
            ) : null
          }
          attachmentActions={(id, entry) => {
            const a = entry.attachments.find((x) => x.id === id)
            return a?.canDelete && a.mime === 'application/pdf' ? (
              <Button variant="link" onClick={() => setDeleting(a.id)}>
                {tc('deleteFile')}
              </Button>
            ) : null
          }}
        />
        {lastIsMine ? (
          <p className="text-sm leading-5 text-muted-foreground">
            {seenAt ? (
              <>
                {tc('seen')} · <TicketTime iso={seenAt} />
              </>
            ) : (
              tc('notSeenYet')
            )}
          </p>
        ) : null}
        <ConfirmDialog
          open={deleting !== null}
          title={tc('deleteTitle')}
          body={tc('deleteBody')}
          confirmLabel={tc('deleteConfirm')}
          busy={deleteBusy}
          error={deleteError}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleting(null)}
        />
        <MessageComposer
          value={text}
          onChange={setText}
          onSend={() => void send()}
          labels={{
            label: conversation.mode === 'shared' ? t('replyShared', { names: [...others, 'Abluo'].join(', ') }) : t('replyLabel'),
            placeholder: t('replyPlaceholder'),
            send: tc('send'),
            sending: tc('sending'),
          }}
          maxLength={MESSAGE_LIMITS.bodyMax}
          remainingLabel={(count) => tc('remaining', { count })}
          pending={pending}
          error={error}
          attachments={
            <AttachmentPicker
              acceptPaste
              files={files}
              onChange={setFiles}
              max={MESSAGE_LIMITS.attachmentsMax}
              maxBytes={MESSAGE_LIMITS.imageBytesMax}
              accept={MESSAGE_FILE_TYPES}
              disabled={pending}
              labels={{
                add: tc('picker.add'),
                hint: tc('picker.hint', { max: MESSAGE_LIMITS.attachmentsMax, size: mb }),
                remove: (name) => tc('picker.remove', { name }),
                problem: (p) => tc(`picker.problem.${p.kind}`, { name: p.name, size: mb, max: MESSAGE_LIMITS.attachmentsMax }),
              }}
            />
          }
        />
      </div>
    </>
  )
}
