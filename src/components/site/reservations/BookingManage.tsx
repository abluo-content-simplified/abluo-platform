'use client'

/**
 * ADR-044 D7, D11 — the booking page: reference, status, sessions, amount,
 * payment instructions, and (when the Booking rules allow) "Cancel my booking"
 * and a per-session "I can't come", each behind a confirmation step.
 *
 * All text comes in as `messages` (the website dictionary for the page
 * language); all rules were decided on the server (`view`). Actions return the
 * fresh view, which replaces the state. A single-session absence is shown at
 * once (optimistic) and rolled back if the server refuses.
 */
import { useEffect, useRef, useState, useTransition } from 'react'
import { FadeIn } from '@/components/animation/FadeIn'
import { fillSiteMessage, type ReservationSiteMessages } from '@/lib/reservations/website/messages'
import { absenceAction, cancelBookingAction } from '@/lib/reservations/website/actions'
import type { BookingView, ErrorKey, OutcomeKey } from '@/lib/reservations/website/types'
import { BODY, BTN_BASE, BTN_PRIMARY, BTN_SECONDARY, CARD, MUTED, NOTICE_ERROR, NOTICE_OK, STRONG } from './styles'

type Props = { tenant: string; locale: string; token: string; initial: BookingView; messages: ReservationSiteMessages }
type Confirm = { kind: 'cancel' } | { kind: 'absence'; id: string; dateLabel: string } | null

