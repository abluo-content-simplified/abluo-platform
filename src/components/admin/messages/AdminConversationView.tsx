'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import {
  adminConversationActivityAction,
  deleteMessageFileAction,
  redactMessagePartsAction,
  replyAsAbluoAction,
  setArchivedAction,
} from '@/app/[locale]/(admin)/messages/message-actions'
import { useMessageThreadLabels } from '@/components/app/messages/thread-labels'
import { AttachmentPicker } from '@/components/app/ui/AttachmentPicker'
import { BackLink } from '@/components/app/ui/BackLink'
import { Button } from '@/components/app/ui/Button'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { FactRow } from '@/components/app/ui/FactRow'
import { MessageComposer } from '@/components/app/ui/MessageComposer'
import { MessageThread } from '@/components/app/ui/MessageThread'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Panel } from '@/components/app/ui/Panel'
import { useVisibleInterval } from '@/components/client/tickets/use-visible-interval'
import { TicketTime } from '@/components/client/tickets/ticket-bits'
import { RedactPartsDialog } from '@/components/admin/tickets/RedactPartsDialog'
import { fitScreenshots } from '@/lib/client/ticket-upload'
import { CLIENT_UPLOAD_BUDGET_BYTES } from '@/lib/support-tickets/client-form'
import type { ThreadEntry } from '@/lib/support-tickets/model'
import { DASHBOARD_LINK_TARGETS, MESSAGE_FILE_TYPES, MESSAGE_LIMITS, messageErrorKey, type ConversationDetail } from '@/lib/messages/model'
import { LinkChooser } from './LinkChooser'

type Msg = Extract<ThreadEntry, { kind: 'message' }>

/**
 * One conversation for Abluo (ADR-050): the thread, who it is with and when
 * each person last read it (D6), the reply box (files, dashboard links), and
 * Archive / Restore. Any admin may answer (team inbox, D1); the client sees
 * the author's first name ("Tom · Abluo").
 */
