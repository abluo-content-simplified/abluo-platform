// ── Reservations — "Notify the N booked people?" change emails (ADR-044 D10) ──
// Never automatic. prepare → the dashboard shows the count and an editable,
// prefilled message → send → one personalised intent per person.
import { fromStoreError, makeIntent, noticeIdFrom, recipientsOf, refuse, succeed, type NoticeScope, type ServiceDeps, type ServiceResult } from './types'

export type PreparedNotice = {
  noticeId: string
  projectId: string
  scope: NoticeScope
  recipients: Array<{ bookingId: string; name: string | null; email: string; locale: string }>
  count: number
}

export type NoticeMessage = { subject: string; body: string }
/** Keyed by locale ('it', 'en' …). `{firstName}` in subject/body is filled per person. */
export type NoticeMessages = Record<string, NoticeMessage>

export async function prepareChangeNotice(
  input: { projectId: string; scope: NoticeScope }, deps: ServiceDeps,
): Promise<ServiceResult<PreparedNotice>> {
  const r = await deps.store.listNoticeRecipients(input.projectId, input.scope)
  if (!r.ok) return fromStoreError(r.error)
  const byBooking = new Map<string, PreparedNotice['recipients'][number]>()
  for (const x of r.value) {
    if (!x.email || byBooking.has(x.bookingId)) continue
    byBooking.set(x.bookingId, { bookingId: x.bookingId, name: x.name, email: x.email, locale: x.locale })
  }
  const recipients = [...byBooking.values()]
  return succeed({ noticeId: noticeIdFrom(deps), projectId: input.projectId, scope: input.scope, recipients, count: recipients.length })
}

export const firstNameOf = (name: string | null | undefined): string => (name ?? '').trim().split(/\s+/)[0] ?? ''

const fill = (text: string, firstName: string) => text.replace(/\{firstName\}/g, () => firstName)

export async function sendChangeNotice(
  prepared: PreparedNotice, messages: NoticeMessages, fallbackLocale: string, deps: ServiceDeps,
): Promise<ServiceResult<{ queued: number; skipped: Array<{ bookingId: string; reason: 'no_message_for_locale' }> }>> {
  if (!Object.keys(messages).length) return refuse('message_required')
  for (const m of Object.values(messages)) if (!m.subject.trim() || !m.body.trim()) return refuse('message_required')
  const skipped: Array<{ bookingId: string; reason: 'no_message_for_locale' }> = []
  const items = []
  for (const r of prepared.recipients) {
    const lang = r.locale.split('-')[0]
    const msg = messages[r.locale] ?? messages[lang] ?? messages[fallbackLocale] ?? messages[fallbackLocale.split('-')[0]]
    if (!msg) { skipped.push({ bookingId: r.bookingId, reason: 'no_message_for_locale' }); continue }
    const first = firstNameOf(r.name)
    items.push({
      bookingId: r.bookingId,
      intent: makeIntent(deps, {
        intent: 'change.notice', dedupeKey: `change.notice:${prepared.noticeId}:${r.bookingId}`,
        recipients: recipientsOf(r), locale: r.locale,
        payload: { noticeId: prepared.noticeId, subject: fill(msg.subject, first), body: fill(msg.body, first), firstName: first },
      }),
    })
  }
  if (!items.length) return succeed({ queued: 0, skipped })
  const q = await deps.store.enqueueOutbox(prepared.projectId, items)
  if (!q.ok) return fromStoreError(q.error)
  return succeed({ queued: q.value.queued, skipped })
}
