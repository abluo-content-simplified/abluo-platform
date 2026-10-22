'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import {
  addNoteAction,
  deleteAttachmentAction,
  redactMessageAction,
  replyAsSupportAction,
  setTicketSeverityAction,
  setTicketStatusAction,
  viewAsClientAction,
  type TicketActionResult,
} from '@/app/[locale]/(admin)/support/ticket-actions'
import { BackLink } from '@/components/app/ui/BackLink'
import { Button } from '@/components/app/ui/Button'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { FactRow } from '@/components/app/ui/FactRow'
import { MessageComposer, type ComposerMode } from '@/components/app/ui/MessageComposer'
import { MessageThread, type MessageThreadLabels } from '@/components/app/ui/MessageThread'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Panel } from '@/components/app/ui/Panel'
import { PillSelect } from '@/components/app/ui/PillSelect'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { LocalDate } from '@/components/app/ui/list/cells'
import { eventLine } from '@/lib/support-tickets/admin-view'
import {
  TICKET_LIMITS,
  TICKET_SEVERITIES,
  TICKET_STATUSES,
  type ThreadEntry,
  type TicketAttachmentView,
  type TicketDetail,
  type TicketSeverity,
  type TicketStatus,
} from '@/lib/support-tickets/model'
import { SEVERITY_TONE, STATUS_TONE } from './ticket-bits'

type MessageEntry = Extract<ThreadEntry, { kind: 'message' }>

/**
 * One ticket for the Abluo admin (ADR-039 D4–D8, D11, D16): the conversation
 * with internal notes (MessageThread), the composer with two explicit modes,
 * and the side panel (status, severity, project, requester, context,
 * screenshots). On phones the panel sits below the thread. Every write goes
 * through ticket-actions.ts and then refreshes the page.
 */
