// ── Reservations emails — one renderer for every intent (ADR-044 D10) ─────────
//
// Pure: data in, { subject, html, text } out. Every sentence comes from the
// dictionary (dictionaries.ts); this file only assembles and escapes. The
// consumer gathers the data (site, sessions, payment texts, links).
import { DICTIONARIES, type Copy, type EmailLocale, type Messages } from './dictionaries'
import { esc, fill, formatAmount, formatDate, formatDateTime, formatTime, oneLine, paragraphsHtml } from './format'

export const INTENTS = [
  'booking.confirmed', 'booking.awaiting_payment', 'booking.expired', 'booking.cancelled', 'session.cancelled', 'change.notice',
] as const
export type ReservationIntent = (typeof INTENTS)[number]
export const isKnownIntent = (v: string): v is ReservationIntent => (INTENTS as readonly string[]).includes(v)

export type SessionLine = { startsAt: string; timeZone?: string | null }
export type NamedLink = { url: string }

export type RenderInput = {
  intent: ReservationIntent
  locale: EmailLocale
  siteName: string
  firstName?: string | null
  reference?: string | null
  sessions?: SessionLine[]
  /** Fallback zone for sessions without their own. */
  siteTimeZone?: string | null
  totalCents?: number | null
  /** ISO instant: pay by. */
  holdExpiresAt?: string | null
  /** Tenant-written, already in this email's language (see pickLocalized). */
  paymentInstructions?: string | null
  bankDetails?: string | null
  manageUrl?: string | null
  passLinks?: NamedLink[]
  /** booking.confirmed after a recorded payment. */
  afterPayment?: boolean
  /** session.cancelled */
  outcome?: 'none' | 'credit' | 'refund_review' | null
  /** change.notice: tenant-written, personalised upstream. */
  customSubject?: string | null
  customBody?: string | null
  logoUrl?: string | null
  /** Non-production delivery redirected to the test recipient. */
  testBanner?: boolean
}

export type RenderedEmail = { subject: string; html: string; text: string }

function copyFor(m: Messages, input: RenderInput): Copy | null {
  switch (input.intent) {
    case 'booking.confirmed': return input.afterPayment ? m.intents.confirmedAfterPayment : m.intents.confirmed
    case 'booking.awaiting_payment': return m.intents.awaitingPayment
    case 'booking.expired': return m.intents.expired
    case 'booking.cancelled': return m.intents.cancelled
    case 'session.cancelled': return m.intents.sessionCancelled
    case 'change.notice': return null
  }
}

