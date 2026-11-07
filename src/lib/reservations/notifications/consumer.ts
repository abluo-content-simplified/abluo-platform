// ── Reservations — outbox consumer (ADR-044 D10, D16.5) ───────────────────────
//
// Claim → render → send → finalize, per row, idempotently:
//   * a row is claimed atomically (outbox.ts); a crashed `delivering` row comes
//     back after 10 minutes; a row that already has a provider_message_id is
//     marked delivered instead of being sent twice;
//   * only rows of THIS environment are touched; outside production mail goes
//     solely to RESERVATIONS_TEST_RECIPIENT, otherwise the row is `skipped`;
//   * failures back off (5 min, 10, 20 …, max 6 h) and the row is `dead` after
//     MAX_ATTEMPTS;
//   * after delivery (and on skipped / dead) the clear-text tokens are removed
//     from the payload: the outbox never keeps working links.
// Everything the consumer needs from outside is injected (ConsumerDeps).
import { firstNameOf } from '../service/change-notice'
import type { Environment } from '../service/types'
import type { Content } from './data'
import { personalUrl, siteOrigin, MANAGE_PATH, PASS_PATH } from './links'
import { BATCH, MAX_ATTEMPTS, backoffMs, type FinalizePatch, type OutboxRepo, type OutboxRow } from './outbox'
import { stripTokens } from './tokens-strip'
import { chooseEmailLocale, pickLocalized } from './templates/format'
import { isKnownIntent, renderReservationEmail } from './templates/render'

export type SiteContext = {
  name: string
  slug: string
  customDomain: string | null
  defaultLocale: string | null
  timeZone: string | null
  /** The tenant's contact address: Reply-To of every email. */
  replyTo: string | null
  logoUrl: string | null
}

export type SendParams = { to: string[]; subject: string; html: string; text: string; fromName?: string; replyTo?: string }
export type SendResult = { ok: boolean; id?: string; error?: string }

export type ConsumerDeps = {
  repo: OutboxRepo
  environment: Environment
  /** RESERVATIONS_TEST_RECIPIENT. Required to send anything outside production. */
  testRecipient?: string | null
  now: () => Date
  send: (p: SendParams) => Promise<SendResult>
  loadSite: (projectId: string) => Promise<SiteContext | null>
  loadContent: (row: OutboxRow) => Promise<Content>
  /** Stop starting new rows after this many ms (serverless time budget). */
  budgetMs?: number
}

export type Outcome = 'delivered' | 'failed' | 'dead' | 'skipped' | 'noop'
export type ConsumerResult = { unavailable: boolean; due: number; outcomes: Record<Outcome, number> }

const EMAIL = /^[^\s@,<>"']+@[^\s@,<>"']+\.[^\s@,<>"']+$/

