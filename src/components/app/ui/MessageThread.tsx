'use client'

import type { ReactNode } from 'react'
import { useLocale } from 'next-intl'
import { Avatar } from './Avatar'
import type { ThreadEntry } from '@/lib/support-tickets/model'

/**
 * A conversation, oldest first: the messages both sides wrote, the screenshots
 * attached to them, and small system lines for what happened to the
 * conversation (status changed, reopened …). Used by the client's request page
 * and the admin's ticket page.
 *
 *   • message — author, local time, text with its line breaks, screenshot
 *     thumbnails that open the full image in a new tab (their signed link).
 *     A support message shows `labels.support` instead of a name; a deleted
 *     screenshot shows `labels.screenshotDeleted`.
 *   • redacted message — only `labels.redacted`.
 *   • note — a different tint, dashed, and `labels.internalNote`. Pass notes
 *     ONLY on the admin side; this component cannot tell who is looking.
 *   • event — one quiet line; the words come from `formatEvent` (return null
 *     to hide an event).
 *
 * `actions` renders per-message controls (the admin's "Remove text" / "Delete
 * screenshot"). Times are shown in the viewer's time zone. No user-facing text
 * lives here: everything arrives through `labels` and `formatEvent`.
 */
export type MessageThreadLabels = {
  /** Name shown for every message written by Abluo's team. */
  support: string
  redacted: string
  internalNote: string
  screenshotDeleted: string
  /** Accessible name of a screenshot link, e.g. "Open screenshot 2 (new tab)". */
  openScreenshot: (n: number) => string
  /** Accessible name of the whole list. */
  thread: string
}

type EventEntry = Extract<ThreadEntry, { kind: 'event' }>

export function MessageThread({
  entries,
  labels,
  formatEvent,
  actions,
  attachmentActions,
}: {
  entries: ThreadEntry[]
  labels: MessageThreadLabels
  formatEvent: (event: EventEntry) => string | null
  /** Controls under a message (admin: remove text). */
  actions?: (entry: Extract<ThreadEntry, { kind: 'message' }>) => ReactNode
  /** Controls under one screenshot (admin: delete screenshot). */
  attachmentActions?: (attachmentId: string, entry: Extract<ThreadEntry, { kind: 'message' }>) => ReactNode
}) {
  const locale = useLocale()
  const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const time = (iso: string) => (
    <time dateTime={iso} suppressHydrationWarning className="text-xs leading-5 text-muted-foreground">
      {fmt.format(new Date(iso))}
    </time>
  )

  return (
    <ol aria-label={labels.thread} className="flex flex-col gap-3">
      {entries.map((entry) => {
        if (entry.kind === 'event') {
          const text = formatEvent(entry)
          if (!text) return null
          return (
            <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 px-1 text-sm leading-5 text-muted-foreground">
              <span>{text}</span>
              {time(entry.createdAt)}
            </li>
          )
        }

        if (entry.kind === 'note') {
          return (
            <li key={entry.id} className="rounded-xl border border-dashed border-border bg-accent px-4 py-3 text-accent-foreground">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-semibold">{entry.author.name}</span>
                {time(entry.createdAt)}
              </div>
              <p className="mt-1 text-sm font-medium">{labels.internalNote}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-[0.9375rem] leading-6">{entry.body}</p>
            </li>
          )
        }

        const fromSupport = entry.authorKind === 'support'
        const name = fromSupport ? labels.support : entry.author.name
        return (
          <li key={entry.id} className={`rounded-xl border border-border px-4 py-3 ${fromSupport ? 'bg-muted' : 'bg-card'}`}>
            <div className="flex items-start gap-3">
              {fromSupport ? null : <Avatar name={entry.author.name} email={entry.author.email ?? ''} src={entry.author.avatarUrl} size="sm" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-semibold text-foreground">{name}</span>
                  {time(entry.createdAt)}
                </div>
                {entry.redacted ? (
                  <p className="mt-1 text-[0.9375rem] leading-6 text-muted-foreground italic">{labels.redacted}</p>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap break-words text-[0.9375rem] leading-6 text-foreground">{entry.body}</p>
                )}
                {entry.attachments.length > 0 ? (
                  <ul className="mt-3 flex flex-wrap items-start gap-3">
                    {entry.attachments.map((a, i) => (
                      <li key={a.id} className="flex flex-col items-start gap-1">
                        {a.url ? (
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={labels.openScreenshot(i + 1)}
                            className="block size-24 overflow-hidden rounded-xl border border-border bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed link */}
                            <img src={a.url} alt="" loading="lazy" className="size-full object-cover" />
                          </a>
                        ) : (
                          <span className="flex size-24 items-start rounded-xl border border-dashed border-border p-2 text-xs leading-4 text-muted-foreground">
                            {labels.screenshotDeleted}
                          </span>
                        )}
                        {attachmentActions ? attachmentActions(a.id, entry) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {actions ? <div className="mt-2 flex flex-wrap items-start gap-2">{actions(entry)}</div> : null}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