export function AdminConversationView({ conversation }: { conversation: ConversationDetail }) {
  const t = useTranslations('admin.messages')
  const tc = useTranslations('app.messages')
  const router = useRouter()
  const tNav = useTranslations('clientDashboard.nav')
  const { labels, supportName, formatEvent } = useMessageThreadLabels((id) => (tNav.has(id) ? tNav(id) : id))
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [links, setLinks] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [redactParts, setRedactParts] = useState<Msg | null>(null)
  const [redactError, setRedactError] = useState<string | null>(null)
  const [removeFile, setRemoveFile] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const mb = Math.round(MESSAGE_LIMITS.imageBytesMax / (1024 * 1024))
  const err = (r: { reason: string; field?: string }) => tc(`errors.${r.field ?? r.reason}`)

  const seen = useRef(conversation.lastActivityAt)
  seen.current = conversation.lastActivityAt
  useVisibleInterval(async () => {
    const latest = await adminConversationActivityAction(conversation.id)
    if (latest && latest !== seen.current) router.refresh()
  }, 20_000)

  const names = conversation.participants.map((p) => p.name || p.email || '').filter(Boolean)

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
      form.set('conversationId', conversation.id)
      form.set('body', text)
      form.set('links', JSON.stringify(links))
      for (const f of ready) form.append('files', f)
      const result = await replyAsAbluoAction(form)
      if (result.ok) {
        setText('')
        setFiles([])
        setLinks([])
        router.refresh()
      } else setError(tc(`errors.${messageErrorKey(result.reason, result.field)}`))
    } catch {
      setError(tc('errors.error'))
    }
    setPending(false)
  }

  async function toggleArchive() {
    setBusy(true)
    const r = await setArchivedAction(conversation.id, !conversation.archived).catch(() => ({ ok: false as const, reason: 'error' as const }))
    setBusy(false)
    if (r.ok) router.refresh()
    else setError(err(r))
  }

  async function redact(ranges: { start: number; end: number }[]) {
    if (!redactParts) return
    setBusy(true)
    setRedactError(null)
    const r = await redactMessagePartsAction(redactParts.id, ranges).catch(() => ({ ok: false as const, reason: 'error' as const }))
    setBusy(false)
    if (r.ok) {
      setRedactParts(null)
      router.refresh()
    } else setRedactError(err(r))
  }

  async function confirmRemoveFile() {
    if (!removeFile) return
    setBusy(true)
    setRemoveError(null)
    const r = await deleteMessageFileAction(removeFile).catch(() => ({ ok: false as const, reason: 'error' as const }))
    setBusy(false)
    if (r.ok) {
      setRemoveFile(null)
      router.refresh()
    } else setRemoveError(err(r))
  }

  return (
    <>
      <BackLink href="/messages" label={t('back')} />
      <div>
        <p className="text-sm leading-5 font-medium text-muted-foreground">{conversation.project?.name}</p>
        <PageHeader
          title={<span className="break-words">{conversation.subject}</span>}
          actions={
            <Button variant="secondary" disabled={busy} onClick={() => void toggleArchive()}>
              {conversation.archived ? t('restore') : t('archive')}
            </Button>
          }
        />
      </div>
      {conversation.archived ? <Notice>{t('archivedNotice')}</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,42rem)_20rem] lg:items-start lg:gap-10">
        <div className="min-w-0 space-y-5">
          <MessageThread
            entries={conversation.thread}
            labels={labels}
            supportName={supportName}
            formatEvent={formatEvent}
            actions={(entry) => (
              <Button
                variant="link"
                onClick={() => {
                  setRedactError(null)
                  setRedactParts(entry)
                }}
              >
                {t('redact')}
              </Button>
            )}
            imageActions={(a) => (
              <Button variant="destructive" onClick={() => setRemoveFile(a.id)}>
                {tc('deleteFile')}
              </Button>
            )}
            attachmentActions={(id, entry) => {
              const a = entry.attachments.find((x) => x.id === id)
              return a && a.mime === 'application/pdf' && !a.deleted ? (
                <Button variant="link" onClick={() => setRemoveFile(a.id)}>
                  {tc('deleteFile')}
                </Button>
              ) : null
            }}
          />
          <Panel>
            {conversation.mode === 'shared' ? <p className="mb-3 text-sm leading-5 text-muted-foreground">{t('replyShared', { names: names.join(', ') })}</p> : null}
            <MessageComposer
              value={text}
              onChange={setText}
              onSend={() => void send()}
              labels={{ label: t('replyLabel'), placeholder: t('replyPlaceholder'), send: conversation.mode === 'shared' ? t('sendToEveryone', { count: names.length }) : tc('send'), sending: tc('sending') }}
              maxLength={MESSAGE_LIMITS.bodyMax}
              remainingLabel={(count) => tc('remaining', { count })}
              pending={pending}
              error={error}
              attachments={
                <div className="flex flex-col gap-4">
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
                  <LinkChooser targets={DASHBOARD_LINK_TARGETS.map((l) => l.id)} value={links} onChange={setLinks} disabled={pending} />
                </div>
              }
            />
          </Panel>
        </div>

        <aside aria-label={t('details')} className="space-y-4">
          <Panel>
            <h2 className="mb-1 text-[0.9375rem] leading-6 font-semibold">{conversation.mode === 'shared' ? t('sharedWith', { count: names.length }) : t('with')}</h2>
            <dl>
              {conversation.receipts.map((r) => (
                <FactRow key={r.person.id ?? r.person.name} label={r.person.name || r.person.email || '—'}>
                  {r.readAt ? (
                    <>
                      {tc('seen')} · <TicketTime iso={r.readAt} />
                    </>
                  ) : (
                    tc('notSeenYet')
                  )}
                </FactRow>
              ))}
              <FactRow label={t('site')}>{conversation.project?.name}</FactRow>
              <FactRow label={t('started')}>
                <TicketTime iso={conversation.createdAt} />
              </FactRow>
            </dl>
          </Panel>
        </aside>
      </div>

      <RedactPartsDialog
        body={redactParts ? redactParts.body : null}
        busy={busy}
        error={redactError}
        onClose={() => setRedactParts(null)}
        onRemoveWhole={() => redactParts && void redact([{ start: 0, end: redactParts.body.length }])}
        onConfirm={(ranges) => void redact(ranges)}
      />
      <ConfirmDialog
        open={removeFile !== null}
        title={tc('deleteTitle')}
        body={t('deleteFileBody')}
        confirmLabel={tc('deleteConfirm')}
        busy={busy}
        error={removeError}
        onConfirm={() => void confirmRemoveFile()}
        onCancel={() => setRemoveFile(null)}
      />
    </>
  )
}
