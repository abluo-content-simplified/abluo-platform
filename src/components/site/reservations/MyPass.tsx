'use client'

/**
 * ADR-044 D9, D11 — My pass: how long the pass is valid, entries left, and
 * the upcoming classes it covers, each with Coming / Not coming.
 *
 * Which classes appear and which buttons are offered was decided on the server
 * (`view`: sign-up mode per class, sign-up window, full classes, entries). The
 * answer is shown at once (optimistic) and replaced by the server's view when
 * it comes back; if the server refuses, the row returns to what it was and the
 * reason is written under it.
 */
import { useState, useTransition } from 'react'
import { FadeIn } from '@/components/animation/FadeIn'
import { fillSiteMessage, type ReservationSiteMessages } from '@/lib/reservations/website/messages'
import { passAnswerAction } from '@/lib/reservations/website/actions'
import type { ErrorKey, PassSessionView, PassView } from '@/lib/reservations/website/types'
import { BODY, BTN_BASE, BTN_PRIMARY, BTN_SECONDARY, CARD, MUTED, NOTICE_ERROR, NOTICE_OK, STRONG } from './styles'

type Props = { tenant: string; locale: string; token: string; initial: PassView; messages: ReservationSiteMessages }
type Note = { id: string; tone: 'ok' | 'error'; text: string }

export function MyPass({ tenant, locale, token, initial, messages: m }: Props) {
  const [view, setView] = useState<PassView>(initial)
  const [guess, setGuess] = useState<Readonly<Record<string, boolean>>>({}) // optimistic answers by session id
  const [note, setNote] = useState<Note | null>(null)
  const [pending, startTransition] = useTransition()
  const p = m.pass

  function answer(s: PassSessionView, coming: boolean) {
    if (pending) return
    setNote(null)
    setGuess((g) => ({ ...g, [s.id]: coming }))
    startTransition(async () => {
      const r = await passAnswerAction({ tenant, locale, token, occurrenceId: s.id, coming })
      if (r.ok) {
        setView(r.view)
        setNote({ id: s.id, tone: 'ok', text: r.notice === 'entryReturned' ? p.entryReturned : r.notice === 'entryKept' ? p.entryKept : p.saved })
      } else {
        setNote({ id: s.id, tone: 'error', text: m.errors[r.error as ErrorKey] })
      }
      setGuess((g) => { const n = { ...g }; delete n[s.id]; return n })
    })
  }

  const inactive = view.status !== 'active'
  const reason = (s: PassSessionView): string | null =>
    s.blocked === 'full' ? p.full
      : s.blocked === 'no_entries' ? p.noEntries
        : s.blocked === 'closed' ? p.closed
          : s.blocked === 'not_open_yet' ? (s.opensLabel ? fillSiteMessage(p.opensOn, { date: s.opensLabel }) : m.errors.notOpenYet)
            : null

  return (
    <FadeIn>
      <div className="mt-6 flex flex-col gap-8">
        <div className="flex flex-col gap-1 text-base" style={BODY}>
          <p className="m-0" style={STRONG}>{fillSiteMessage(p.valid, { from: view.validFromLabel, to: view.validToLabel })}</p>
          <p className="m-0">{view.entriesLeft === null ? p.unlimited : fillSiteMessage(p.entriesLeft, { n: view.entriesLeft })}</p>
        </div>

        {inactive ? (
          <p role="status" className="m-0 px-4 py-3 text-base" style={NOTICE_OK}>
            {view.status === 'cancelled' ? p.statusCancelled : view.status === 'expired' ? p.statusExpired : fillSiteMessage(p.statusNotStarted, { from: view.validFromLabel })}
          </p>
        ) : (
          <section aria-labelledby="upcoming-heading" className="flex flex-col gap-3">
            <h2 id="upcoming-heading" className="m-0 text-lg font-semibold" style={{ ...STRONG, fontFamily: 'var(--font-heading)' }}>{p.upcoming}</h2>
            {view.sessions.length === 0 ? (
              <p className="m-0 text-base" style={BODY}>{p.none}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {view.sessions.map((s) => {
                  const attending = s.id in guess ? guess[s.id] : s.attending
                  const why = reason(s)
                  const whyId = `why-${s.id}`
                  const label = `${p.groupLabel} ${s.title ?? ''} ${s.dateLabel} ${s.timeLabel}`.replace(/\s+/g, ' ').trim()
                  return (
                    <li key={s.id} className="flex flex-col gap-3 px-5 py-4" style={CARD}>
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                        <div className="min-w-0">
                          {s.title && <p className="m-0 text-base font-medium" style={STRONG}>{s.title}</p>}
                          <p className="m-0 text-base" style={s.title ? BODY : STRONG}>{s.dateLabel} · {s.timeLabel}</p>
                          {s.place && <p className="m-0 text-sm" style={MUTED}>{s.place}</p>}
                        </div>
                        {s.cancelled && <span className="text-sm" style={MUTED}>{p.cancelledSession}</span>}
                      </div>

                      {!s.cancelled && s.mode === 'off' && <p className="m-0 text-sm" style={MUTED}>{p.comeAlong}</p>}

                      {!s.cancelled && s.mode === 'opt_in' && (
                        <div role="group" aria-label={label} className="flex flex-wrap gap-3">
                          <button
                            type="button"
                            className={BTN_BASE}
                            style={attending ? BTN_PRIMARY : BTN_SECONDARY}
                            aria-pressed={attending}
                            aria-describedby={why ? whyId : undefined}
                            disabled={pending || (!attending && !s.canCome)}
                            onClick={() => { if (!attending) answer(s, true) }}
                          >
                            {p.coming}
                          </button>
                          <button
                            type="button"
                            className={BTN_BASE}
                            style={!attending ? BTN_PRIMARY : BTN_SECONDARY}
                            aria-pressed={!attending}
                            disabled={pending || (attending && !s.canLeave)}
                            onClick={() => { if (attending) answer(s, false) }}
                          >
                            {p.notComing}
                          </button>
                        </div>
                      )}
                      {why && !attending && <p id={whyId} className="m-0 text-sm" style={MUTED}>{why}</p>}
                      {note?.id === s.id && (
                        <p role={note.tone === 'error' ? 'alert' : 'status'} className="m-0 px-4 py-2 text-sm" style={note.tone === 'error' ? NOTICE_ERROR : NOTICE_OK}>{note.text}</p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}
      </div>
    </FadeIn>
  )
}