export function renderReservationEmail(input: RenderInput): RenderedEmail {
  const m = DICTIONARIES[input.locale]
  const site = oneLine(input.siteName, 120)
  const first = oneLine(input.firstName ?? '', 80)
  const reference = oneLine(input.reference ?? '', 60)
  const plain = { site, reference, firstName: first }
  const safe = { site: esc(site), reference: esc(reference), firstName: esc(first) }

  const copy = copyFor(m, input)
  const custom = input.intent === 'change.notice'
  const subject = oneLine(custom ? (input.customSubject ?? '') || site : fill(copy!.subject, plain))
  const heading = custom ? subject : copy!.heading
  const bodyText = custom ? (input.customBody ?? '') : fill(copy!.body, plain)

  const hello = first ? fill(m.hello, plain) : m.helloAnonymous
  const sessions = (input.sessions ?? []).map((s) => ({
    date: formatDate(s.startsAt, input.locale, s.timeZone ?? input.siteTimeZone),
    time: formatTime(s.startsAt, input.locale, s.timeZone ?? input.siteTimeZone),
  })).filter((s) => s.date)
  const sessionsHeading = input.intent === 'session.cancelled' ? m.cancelledSessionHeading : m.sessions
  const amount = typeof input.totalCents === 'number' && input.totalCents > 0 ? formatAmount(input.totalCents, input.locale) : null
  const deadline = input.intent === 'booking.awaiting_payment' && input.holdExpiresAt
    ? fill(m.deadline, { date: formatDateTime(input.holdExpiresAt, input.locale, input.siteTimeZone) })
    : null
  const showPayment = input.intent === 'booking.awaiting_payment'
  const outcome = input.intent === 'session.cancelled' && input.outcome ? m.outcome[input.outcome] : null
  const passLinks = input.passLinks ?? []
  const passLabel = (i: number) => (passLinks.length > 1 ? fill(m.passLinkNumbered, { n: String(i + 1) }) : m.passLink)
  const showSessions = sessions.length > 0 && input.intent !== 'booking.expired' && input.intent !== 'booking.cancelled'

  // ── plain text ──
  const t: string[] = []
  if (input.testBanner) t.push(`[${m.testBanner}]`, '')
  t.push(hello, '', bodyText, '')
  if (reference && !custom) t.push(`${m.reference}: ${reference}`)
  if (showSessions) { t.push('', `${sessionsHeading}:`); for (const s of sessions) t.push(`- ${s.date}, ${s.time}`) }
  if (amount && !custom) t.push('', `${m.amount}: ${amount}`)
  if (deadline) t.push('', deadline)
  if (showPayment && input.paymentInstructions) t.push('', `${m.paymentHeading}:`, input.paymentInstructions)
  if (showPayment && input.bankDetails) t.push('', `${m.bankHeading}:`, input.bankDetails)
  if (outcome) t.push('', outcome)
  if (input.manageUrl) t.push('', `${m.manage}: ${input.manageUrl}`, m.manageHint)
  if (passLinks.length) { t.push('', `${m.passHeading}:`); passLinks.forEach((l, i) => t.push(`${passLabel(i)}: ${l.url}`)); t.push(m.passHint) }
  t.push('', fill(m.replyHint, plain), fill(m.footer, plain))
  const text = t.join('\n')

  // ── HTML ──
  const block = (s: string) => `<p style="margin:0 0 14px;line-height:1.5">${s}</p>`
  const h: string[] = []
  if (input.testBanner) h.push(`<p style="margin:0 0 16px;padding:8px 12px;background:#fff4d6;border-radius:6px;font-size:13px">${esc(m.testBanner)}</p>`)
  if (input.logoUrl && /^https:\/\/[^\s"'<>]+$/.test(input.logoUrl)) h.push(`<img src="${esc(input.logoUrl)}" alt="${safe.site}" style="max-height:36px;margin:0 0 16px;display:block;border:0">`)
  h.push(`<h1 style="font-size:20px;font-weight:600;margin:0 0 20px">${custom ? esc(heading) : fill(esc(heading), safe)}</h1>`)
  h.push(block(first ? fill(esc(m.hello), safe) : esc(m.helloAnonymous)))
  h.push(custom ? paragraphsHtml(bodyText) : block(fill(esc(copy!.body), safe)))
  if (reference && !custom) h.push(block(`<span style="color:#6b6b66">${esc(m.reference)}:</span> <strong>${esc(reference)}</strong>`))
  if (showSessions) {
    h.push(`<p style="margin:16px 0 6px;font-weight:600">${esc(sessionsHeading)}</p>`)
    h.push(`<ul style="margin:0 0 14px;padding-left:20px;line-height:1.6">${sessions.map((s) => `<li>${esc(s.date)}, ${esc(s.time)}</li>`).join('')}</ul>`)
  }
  if (amount && !custom) h.push(block(`<span style="color:#6b6b66">${esc(m.amount)}:</span> <strong>${esc(amount)}</strong>`))
  if (deadline) h.push(block(esc(deadline)))
  if (showPayment && input.paymentInstructions) h.push(`<p style="margin:16px 0 6px;font-weight:600">${esc(m.paymentHeading)}</p>`, paragraphsHtml(input.paymentInstructions))
  if (showPayment && input.bankDetails) h.push(`<p style="margin:16px 0 6px;font-weight:600">${esc(m.bankHeading)}</p>`, `<div style="margin:0 0 14px;padding:12px 14px;background:#f6f6f4;border-radius:8px;line-height:1.5">${esc(input.bankDetails).replace(/\r?\n/g, '<br>')}</div>`)
  if (outcome) h.push(block(esc(outcome)))
  const button = (url: string, label: string) =>
    `<p style="margin:20px 0 6px"><a href="${esc(url)}" style="display:inline-block;background:#1c1c1a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:500">${esc(label)}</a></p>`
  if (input.manageUrl) {
    h.push(button(input.manageUrl, m.manage), `<p style="margin:0 0 4px;font-size:13px;color:#6b6b66">${esc(m.manageHint)}</p>`)
    h.push(`<p style="margin:0 0 4px;font-size:13px;color:#6b6b66">${esc(m.linkFallback)}</p><p style="margin:0 0 16px;font-size:13px;word-break:break-all;color:#6b6b66">${esc(input.manageUrl)}</p>`)
  }
  if (passLinks.length) {
    h.push(`<p style="margin:16px 0 0;font-weight:600">${esc(m.passHeading)}</p>`)
    passLinks.forEach((l, i) => h.push(button(l.url, passLabel(i))))
    h.push(`<p style="margin:0 0 16px;font-size:13px;color:#6b6b66">${esc(m.passHint)}</p>`)
  }
  h.push(`<p style="margin:24px 0 4px;font-size:13px;color:#6b6b66">${fill(esc(m.replyHint), safe)}</p>`, `<p style="margin:0;font-size:13px;color:#6b6b66">${fill(esc(m.footer), safe)}</p>`)
  const html = `<!doctype html><html lang="${input.locale}"><body style="margin:0;padding:32px 16px;background:#f6f6f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1c1a">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
${h.join('\n')}
</div></body></html>`

  return { subject: input.testBanner ? `[TEST] ${subject}` : subject, html, text }
}