export function AdminTicketView({ ticket, supportNotice }: { ticket: TicketDetail; supportNotice: 'unavailable' | 'failed' | null }) {
  const t = useTranslations('admin.supportTickets')
  const tRoles = useTranslations('app.roles')
  const router = useRouter()
  const { toast, show } = useUndo()

  const [mode, setMode] = useState<'reply' | 'note'>('reply')
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [composeError, setComposeError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [redact, setRedact] = useState<MessageEntry | null>(null)
  const [removeShot, setRemoveShot] = useState<{ id: string; n: number } | null>(null)

  const failure = (r: Extract<TicketActionResult, { ok: false }>) => (t.has(`errors.${r.reason}`) ? t(`errors.${r.reason}` as 'errors.error') : t('errors.error'))

  async function run(action: () => Promise<TicketActionResult>, done: string): Promise<boolean> {
    try {
      const r = await action()
      if (!r.ok) {
        show({ message: failure(r), tone: 'error' })
        return false
      }
      show({ message: done, tone: 'status' })
      router.refresh()
      return true
    } catch {
      show({ message: t('errors.error'), tone: 'error' })
      return false
    }
  }

  async function send() {
    if (pending) return
    setPending(true)
    setComposeError(null)
    try {
      const r = mode === 'reply' ? await replyAsSupportAction(ticket.id, text) : await addNoteAction(ticket.id, text)
      if (!r.ok) {
        setComposeError(failure(r))
        return
      }
      setText('')
      show({ message: mode === 'reply' ? t('toast.replySent') : t('toast.noteSaved'), tone: 'status' })
      router.refresh()
    } catch {
      setComposeError(t('errors.error'))
    } finally {
      setPending(false)
    }
  }

  const modes: ComposerMode[] = [
    { id: 'reply', label: t('composer.reply'), sendLabel: t('composer.sendReply'), tone: 'reply', hint: t('composer.replyHint') },
    { id: 'note', label: t('composer.note'), sendLabel: t('composer.saveNote'), tone: 'note', hint: t('composer.noteHint') },
  ]

  const labels: MessageThreadLabels = {
    support: t('thread.support'),
    redacted: t('thread.redacted'),
    internalNote: t('thread.internalNote'),
    screenshotDeleted: t('thread.screenshotDeleted'),
    openScreenshot: (n) => t('thread.openScreenshot', { n }),
    thread: t('thread.label'),
  }
  const formatEvent = (e: Extract<ThreadEntry, { kind: 'event' }>) => {
    const line = eventLine(e.event, e.to)
    if (!line) return null
    const values = line.values
    if (line.key === 'statusChanged' && values) return t('events.statusChanged', { status: t(`status.${values.status as TicketStatus}`) })
    if (line.key === 'severityChanged' && values) return t('events.severityChanged', { severity: t(`severity.${values.severity as TicketSeverity}`) })
    return t(`events.${line.key}` as 'events.reopenedByReply')
  }

  const screenshots: Array<TicketAttachmentView & { n: number }> = []
  for (const e of ticket.thread) if (e.kind === 'message') for (const a of e.attachments) screenshots.push({ ...a, n: screenshots.length + 1 })

  const ctx = ticket.context ?? {}
  const roleLabel = ctx.role ? (tRoles.has(ctx.role as 'owner') ? tRoles(ctx.role as 'owner') : ctx.role) : null
  const status = ticket.status
  const severity = ticket.severity ?? 'normal'

  return (
    <div className="space-y-4">
      <BackLink href="/support" label={t('back')} />
      <PageHeader
        title={
          <span className="flex flex-col gap-0.5">
            <span className="font-mono text-sm leading-5 font-medium text-muted-foreground">{ticket.reference}</span>
            <span className="break-words">{ticket.title}</span>
          </span>
        }
        actions={
          <form action={viewAsClientAction}>
            <input type="hidden" name="ticketId" value={ticket.id} />
            <Button type="submit" variant="secondary">
              {t('viewAsClient')}
            </Button>
          </form>
        }
      />
      {supportNotice ? <Notice tone="error">{t(`support.${supportNotice}`)}</Notice> : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <MessageThread
            entries={ticket.thread}
            labels={labels}
            formatEvent={formatEvent}
            actions={(entry) =>
              entry.redacted ? null : (
                <Button variant="link" onClick={() => setRedact(entry)}>
                  {t('redact.action')}
                </Button>
              )
            }
          />
          <Panel tone={mode === 'note' ? 'muted' : 'card'}>
            <MessageComposer
              value={text}
              onChange={setText}
              onSend={() => void send()}
              labels={{ placeholder: mode === 'note' ? t('composer.notePlaceholder') : t('composer.replyPlaceholder'), label: mode === 'note' ? t('composer.note') : t('composer.reply'), send: t('composer.sendReply'), sending: t('composer.sending') }}
              maxLength={TICKET_LIMITS.bodyMax}
              remainingLabel={(count) => t('composer.remaining', { count })}
              pending={pending}
              error={composeError}
              modes={modes}
              mode={mode}
              onModeChange={(id) => {
                setMode(id === 'note' ? 'note' : 'reply')
                setComposeError(null)
              }}
              modeSwitchLabel={t('composer.modeLabel')}
            />
          </Panel>
        </div>

        <aside aria-label={t('panel.label')} className="flex flex-col gap-4">
          <Panel as="section" aria-labelledby="tk-status">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col items-start gap-2">
                <SectionHeading id="tk-status" title={t('panel.status')} />
                <PillSelect<TicketStatus>
                  size="lg"
                  label={t('panel.status')}
                  value={status}
                  options={TICKET_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`), tone: STATUS_TONE[s] }))}
                  onChange={(next) => void run(() => setTicketStatusAction(ticket.id, next), t('toast.statusSaved'))}
                />
              </div>
              <div className="flex flex-col items-start gap-2">
                <h3 className="text-[1.0625rem] leading-6 font-semibold">{t('panel.severity')}</h3>
                <PillSelect<TicketSeverity>
                  size="lg"
                  label={t('panel.severity')}
                  value={severity}
                  options={TICKET_SEVERITIES.map((s) => ({ value: s, label: t(`severity.${s}`), tone: SEVERITY_TONE[s] }))}
                  onChange={(next) => void run(() => setTicketSeverityAction(ticket.id, next), t('toast.severitySaved'))}
                />
                <p className="text-sm leading-5 text-muted-foreground">{t('panel.severityHint')}</p>
              </div>
            </div>
          </Panel>

          <Panel as="section" aria-labelledby="tk-who">
            <SectionHeading id="tk-who" title={t('panel.people')} />
            <dl>
              <FactRow label={t('panel.project')}>{ticket.project?.name || '—'}</FactRow>
              <FactRow label={t('panel.requester')}>{ticket.createdBy.name || '—'}</FactRow>
              <FactRow label={t('panel.email')}>{ticket.createdBy.email ? <span className="break-all">{ticket.createdBy.email}</span> : '—'}</FactRow>
              {roleLabel ? <FactRow label={t('panel.role')}>{roleLabel}</FactRow> : null}
              <FactRow label={t('panel.opened')}>
                <LocalDate iso={ticket.createdAt} />
              </FactRow>
            </dl>
          </Panel>

          <Panel as="section" aria-labelledby="tk-context">
            <SectionHeading id="tk-context" title={t('panel.context')} />
            <dl>
              <ContextFact label={t('panel.page')} value={ctx.page} />
              <ContextFact label={t('panel.version')} value={ctx.platformVersion} />
              <ContextFact label={t('panel.browser')} value={ctx.userAgent} />
              <ContextFact label={t('panel.screen')} value={ctx.viewport} />
              <ContextFact label={t('panel.language')} value={ctx.interfaceLocale} />
              <ContextFact label={t('panel.related')} value={ctx.relatedTo} />
            </dl>
          </Panel>

          <Panel as="section" aria-labelledby="tk-shots">
            <SectionHeading id="tk-shots" title={t('panel.screenshots')} />
            {screenshots.length === 0 ? (
              <p className="text-sm leading-5 text-muted-foreground">{t('panel.noScreenshots')}</p>
            ) : (
              <ul className="flex flex-col">
                {screenshots.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 border-b border-border py-2.5 text-[0.9375rem] last:border-b-0">
                    <span className="min-w-0">
                      {a.url ? (
                        <a href={a.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">
                          {t('panel.screenshot', { n: a.n })}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">{t('panel.screenshot', { n: a.n })}</span>
                      )}
                      <span className="block text-sm leading-5 text-muted-foreground">
                        {a.deleted ? t(`panel.deleted.${a.deleted}` as 'panel.deleted.redacted') : `${Math.max(1, Math.round(a.bytes / 1024))} KB`}
                      </span>
                    </span>
                    {a.deleted ? null : (
                      <Button variant="destructive" onClick={() => setRemoveShot({ id: a.id, n: a.n })}>
                        {t('panel.deleteScreenshot')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </div>

      <ConfirmDialog
        open={redact !== null}
        title={t('redact.title')}
        body={t('redact.body')}
        confirmLabel={t('redact.confirm')}
        busy={busy}
        onConfirm={async () => {
          if (!redact) return
          setBusy(true)
          await run(() => redactMessageAction(ticket.id, redact.id), t('toast.textRemoved'))
          setBusy(false)
          setRedact(null)
        }}
        onCancel={() => setRedact(null)}
      />
      <ConfirmDialog
        open={removeShot !== null}
        title={t('panel.deleteTitle')}
        body={t('panel.deleteBody')}
        confirmLabel={t('panel.deleteScreenshot')}
        busy={busy}
        onConfirm={async () => {
          if (!removeShot) return
          setBusy(true)
          await run(() => deleteAttachmentAction(ticket.id, removeShot.id), t('toast.screenshotDeleted'))
          setBusy(false)
          setRemoveShot(null)
        }}
        onCancel={() => setRemoveShot(null)}
      />
      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </div>
  )
}

function ContextFact({ label, value }: { label: string; value: ReactNode }) {
  return <FactRow label={label}>{value ? <span className="break-words">{value}</span> : '—'}</FactRow>
}
