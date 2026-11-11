'use client'

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import {
  addNoteAction,
  adminTicketActivityAction,
  deleteAttachmentAction,
  redactMessageAction,
  redactMessagePartsAction,
  replyAsSupportAction,
  setTicketSeverityAction,
  setTicketStatusAction,
  viewAsClientAction,
  type TicketActionResult,
} from '@/app/[locale]/(admin)/support/ticket-actions'
import { AttachmentPicker } from '@/components/app/ui/AttachmentPicker'
import { BackLink } from '@/components/app/ui/BackLink'
import { Button } from '@/components/app/ui/Button'
import { ScreenshotGrid } from '@/components/app/ui/ScreenshotGrid'
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
import { fitScreenshots } from '@/lib/client/ticket-upload'
import type { RedactionRange } from '@/lib/support-tickets/redaction'
import { eventLine } from '@/lib/support-tickets/admin-view'
import { CLIENT_UPLOAD_BUDGET_BYTES } from '@/lib/support-tickets/client-form'
import {
  ATTACHMENT_MIME_TYPES,
  TICKET_LIMITS,
  TICKET_SEVERITIES,
  TICKET_STATUSES,
  type ThreadEntry,
  type TicketAttachmentView,
  type TicketDetail,
  type TicketSeverity,
  type TicketStatus,
} from '@/lib/support-tickets/model'
import { RedactPartsDialog } from './RedactPartsDialog'
import { AdminLastUpdate, SEVERITY_TONE, STATUS_TONE, StatusPill } from './ticket-bits'
import { browserSummary } from '@/lib/support-tickets/ua-summary'
import { timeAgo } from '@/lib/client/home-cards'
import { useVisibleInterval } from './use-visible-interval'
import { Pill } from '@/components/app/ui/list/cells'
import { useDateLocale } from '@/lib/i18n/date-locale-context'

type MessageEntry = Extract<ThreadEntry, { kind: 'message' }>

/** A reply from Abluo this recent means the ticket email for "Waiting for User" is held back (service rule). */
const RECENT_REPLY_MS = 10 * 60 * 1000

const NARROW = '(max-width: 479px)'
function useNarrow(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(NARROW)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  )
}

/**
 * One ticket for the Abluo admin (ADR-039 D4–D8, D11, D16): the conversation
 * with internal notes (MessageThread), the composer with two explicit modes,
 * and the side panel (status, severity, project, requester, context,
 * screenshots). On phones the status and severity come first, then the
 * conversation and composer, and the details last; on computers they are a side panel. Every write goes
 * through ticket-actions.ts and then refreshes the page.
 *
 * Day to day (Tom, 2026-11-11): the number and title stay at the top and
 * shrink to one line once the page scrolls; on computers the side column is
 * as tall as the window and scrolls on its own while the conversation scrolls
 * with the page. A long thread shows the request and the latest messages with
 * "Show N earlier" between; the page opens at the newest message, and "Jump
 * to latest" appears while it is out of view. The browser is one line.
 */
