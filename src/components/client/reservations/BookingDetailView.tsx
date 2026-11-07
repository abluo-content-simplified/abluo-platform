'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { BackLink } from '@/components/app/ui/BackLink'
import { Button } from '@/components/app/ui/Button'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { DateInput } from '@/components/app/ui/DateInput'
import { FactRow } from '@/components/app/ui/FactRow'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Panel } from '@/components/app/ui/Panel'
import { Select } from '@/components/app/ui/Select'
import { TextInput } from '@/components/app/ui/TextInput'
import { Toast } from '@/components/app/ui/Toast'
import { Pill } from '@/components/app/ui/list/cells'
import { useUndo } from '@/components/app/ui/use-undo'
import { useRouter } from '@/i18n/navigation'
import {
  cancelBookingAction, confirmBookingAction, extendHoldAction, recordPaymentAction, verifyEligibilityAction,
} from '@/app/[locale]/(client)/[tenant]/bookings/actions'
import type { BookingActionFail } from '@/app/[locale]/(client)/[tenant]/bookings/run-action'
import { activityKeyOf, centsToInput, isCalendarDate, parseAmountToCents, PAYMENT_LIMITS, PAYMENT_METHOD_CHOICES, todayIn } from '@/lib/reservations/bookings-form'
import { actionStates, sessionNames, sessionRows, type ActionName } from '@/lib/reservations/bookings-view'
import type { BookingDetail } from '@/lib/reservations/server/bookings-read'
import { BookingStatusPill, PaymentStatusPill, ReviewFlags, useBookingFormat } from './booking-bits'

type Mode = null | 'payment' | 'confirm' | 'extend' | 'cancel' | 'verify'

/** A titled block of the detail page: one h2, the content below it. */
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Panel as="section" className="space-y-3">
      <h2 className="text-[1.0625rem] font-semibold">{title}</h2>
      {children}
    </Panel>
  )
}

const Muted = ({ children }: { children: React.ReactNode }) => <p className="text-[0.9375rem] leading-6 text-muted-foreground">{children}</p>

/**
 * Bookings → one booking (ADR-044 D4-D6, D16.18). Purchaser, people, sessions,
 * what was bought, payments (several are allowed, recorded by reference) and the
 * history; the actions sit top right and say why when they are switched off.
 */