export function BookingManage({ tenant, locale, token, initial, messages: m }: Props) {
  const [view, setView] = useState<BookingView>(initial)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [error, setError] = useState<ErrorKey | null>(null)
  const [done, setDone] = useState<{ kind: 'cancel' | 'absence'; outcome: OutcomeKey } | null>(null)
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set())
  const [pending, startTransition] = useTransition()
  const keepRef = useRef<HTMLButtonElement>(null)
  const b = m.booking

  // Move focus into the confirmation so a keyboard or screen-reader user lands on it (the safe choice first).
  useEffect(() => { if (confirm) keepRef.current?.focus() }, [confirm])

  const base = { tenant, locale, token }

  function cancelBooking() {
    setError(null)
    startTransition(async () => {
      const r = await cancelBookingAction(base)
      if (r.ok) { setView(r.view); setDone({ kind: 'cancel', outcome: r.outcome ?? 'none' }); setConfirm(null) }
      else { setError(r.error); setConfirm(null) }
    })
  }

  function skipSession(id: string) {
    setError(null)
    setSkipped((s) => new Set(s).add(id)) // optimistic
    startTransition(async () => {
      const r = await absenceAction({ ...base, occurrenceId: id })
      if (r.ok) { setView(r.view); setDone({ kind: 'absence', outcome: r.outcome ?? 'none' }) }
      else setError(r.error)
      setSkipped((s) => { const n = new Set(s); n.delete(id); return n })
      setConfirm(null)
    })
  }

  const closed = view.status === 'cancelled' || view.status === 'expired'
  const rows = [
    [b.reference, <span key="r" className="font-mono tracking-wide">{view.reference}</span>],
    [b.status, b.statuses[view.status]],
    ...(view.amountLabel ? [[b.amount, view.amountLabel], [b.paymentLabel, b.payments[view.paymentStatus]]] : []),
  ] as Array<[string, React.ReactNode]>

  return (
    <FadeIn>
      <div className="mt-6 flex flex-col gap-8">
        <div aria-live="polite" className="flex flex-col gap-3">
          {done && <p role="status" className="m-0 px-4 py-3 text-sm leading-relaxed" style={NOTICE_OK}>{done.kind === 'cancel' ? b.cancel.done[done.outcome] : b.absence.done[done.outcome]}</p>}
          {error && <p role="alert" className="m-0 px-4 py-3 text-sm leading-relaxed" style={NOTICE_ERROR}>{m.errors[error]}</p>}
        </div>

        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-base" style={BODY}>
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt style={MUTED}>{k}</dt>
              <dd className="m-0" style={STRONG}>{v}</dd>
            </div>
          ))}
        </dl>

        {(view.paymentInstructions || view.bankDetails || view.payByLabel) && (
          <section aria-labelledby="pay-heading" className="flex flex-col gap-3 px-5 py-4" style={CARD}>
            <h2 id="pay-heading" className="m-0 text-lg font-semibold" style={{ ...STRONG, fontFamily: 'var(--font-heading)' }}>{b.paymentHeading}</h2>
            {view.payByLabel && <p className="m-0 text-base" style={STRONG}>{fillSiteMessage(b.payBy, { date: view.payByLabel })}</p>}
            {view.paymentInstructions && <p className="m-0 whitespace-pre-line text-base leading-relaxed" style={BODY}>{view.paymentInstructions}</p>}
            {view.bankDetails && (
              <>
                <h3 className="m-0 mt-2 text-sm font-semibold uppercase tracking-widest" style={MUTED}>{b.bankHeading}</h3>
                <p className="m-0 whitespace-pre-line font-mono text-sm leading-relaxed" style={STRONG}>{view.bankDetails}</p>
              </>
            )}
          </section>
        )}

        {view.isPass ? (
          <p className="m-0 text-base leading-relaxed" style={BODY}>{b.passNote}</p>
        ) : (
          <section aria-labelledby="sessions-heading" className="flex flex-col gap-3">
            <h2 id="sessions-heading" className="m-0 text-lg font-semibold" style={{ ...STRONG, fontFamily: 'var(--font-heading)' }}>{b.sessions}</h2>
            {view.sessions.length === 0 ? (
              <p className="m-0 text-base" style={BODY}>{b.noSessions}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {view.sessions.map((s) => {
                  const state = skipped.has(s.id) ? 'released' : s.state
                  const asking = confirm?.kind === 'absence' && confirm.id === s.id
                  return (
                    <li key={s.id} className="flex flex-col gap-3 px-5 py-4" style={CARD}>
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                        <div className="min-w-0">
                          {s.title && <p className="m-0 text-base font-medium" style={STRONG}>{s.title}</p>}
                          <p className="m-0 text-base" style={s.title ? BODY : STRONG}>{s.dateLabel} · {s.timeLabel}</p>
                          {s.place && <p className="m-0 text-sm" style={MUTED}>{s.place}</p>}
                        </div>
                        {state !== 'attending' && (
                          <span className="text-sm" style={MUTED}>
                            {state === 'cancelled' ? b.sessionCancelled : state === 'released' ? b.sessionReleased : b.sessionPast}
                          </span>
                        )}
                        {s.canAbsent && state === 'attending' && !asking && !closed && (
                          <button type="button" className={BTN_BASE} style={BTN_SECONDARY} disabled={pending} onClick={() => { setDone(null); setConfirm({ kind: 'absence', id: s.id, dateLabel: s.dateLabel }) }}>
                            {b.absence.button}
                          </button>
                        )}
                      </div>
                      {asking && confirm?.kind === 'absence' && (
                        <div role="group" aria-labelledby={`absence-${s.id}`} className="flex flex-col gap-3">
                          <p id={`absence-${s.id}`} className="m-0 text-base font-medium" style={STRONG}>{fillSiteMessage(b.absence.title, { date: confirm.dateLabel })}</p>
                          <div className="flex flex-wrap gap-3">
                            <button ref={keepRef} type="button" className={BTN_BASE} style={BTN_SECONDARY} disabled={pending} onClick={() => setConfirm(null)}>{b.absence.keep}</button>
                            <button type="button" className={BTN_BASE} style={BTN_PRIMARY} disabled={pending} onClick={() => skipSession(s.id)}>{pending ? b.absence.working : b.absence.confirm}</button>
                          </div>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}

        {view.cancel.allowed && !closed && (
          <section className="flex flex-col gap-3">
            {confirm?.kind === 'cancel' ? (
              <div role="group" aria-labelledby="cancel-title" className="flex flex-col gap-3 px-5 py-4" style={CARD}>
                <p id="cancel-title" className="m-0 text-lg font-semibold" style={{ ...STRONG, fontFamily: 'var(--font-heading)' }}>{b.cancel.title}</p>
                <p className="m-0 text-base" style={BODY}>{b.cancel.body}</p>
                <div className="flex flex-wrap gap-3">
                  <button ref={keepRef} type="button" className={BTN_BASE} style={BTN_SECONDARY} disabled={pending} onClick={() => setConfirm(null)}>{b.cancel.keep}</button>
                  <button type="button" className={BTN_BASE} style={BTN_PRIMARY} disabled={pending} onClick={cancelBooking}>{pending ? b.cancel.working : b.cancel.confirm}</button>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <button type="button" className={BTN_BASE} style={BTN_SECONDARY} disabled={pending} onClick={() => { setDone(null); setConfirm({ kind: 'cancel' }) }}>
                    {b.cancel.button}
                  </button>
                </div>
                {view.cancel.untilLabel && <p className="m-0 text-sm" style={MUTED}>{fillSiteMessage(b.cancel.until, { date: view.cancel.untilLabel })}</p>}
              </>
            )}
          </section>
        )}
      </div>
    </FadeIn>
  )
}