export function AdminTicketView({ ticket, supportNotice }: { ticket: TicketDetail; supportNotice: 'unavailable' | 'failed' | null }) {
  const t = useTranslations('admin.supportTickets')
  const tRoles = useTranslations('app.roles')
  const dateLocale = useDateLocale()
  // Read receipt (Tom, 2026-11-10): under the newest Abluo reply, once the client side has opened the request since.
  const readWhen = (iso: string) =>
    new Intl.DateTimeFormat(dateLocale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
  const router = useRouter()
  const narrow = useNarrow()
  const { toast, show } = useUndo()

  const [mode, setMode] = useState<'reply' | 'note'>('reply')
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [pending, setPending] = useState(false)
  const [composeError, setComposeError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [redactParts, setRedactParts] = useState<MessageEntry | null>(null)
  const [redactError, setRedactError] = useState<string | null>(null)
  const [redact, setRedact] = useState<MessageEntry | null>(null)
  const [removeShot, setRemoveShot] = useState<{ id: string; n: number } | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [showUa, setShowUa] = useState(false)

  // Sticky header: compact once the full header has scrolled away.
  const headerSentinel = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    const el = headerSentinel.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Open at the newest message (Tom, 2026-11-11); "Jump to latest" while it is out of view.
  const endRef = useRef<HTMLDivElement>(null)
  const [atEnd, setAtEnd] = useState(true)
  useEffect(() => {
    const el = endRef.current
    if (!el) return
    if (el.getBoundingClientRect().top > window.innerHeight) el.scrollIntoView({ block: 'end' })
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setAtEnd(e.isIntersecting || e.boundingClientRect.top < 0), { threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Live updates: while the tab is visible, ask every 20 s whether the ticket changed and refresh
  // the server data when it did. router.refresh() keeps this component mounted, so the composer
  // (text, mode, chosen files) is never lost. `known` is the last activity time already shown.
  const known = useRef(ticket.lastActivityAt)
  useEffect(() => {
    known.current = ticket.lastActivityAt
  }, [ticket.lastActivityAt])
  useVisibleInterval(async () => {
    const latest = await adminTicketActivityAction(ticket.id)
    if (!latest || new Date(latest).getTime() === new Date(known.current).getTime()) return
    known.current = latest
    router.refresh()
  }, 20_000)

  const failure = (r: Extract<TicketActionResult, { ok: false }>) => (t.has(`errors.${r.reason}`) ? t(`errors.${r.reason}` as 'errors.error') : t('errors.error'))

  async function run(action: () => Promise<TicketActionResult>, done: string | null): Promise<boolean> {
    try {
      const r = await action()
      if (!r.ok) {
        show({ message: failure(r), tone: 'error' })
        return false
      }
      // Only a consequence the person cannot see on screen gets a message (a changed pill or a new line in the thread speaks for itself).
      if (done) show({ message: done, tone: 'status' })
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
      let r: TicketActionResult
      if (mode === 'reply') {
        const form = new FormData()
        form.set('ticketId', ticket.id)
        form.set('body', text)
        if (files.length) {
          const ready = await fitScreenshots(files, CLIENT_UPLOAD_BUDGET_BYTES)
          if (!ready) {
            setComposeError(t('errors.uploadTooLarge'))
            return
          }
          for (const f of ready) form.append('files', f)
        }
        r = await replyAsSupportAction(form)
      } else {
        r = await addNoteAction(ticket.id, text)
      }
      if (!r.ok) {
        setComposeError(failure(r))
        return
      }
      setText('')
      if (mode === 'reply') setFiles([])
      router.refresh()
    } catch {
      setComposeError(t('errors.error'))
    } finally {
      setPending(false)
    }
  }

  const modes: ComposerMode[] = [
    { id: 'reply', label: narrow ? t('composer.replyShort') : t('composer.reply'), sendLabel: t('composer.sendReply'), tone: 'reply', hint: t('composer.replyHint') },
    { id: 'note', label: narrow ? t('composer.noteShort') : t('composer.note'), sendLabel: t('composer.saveNote'), tone: 'note', hint: t('composer.noteHint') },
  ]

  const viewerLabels = {
    dialog: t('thread.viewer.dialog'),
    close: t('thread.viewer.close'),
    previous: t('thread.viewer.previous'),
    next: t('thread.viewer.next'),
    counter: (n: number, total: number) => t('thread.viewer.counter', { n, total }),
  }
  const labels: MessageThreadLabels = {
    support: t('thread.support'),
    redacted: t('thread.redacted'),
    internalNote: t('thread.internalNote'),
    screenshotDeleted: t('thread.screenshotDeleted'),
    openScreenshot: (n) => t('thread.openScreenshot', { n }),
    removedPart: t('thread.removedPart'),
    viewer: viewerLabels,
    thread: t('thread.label'),
  }
  const formatEvent = (e: Extract<ThreadEntry, { kind: 'event' }>) => {
    const line = eventLine(e.event, e.to)
    if (!line) return null
    const values = line.values
    if (line.key === 'statusChanged' && values) return t('events.statusChanged', { status: t(`status.${values.status as TicketStatus}`) })
    if (line.key === 'messageRedactedPartial' && values) return t('events.messageRedactedPartial', { count: Number(values.count) })
    if (line.key === 'severityChanged' && values) return t('events.severityChanged', { severity: t(`severity.${values.severity as TicketSeverity}`) })
    return t(`events.${line.key}` as 'events.reopenedByReply')
  }

  const screenshots: Array<TicketAttachmentView & { n: number }> = []
  for (const e of ticket.thread) if (e.kind === 'message') for (const a of e.attachments) screenshots.push({ ...a, n: screenshots.length + 1 })

  const ctx = ticket.context ?? {}
  const roleLabel = ctx.role ? (tRoles.has(ctx.role as 'owner') ? tRoles(ctx.role as 'owner') : ctx.role) : null
  const status = ticket.status
  const name = ticket.createdBy.name?.trim().split(/\s+/)[0] || t('toast.theClient')
  const lastSupportReply = [...ticket.thread].reverse().find((e) => e.kind === 'message' && e.authorKind === 'support')
  const repliedJustNow = () => (lastSupportReply ? Date.now() - new Date(lastSupportReply.createdAt).getTime() < RECENT_REPLY_MS : false)
  const statusToast = (next: TicketStatus): string | null =>
    next === 'resolved'
      ? t('toast.resolved', { name })
      : next === 'waiting_for_user'
        ? t(repliedJustNow() ? 'toast.waitingNoEmail' : 'toast.waiting', { name })
        : null
  const severity = ticket.severity ?? 'normal'

  // Fold the middle of a long thread (Tom, 2026-11-11): the request itself, "Show N earlier", the latest few.
  const FOLD_KEEP = 4
  const foldable = !showAll && ticket.thread.length > FOLD_KEEP + 3
  const head = foldable ? ticket.thread.slice(0, 1) : ticket.thread
  const tail = foldable ? ticket.thread.slice(-FOLD_KEEP) : []
  const hidden = foldable ? ticket.thread.length - 1 - FOLD_KEEP : 0
  const threadProps = {
    labels,
    formatEvent,
    actions: (entry: MessageEntry) => (
      <>
        {entry.id === lastSupportReply?.id && ticket.clientRead && Date.parse(ticket.clientRead.at) >= Date.parse(entry.createdAt) ? (
          <span className="inline-flex min-h-11 items-center" suppressHydrationWarning>
            <Pill tone="success">
              {ticket.clientRead.name
                ? t('readReceipt.by', { name: ticket.clientRead.name, when: readWhen(ticket.clientRead.at) })
                : t('readReceipt.read', { when: readWhen(ticket.clientRead.at) })}
            </Pill>
          </span>
        ) : null}
        {entry.redacted ? null : (
          <Button
            variant="link"
            onClick={() => {
              setRedactError(null)
              setRedactParts(entry)
            }}
          >
            {t('redactParts.action')}
          </Button>
        )}
      </>
    ),
    imageActions: (a: TicketAttachmentView) => (
      <Button variant="destructive" onClick={() => setRemoveShot({ id: a.id, n: 0 })}>
        {t('panel.deleteScreenshot')}
      </Button>
    ),
  }
  const next = ticket.next
  const browser = browserSummary(ctx.userAgent, ctx.viewport)

  return (
    <div className="space-y-4">
      <BackLink href="/support" label={t('back')} />
      <div ref={headerSentinel} aria-hidden="true" className="h-0" />
      {/* Sticky header (Tom, 2026-11-11): number and title stay in view and shrink to one line once the page scrolls. */}
      <div
        className={`sticky top-14 z-20 -mx-4 bg-background px-4 transition-[padding,box-shadow] duration-200 motion-reduce:transition-none md:top-0 md:-mx-6 md:px-6 ${
          compact ? 'border-b border-border-subtle py-2' : 'py-0'
        }`}
      >
        {compact ? (
          <div className="flex min-w-0 items-center gap-3">
            <span className="shrink-0 font-mono text-sm leading-6 font-medium text-muted-foreground">{ticket.reference}</span>
            <p className="min-w-0 flex-1 truncate text-[0.9375rem] leading-6 font-semibold text-foreground" title={ticket.title}>
              {ticket.title}
            </p>
            <span className="hidden shrink-0 sm:inline-flex">
              <StatusPill status={status} />
            </span>
          </div>
        ) : (
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
        )}
      </div>
      {supportNotice ? <Notice tone="error">{t(`support.${supportNotice}`)}</Notice> : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        {/*
          Right column (computers): as tall as the window under the sticky header, scrolling inside
          itself, while the conversation scrolls with the page. Phones: `contents`, so status comes
          first, then the conversation, then the details.
        */}
        <div className="contents lg:sticky lg:top-16 lg:col-start-2 lg:row-start-1 lg:flex lg:max-h-[calc(100dvh-5rem)] lg:flex-col lg:gap-4 lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
          <Panel as="section" aria-labelledby="tk-status" className="order-1 lg:order-none">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col items-start gap-2">
                <SectionHeading id="tk-status" title={t('panel.status')} />
                <PillSelect<TicketStatus>
                  size="lg"
                  label={t('panel.status')}
                  value={status}
                  options={TICKET_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`), tone: STATUS_TONE[s] }))}
                  onChange={(nextStatus) => void run(() => setTicketStatusAction(ticket.id, nextStatus), nextStatus === status ? null : statusToast(nextStatus))}
                />
                {next && next.kind !== 'done' ? (
                  <p className="text-sm leading-5 text-muted-foreground" suppressHydrationWarning>
                    {next.kind === 'yourTurn' ? t('next.yourTurn') : next.on ? t('next.waitingFor', { name: next.on }) : t('next.waitingForClient')} · {timeAgo(next.since, dateLocale)}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col items-start gap-2">
                <h3 className="text-[1.0625rem] leading-6 font-semibold">{t('panel.severity')}</h3>
                <PillSelect<TicketSeverity>
                  size="lg"
                  label={t('panel.severity')}
                  value={severity}
                  options={TICKET_SEVERITIES.map((s) => ({ value: s, label: t(`severity.${s}`), tone: SEVERITY_TONE[s] }))}
                  onChange={(nextSeverity) => void run(() => setTicketSeverityAction(ticket.id, nextSeverity), null)}
                />
                <p className="text-sm leading-5 text-muted-foreground">{t('panel.severityHint')}</p>
              </div>
            </div>
          </Panel>

          <aside aria-label={t('panel.label')} className="order-3 flex flex-col gap-4 lg:order-none">
            <Panel as="section" aria-labelledby="tk-who">
              <SectionHeading id="tk-who" title={t('panel.people')} />
              <dl>
                <FactRow label={t('panel.project')}>{ticket.project?.name || '—'}</FactRow>
                <FactRow label={t('panel.requester')}>{ticket.createdBy.name || '—'}</FactRow>
                <FactRow label={t('panel.email')}>{ticket.createdBy.email ? <span className="break-all">{ticket.createdBy.email}</span> : '—'}</FactRow>
                {roleLabel ? <FactRow label={t('panel.role')}>{roleLabel}</FactRow> : null}
                <FactRow label={t('panel.opened')}>
                  <AdminLastUpdate iso={ticket.createdAt} />
                </FactRow>
                <FactRow label={t('panel.lastUpdate')}>
                  <AdminLastUpdate iso={ticket.lastActivityAt} />
                </FactRow>
              </dl>
            </Panel>

            <Panel as="section" aria-labelledby="tk-shots">
              <SectionHeading id="tk-shots" title={t('panel.screenshots')} />
              {screenshots.length === 0 ? (
                <p className="text-sm leading-5 text-muted-foreground">{t('panel.noScreenshots')}</p>
              ) : (
                <ScreenshotGrid
                  images={screenshots}
                  labels={{
                    open: (n) => t('panel.openScreenshot', { n }),
                    deleted: (reason) => (reason ? t(`panel.deleted.${reason as 'redacted'}`) : t('thread.screenshotDeleted')),
                    viewer: viewerLabels,
                  }}
                  actions={(a) => (
                    <Button variant="destructive" onClick={() => setRemoveShot({ id: a.id, n: 0 })}>
                      {t('panel.deleteScreenshot')}
                    </Button>
                  )}
                />
              )}
            </Panel>

            <Panel as="section" aria-labelledby="tk-context">
              <SectionHeading id="tk-context" title={t('panel.context')} />
              <dl>
                <ContextFact label={t('panel.page')} value={ctx.page} />
                <ContextFact label={t('panel.language')} value={ctx.interfaceLocale} />
                <ContextFact label={t('panel.version')} value={ctx.platformVersion} />
                {ctx.relatedTo ? <ContextFact label={t('panel.related')} value={ctx.relatedTo} /> : null}
                {/* Browser (Tom, 2026-11-11): one line; the full string one click away. */}
                <FactRow label={t('panel.browser')}>
                  {ctx.userAgent || ctx.viewport ? (
                    <span className="flex flex-col items-start gap-1">
                      <span className="break-words">{browser || ctx.viewport || '—'}</span>
                      {ctx.userAgent ? (
                        <Button variant="link" aria-expanded={showUa} aria-controls="tk-ua" onClick={() => setShowUa((v) => !v)}>
                          {showUa ? t('panel.hideDetails') : t('panel.showDetails')}
                        </Button>
                      ) : null}
                      {showUa ? (
                        <span id="tk-ua" className="font-mono text-xs leading-5 break-all text-muted-foreground">
                          {ctx.userAgent}
                          {ctx.viewport ? ` · ${ctx.viewport}` : ''}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    '—'
                  )}
                </FactRow>
              </dl>
            </Panel>
          </aside>
        </div>

        <div className="order-2 flex min-w-0 flex-col gap-6 lg:order-none lg:col-start-1 lg:row-start-1">
          <MessageThread entries={head} {...threadProps} />
          {foldable ? (
            <>
              <div className="flex justify-center">
                <Button variant="secondary" onClick={() => setShowAll(true)}>
                  {t('thread.showEarlier', { count: hidden })}
                </Button>
              </div>
              <MessageThread entries={tail} {...threadProps} />
            </>
          ) : null}
          <div ref={endRef} aria-hidden="true" className="h-0 scroll-mb-6" />
          {!atEnd ? (
            <div className="pointer-events-none sticky bottom-[calc(6rem+env(safe-area-inset-bottom))] z-10 flex justify-center md:bottom-6">
              <Button variant="secondary" className="pointer-events-auto shadow-[var(--shadow-raise)]" onClick={() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })}>
                {t('thread.jumpToLatest')}
              </Button>
            </div>
          ) : null}
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
              attachments={
                mode === 'reply' ? (
                  <AttachmentPicker
                    acceptPaste
                    files={files}
                    onChange={setFiles}
                    max={TICKET_LIMITS.attachmentsMax}
                    maxBytes={TICKET_LIMITS.attachmentBytesMax}
                    accept={ATTACHMENT_MIME_TYPES}
                    disabled={pending}
                    labels={{
                      add: t('picker.add'),
                      hint: t('picker.hint', { max: TICKET_LIMITS.attachmentsMax, size: Math.round(TICKET_LIMITS.attachmentBytesMax / 1048576) }),
                      remove: (n) => t('picker.remove', { name: n }),
                      problem: (p) => t(`picker.problem.${p.kind}`, { name: p.name, size: Math.round(TICKET_LIMITS.attachmentBytesMax / 1048576), max: TICKET_LIMITS.attachmentsMax }),
                    }}
                  />
                ) : null
              }
            />
          </Panel>
        </div>
      </div>

      <RedactPartsDialog
        body={redactParts && !redact ? redactParts.body : null}
        busy={busy}
        error={redactError}
        onClose={() => setRedactParts(null)}
        onRemoveWhole={() => {
          setRedact(redactParts)
        }}
        onConfirm={async (ranges: RedactionRange[]) => {
          if (!redactParts) return
          setBusy(true)
          setRedactError(null)
          try {
            const r = await redactMessagePartsAction(ticket.id, redactParts.id, ranges)
            if (!r.ok) setRedactError(failure(r))
            else {
              show({ message: t('toast.partsHidden'), tone: 'status' })
              setRedactParts(null)
              router.refresh()
            }
          } catch {
            setRedactError(t('errors.error'))
          } finally {
            setBusy(false)
          }
        }}
      />
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
          setRedactParts(null)
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