type Recipient = { email: string; name: string | null }
function recipientsOf(raw: unknown): Recipient[] {
  if (!Array.isArray(raw)) return []
  const out: Recipient[] = []
  for (const r of raw) {
    const email = r && typeof r === 'object' ? (r as Record<string, unknown>).email : null
    if (typeof email !== 'string' || !EMAIL.test(email.trim())) continue
    const name = (r as Record<string, unknown>).name
    out.push({ email: email.trim(), name: typeof name === 'string' && name.trim() ? name.trim() : null })
  }
  return out
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export async function deliverRow(row: OutboxRow, deps: ConsumerDeps): Promise<Exclude<Outcome, 'noop'>> {
  const attempts = row.attempts
  const now = deps.now()
  const done = async (patch: Omit<FinalizePatch, 'attempts'> & { attempts?: number }) => {
    // Terminal states never keep working links.
    const terminal = patch.status !== 'failed'
    await deps.repo.finalize(row.id, { attempts, ...patch, ...(terminal ? { payload: stripTokens(row.payload) } : {}) })
    return patch.status as Exclude<Outcome, 'noop'>
  }
  const retry = (message: string) => {
    const next = attempts + 1
    return next >= MAX_ATTEMPTS
      ? done({ status: 'dead', attempts: next, last_error: message.slice(0, 500) })
      : done({ status: 'failed', attempts: next, last_error: message.slice(0, 500), next_attempt_at: new Date(now.getTime() + backoffMs(next)).toISOString() })
  }

  try {
    // Sent before, but the run died before it could record it: never send twice.
    if (row.provider_message_id) return await done({ status: 'delivered', last_error: null, delivered_at: now.toISOString() })

    if (!isKnownIntent(row.intent)) return await done({ status: 'dead', attempts: attempts + 1, last_error: `unknown intent: ${row.intent}`.slice(0, 500) })

    const production = deps.environment === 'production'
    let recipients = recipientsOf(row.recipients)
    if (!production) {
      const test = deps.testRecipient?.trim()
      if (!test || !EMAIL.test(test)) return await done({ status: 'skipped', last_error: 'non_production_no_test_recipient' })
      recipients = [{ email: test, name: null }]
    }
    if (!recipients.length) return await done({ status: 'skipped', last_error: str(row.payload.skip) ?? 'no_recipients' })

    const site = await deps.loadSite(row.project_id)
    if (!site) return await done({ status: 'skipped', last_error: 'project_gone' })
    const content = await deps.loadContent(row)
    if (row.booking_id && (!content.booking || content.booking.anonymised)) {
      return await done({ status: 'skipped', last_error: content.booking ? 'booking_anonymised' : 'booking_gone' })
    }

    const locale = chooseEmailLocale({ bookingLocale: row.locale, siteDefaultLocale: site.defaultLocale })
    const origin = siteOrigin(site)
    const payload = row.payload
    const manageUrl = personalUrl(origin, locale, MANAGE_PATH, payload.managementToken)
    const passTokens = Array.isArray(payload.passTokens) ? payload.passTokens : []
    const passLinks = passTokens
      .map((p) => personalUrl(origin, locale, PASS_PATH, p && typeof p === 'object' ? (p as Record<string, unknown>).token : null))
      .filter((u): u is string => !!u)
      .map((url) => ({ url }))

    const outcome = payload.outcome
    const mails = recipients.map((r) => ({
      to: r.email,
      mail: renderReservationEmail({
        intent: row.intent as Parameters<typeof renderReservationEmail>[0]['intent'],
        locale,
        siteName: site.name,
        firstName: str(payload.firstName) ?? firstNameOf(r.name ?? content.booking?.purchaserName ?? ''),
        reference: str(payload.reference) ?? content.booking?.reference ?? null,
        sessions: content.sessions,
        siteTimeZone: site.timeZone,
        totalCents: num(payload.totalCents) ?? content.booking?.totalCents ?? null,
        holdExpiresAt: str(payload.holdExpiresAt) ?? content.booking?.holdExpiresAt ?? null,
        paymentInstructions: pickLocalized(payload.paymentInstructions ?? content.paymentInstructions, locale, site.defaultLocale),
        bankDetails: pickLocalized(payload.bankDetails ?? content.bankDetails, locale, site.defaultLocale),
        manageUrl,
        passLinks,
        afterPayment: payload.afterPayment === true,
        outcome: outcome === 'none' || outcome === 'credit' || outcome === 'refund_review' ? outcome : null,
        customSubject: str(payload.subject),
        customBody: str(payload.body),
        logoUrl: site.logoUrl,
        testBanner: !production,
      }),
    }))

    const ids: string[] = []
    const failures: string[] = []
    for (const { to, mail } of mails) {
      const res = await deps.send({ to: [to], subject: mail.subject, html: mail.html, text: mail.text, fromName: site.name, replyTo: site.replyTo ?? undefined })
      if (res.ok) ids.push(res.id ?? 'sent')
      else failures.push(`${to}: ${res.error ?? 'send failed'}`)
    }
    if (!failures.length) {
      return await done({ status: 'delivered', last_error: null, provider_message_id: ids.join(',').slice(0, 200), delivered_at: now.toISOString() })
    }
    return await retry(failures.join('; '))
  } catch (err) {
    return await retry(err instanceof Error ? err.message : String(err))
  }
}

export async function processOutbox(deps: ConsumerDeps, opts: { limit?: number } = {}): Promise<ConsumerResult> {
  const outcomes: Record<Outcome, number> = { delivered: 0, failed: 0, dead: 0, skipped: 0, noop: 0 }
  const start = deps.now().getTime()
  const ids = await deps.repo.listDueIds(deps.environment, deps.now(), opts.limit ?? BATCH)
  if (ids === 'unavailable') return { unavailable: true, due: 0, outcomes }
  for (const id of ids) {
    if (deps.budgetMs && deps.now().getTime() - start > deps.budgetMs) break
    let row: OutboxRow | null = null
    try { row = await deps.repo.claim(id, deps.environment, deps.now()) } catch { row = null }
    if (!row) { outcomes.noop++; continue }
    outcomes[await deliverRow(row, deps)]++
  }
  return { unavailable: false, due: ids.length, outcomes }
}