export function BookingDetailView({
  projectSlug,
  detail,
  timeZone,
  can,
}: {
  projectSlug: string
  detail: BookingDetail
  timeZone: string
  can: { write: boolean; pay: boolean }
}) {
  const t = useTranslations('clientDashboard.bookings')
  const router = useRouter()
  const fmt = useBookingFormat(timeZone)
  const { toast, show } = useUndo()
  const b = detail.booking
  const states = actionStates(detail, can)
  const sessions = sessionRows(detail)
  const toPay = Math.max(0, b.totalCents - detail.paidCents)
  const who = b.anonymisedAt ? t('list.anonymised') : b.purchaserName || b.purchaserEmail || t('detail.someone')

  const [mode, setMode] = useState<Mode>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [until, setUntil] = useState(() => todayIn(timeZone, new Date(Date.now() + 7 * 24 * 3_600_000)))
  const [form, setForm] = useState(() => ({
    method: 'bank_transfer' as (typeof PAYMENT_METHOD_CHOICES)[number],
    amount: toPay > 0 ? centsToInput(toPay) : '',
    paidOn: todayIn(timeZone),
    reference: '',
    note: '',
  }))
  const [formErrors, setFormErrors] = useState<{ amount?: string; date?: string }>({})

  const open = (m: Mode) => {
    setError(null)
    setFormErrors({})
    setMode(m)
  }
  const close = () => {
    if (!busy) setMode(null)
  }

  function errorText(r: BookingActionFail): string {
    const names = r.error === 'full' ? sessionNames(detail, r.occurrenceIds, fmt.dateTime) : null
    return t(`errors.${r.error}`, { sessions: names ?? t('errors.fullUnknown') })
  }

  async function run<T extends { ok: true }>(work: () => Promise<T | BookingActionFail>, done: (r: T) => string) {
    setBusy(true)
    setError(null)
    let r: T | BookingActionFail
    try {
      r = await work()
    } catch {
      r = { ok: false, error: 'failed' }
    }
    setBusy(false)
    if (r.ok) {
      show({ message: done(r), tone: 'status' }, 6000)
      setMode(null)
      router.refresh()
    } else {
      setError(errorText(r))
      // The booking changed under us: show the new state next to the message.
      if (r.error === 'changed') router.refresh()
    }
  }

  const base = { projectSlug, bookingId: b.id }

  function submitPayment() {
    const cents = parseAmountToCents(form.amount)
    const errs: typeof formErrors = {}
    if (cents === null) errs.amount = t('detail.payment.amountInvalid')
    if (!isCalendarDate(form.paidOn)) errs.date = t('detail.payment.dateInvalid')
    setFormErrors(errs)
    if (cents === null || errs.date) return
    void run(
      () => recordPaymentAction({ ...base, method: form.method, amountCents: cents, paidOn: form.paidOn, reference: form.reference, note: form.note }),
      (r) => {
        const amount = fmt.money(cents)
        return r.confirmed ? t('detail.done.paymentConfirmed', { amount }) : r.paymentReview ? t('detail.done.paymentReview', { amount }) : t('detail.done.payment', { amount })
      },
    )
  }

  const actionButtons: Array<{ name: ActionName; label: string; mode: Exclude<Mode, null>; primary?: boolean }> = [
    { name: 'recordPayment', label: t('detail.recordPayment'), mode: 'payment', primary: true },
    { name: 'confirm', label: t('detail.confirm'), mode: 'confirm' },
    { name: 'extendHold', label: t('detail.extendHold'), mode: 'extend' },
    { name: 'verifyEligibility', label: t('detail.verifyEligibility'), mode: 'verify' },
    { name: 'cancel', label: t('detail.cancel'), mode: 'cancel' },
  ]
  const reasonText = (name: ActionName): string | null => {
    const s = states[name]
    if (s.enabled) return null
    return t(`detail.why.${s.why}`, { status: t(`status.${b.status}`).toLowerCase() })
  }
  // Switched-off actions that are worth a sentence: not the ones that simply do not apply to this state.
  const reasons = actionButtons.flatMap((a) => {
    const s = states[a.name]
    if (s.enabled) return []
    if (s.why === 'closed' || s.why === 'notConfirmable' || s.why === 'notExtendable' || s.why === 'noEligibility') {
      return a.name === 'recordPayment' || a.name === 'cancel' ? [{ id: a.name, text: `${a.label}: ${reasonText(a.name)}` }] : []
    }
    return [{ id: a.name, text: `${a.label}: ${reasonText(a.name)}` }]
  })
  const reasonId = (n: ActionName) => `booking-why-${n}`

  const releasedText = (reason: string) => t('detail.released', { reason: t(`detail.releaseReason.${reason as 'cancelled'}`) })

  return (
    <>
      <BackLink href={`/${projectSlug}/bookings`} label={t('detail.back')} />
      <PageHeader
        title={t('detail.title', { reference: b.reference })}
        actions={actionButtons.map((a) => (
          <Button
            key={a.name}
            variant={a.primary ? 'primary' : 'secondary'}
            disabled={!states[a.name].enabled}
            aria-describedby={states[a.name].enabled ? undefined : reasonId(a.name)}
            onClick={() => open(a.mode)}
          >
            {a.label}
          </Button>
        ))}
      />

      {reasons.length ? (
        <ul className="space-y-1">
          {reasons.map((r) => (
            <li key={r.id} id={reasonId(r.id as ActionName)} className="text-sm leading-5 text-muted-foreground">
              {r.text}
            </li>
          ))}
        </ul>
      ) : null}
      {/* Descriptions for switched-off buttons that have no visible sentence above. */}
      {actionButtons.filter((a) => !states[a.name].enabled && !reasons.some((r) => r.id === a.name)).map((a) => (
        <span key={a.name} id={reasonId(a.name)} className="sr-only">
          {reasonText(a.name)}
        </span>
      ))}

      {b.paymentReview ? <Notice tone="info">{t('detail.reviewNotice.payment')}</Notice> : null}
      {b.eligibilityReview ? <Notice tone="info">{t('detail.reviewNotice.eligibility')}</Notice> : null}

      {mode === 'payment' ? (
        <Panel as="section" aria-label={t('detail.payment.title')} className="space-y-4">
          <div>
            <h2 className="text-[1.0625rem] font-semibold">{t('detail.payment.title')}</h2>
            <p className="mt-1 text-[0.9375rem] leading-6 text-muted-foreground">{t('detail.payment.intro')}</p>
          </div>
          <div className="grid items-start gap-4 md:grid-cols-2">
            <Field label={t('detail.payment.method')}>
              {(p) => (
                <Select {...p} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as typeof form.method })}>
                  {PAYMENT_METHOD_CHOICES.map((m) => (
                    <option key={m} value={m}>
                      {t(`method.${m}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('detail.payment.amount')} hint={t('detail.payment.amountHint')} hintBelow error={formErrors.amount}>
              {(p) => <TextInput {...p} inputMode="decimal" autoComplete="off" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />}
            </Field>
            <Field label={t('detail.payment.date')} error={formErrors.date}>
              {(p) => <DateInput {...p} value={form.paidOn} max={todayIn(timeZone, new Date(Date.now() + 24 * 3_600_000))} onChange={(e) => setForm({ ...form, paidOn: e.target.value })} />}
            </Field>
            <Field label={t('detail.payment.reference')} hint={t('detail.payment.referenceHint')} hintBelow>
              {(p) => <TextInput {...p} maxLength={PAYMENT_LIMITS.reference} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />}
            </Field>
            <Field label={t('detail.payment.note')} className="md:col-span-2">
              {(p) => <TextInput {...p} maxLength={PAYMENT_LIMITS.note} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />}
            </Field>
          </div>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="flex flex-wrap items-start gap-2">
            <Button variant="primary" disabled={busy} aria-busy={busy || undefined} onClick={submitPayment}>
              {busy ? t('detail.payment.saving') : t('detail.payment.save')}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={close}>
              {t('detail.payment.cancel')}
            </Button>
          </div>
        </Panel>
      ) : null}

      <Block title={t('detail.summary')}>
        <dl>
          <FactRow label={t('detail.what')}>{detail.what ?? t('detail.none')}</FactRow>
          {detail.optionLabel && detail.optionLabel !== detail.what ? <FactRow label={t('detail.option')}>{detail.optionLabel}</FactRow> : null}
          <FactRow label={t('detail.status')}>
            <span className="flex flex-wrap items-start gap-1.5">
              <BookingStatusPill status={b.status} />
              <PaymentStatusPill status={b.paymentStatus} />
              <ReviewFlags paymentReview={b.paymentReview} eligibilityReview={b.eligibilityReview} />
            </span>
          </FactRow>
          <FactRow label={t('detail.total')}>{fmt.money(b.totalCents)}</FactRow>
          <FactRow label={t('detail.paid')}>{fmt.money(detail.paidCents)}</FactRow>
          {b.status !== 'cancelled' && b.status !== 'expired' ? <FactRow label={t('detail.toPay')}>{fmt.money(toPay)}</FactRow> : null}
          {b.holdExpiresAt && (b.status === 'held' || b.status === 'awaiting_payment') ? <FactRow label={t('detail.holdUntil')}>{fmt.dateTime(b.holdExpiresAt)}</FactRow> : null}
          <FactRow label={t('detail.madeOn')}>{fmt.dateTime(b.createdAt)}</FactRow>
          {b.confirmedAt ? <FactRow label={t('detail.confirmedOn')}>{fmt.dateTime(b.confirmedAt)}</FactRow> : null}
          {b.cancelledAt ? <FactRow label={t('detail.cancelledOn')}>{fmt.dateTime(b.cancelledAt)}</FactRow> : null}
          <FactRow label={t('detail.source')}>{b.source === 'dashboard' ? t('detail.sourceDashboard') : t('detail.sourceWebsite')}</FactRow>
        </dl>
      </Block>

      <Block title={t('detail.who')}>
        <dl>
          <FactRow label={t('detail.name')}>{b.anonymisedAt ? t('list.anonymised') : b.purchaserName || t('detail.none')}</FactRow>
          <FactRow label={t('detail.email')}>{b.purchaserEmail || t('detail.none')}</FactRow>
          <FactRow label={t('detail.phone')}>{b.purchaserPhone || t('detail.none')}</FactRow>
        </dl>
      </Block>

      <Block title={t('detail.attendees')}>
        {detail.attendees.length === 0 ? (
          <Muted>{t('detail.attendeesNone')}</Muted>
        ) : (
          <ul className="divide-y divide-border">
            {detail.attendees.map((a) => (
              <li key={a.id} className="flex flex-col items-start gap-1 py-2.5 first:pt-0 last:pb-0">
                <span className="text-[0.9375rem] font-semibold break-words">{a.anonymised ? t('list.anonymised') : a.name || t('detail.unnamed')}</span>
                {a.email && !a.anonymised ? <span className="text-sm break-all text-muted-foreground">{a.email}</span> : null}
                {a.isMinor ? <span className="text-sm text-muted-foreground">{a.guardianName ? t('detail.minor', { name: a.guardianName }) : t('detail.minorNoName')}</span> : null}
                {a.eligibilityResult ? <Pill tone={a.eligibilityResult === 'pending' ? 'highlight' : a.eligibilityResult === 'verified' ? 'success' : 'outline'}>{t(`detail.eligibility.${a.eligibilityResult}`)}</Pill> : null}
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title={t('detail.sessions')}>
        {detail.passes.length ? (
          <ul className="space-y-1">
            {detail.passes.map((p) => (
              <li key={p.id} className="text-[0.9375rem] leading-6">
                {t('detail.passValid', { entries: p.entriesTotal ?? 0, from: fmt.date(p.validFrom), to: fmt.date(p.validTo) })}
                {p.status === 'cancelled' ? <span className="text-muted-foreground"> · {t('detail.passCancelled')}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {sessions.length === 0 ? (
          detail.passes.length ? null : <Muted>{t('detail.sessionsNone')}</Muted>
        ) : sessions.every((s) => !s.title && !s.startsAt) ? (
          <Muted>{t('detail.sessionsNoDetails', { count: sessions.filter((s) => 'kind' in s.state).length })}</Muted>
        ) : (
          <ul className="divide-y divide-border">
            {sessions.map((s) => (
              <li key={s.key} className="flex flex-col items-start gap-1 py-2.5 first:pt-0 last:pb-0">
                <span className="text-[0.9375rem] font-semibold break-words">{s.title ?? t('detail.session')}</span>
                {s.startsAt ? <span className="text-sm text-muted-foreground">{fmt.dateTime(s.startsAt)}</span> : null}
                <span className="text-sm text-muted-foreground">{'kind' in s.state ? t(`detail.allocation.${s.state.kind}`) : releasedText(s.state.released)}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title={t('detail.lines')}>
        {detail.lines.length === 0 ? (
          <Muted>{t('detail.linesNone')}</Muted>
        ) : (
          <ul className="divide-y divide-border">
            {detail.lines.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                <span className="min-w-0">
                  <span className="block text-[0.9375rem] break-words">{l.label ?? (l.kind === 'adjustment' ? t('detail.adjustment') : t('detail.what'))}</span>
                  {l.quantity > 1 ? <span className="block text-sm text-muted-foreground">{t('detail.lineQuantity', { quantity: l.quantity, unit: fmt.money(l.unitCents) })}</span> : null}
                </span>
                <span className="shrink-0 text-[0.9375rem] font-semibold">{fmt.money(l.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title={t('detail.payments')}>
        {detail.payments.length === 0 ? (
          <Muted>{t('detail.paymentsNone')}</Muted>
        ) : (
          <ul className="divide-y divide-border">
            {detail.payments.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                <span className="min-w-0">
                  <span className="block text-[0.9375rem] font-semibold">{t('detail.paymentOn', { method: t(`method.${p.method}`), date: fmt.date(p.paidOn ?? p.createdAt) })}</span>
                  {p.reference ? <span className="block text-sm break-words text-muted-foreground">{t('detail.paymentReference', { reference: p.reference })}</span> : null}
                  {p.note ? <span className="block text-sm break-words text-muted-foreground">{p.note}</span> : null}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-[0.9375rem] font-semibold">{fmt.money(p.amountCents)}</span>
                  {p.status !== 'succeeded' ? <Pill tone="outline">{t(`detail.paymentState.${p.status}`)}</Pill> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title={t('detail.activity')}>
        {detail.activity.length === 0 ? (
          <Muted>{t('detail.activityNone')}</Muted>
        ) : (
          <ul className="divide-y divide-border">
            {detail.activity.map((a) => {
              const amount = typeof a.detail.amount_cents === 'number' ? fmt.money(a.detail.amount_cents) : ''
              const method = typeof a.detail.method === 'string' && a.detail.method in { bank_transfer: 1, cash: 1, other: 1, free: 1, stripe: 1 } ? t(`method.${a.detail.method as 'cash'}`) : ''
              const date = typeof a.detail.until === 'string' ? fmt.date(a.detail.until) : ''
              return (
                <li key={a.id} className="flex flex-col items-start gap-0.5 py-2.5 first:pt-0 last:pb-0">
                  <span className="text-[0.9375rem] break-words">{t(`activity.${activityKeyOf(a.action)}`, { amount, method, date })}</span>
                  <span className="text-sm text-muted-foreground">
                    {fmt.dateTime(a.createdAt)} · {t(`detail.by.${a.actorKind}`)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Block>

      <ConfirmDialog
        open={mode === 'confirm'}
        title={t('detail.confirmDialog.title')}
        body={t('detail.confirmDialog.body', { name: who })}
        confirmLabel={t('detail.confirmDialog.confirm')}
        busy={busy}
        error={mode === 'confirm' ? error : null}
        onCancel={close}
        onConfirm={() => run(() => confirmBookingAction(base), () => t('detail.done.confirmed'))}
      />
      <ConfirmDialog
        open={mode === 'extend'}
        title={t('detail.extendDialog.title')}
        body={t('detail.extendDialog.body', { name: who })}
        confirmLabel={t('detail.extendDialog.confirm')}
        busy={busy}
        error={mode === 'extend' ? error : null}
        onCancel={close}
        onConfirm={() => run(() => extendHoldAction({ ...base, until }), () => t('detail.done.extended', { date: fmt.date(until) }))}
      >
        <Field label={t('detail.extendDialog.date')}>
          {(p) => <DateInput {...p} value={until} min={todayIn(timeZone)} onChange={(e) => setUntil(e.target.value)} />}
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={mode === 'cancel'}
        title={t('detail.cancelDialog.title')}
        body={detail.paidCents > 0 ? t('detail.cancelDialog.bodyPaid', { name: who }) : t('detail.cancelDialog.body', { name: who })}
        confirmLabel={t('detail.cancelDialog.confirm')}
        cancelLabel={t('detail.cancelDialog.keep')}
        busy={busy}
        error={mode === 'cancel' ? error : null}
        onCancel={close}
        onConfirm={() => run(() => cancelBookingAction(base), () => t('detail.done.cancelled'))}
      />
      <ConfirmDialog
        open={mode === 'verify'}
        title={t('detail.verifyDialog.title')}
        body={t('detail.verifyDialog.body')}
        confirmLabel={t('detail.verifyDialog.confirm')}
        busy={busy}
        error={mode === 'verify' ? error : null}
        onCancel={close}
        onConfirm={() => run(() => verifyEligibilityAction(base), () => t('detail.done.verified'))}
      />
      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </>
  )
}
