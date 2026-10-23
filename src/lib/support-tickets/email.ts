/**
 * Ticket notification emails (ADR-039 D13). Pure: recipient rules, language
 * choice, links and rendering. NEVER takes a title, description, reply or
 * screenshot — the input type has no field for them (a title can contain a
 * patient's name), so they cannot leak into an email by accident.
 *
 * Texts come from messages/{locale}.json → `supportTicketEmail`, the same way
 * invitation emails get theirs (src/lib/invitations/messages.ts).
 */
import en from '../../../messages/en.json'
import it from '../../../messages/it.json'
import de from '../../../messages/de.json'

export type TicketEventType = 'ticket.created' | 'ticket.client_replied' | 'ticket.support_replied' | 'ticket.resolved' | 'ticket.waiting_for_user'
export type EmailLocale = 'en' | 'it' | 'de'
export type TicketEmailMessages = typeof en.supportTicketEmail

const BY_LOCALE: Record<EmailLocale, TicketEmailMessages> = { en: en.supportTicketEmail, it: it.supportTicketEmail, de: de.supportTicketEmail }

export const ADMIN_ORIGIN = 'https://admin.abluo.app'
export const CLIENT_ORIGIN = 'https://abluo.app'

export type RecipientKind = 'admins' | 'creator'

/** ticket.created / ticket.client_replied → Abluo admins; the others → the ticket's creator. */
export function recipientKindFor(eventType: TicketEventType): RecipientKind {
  return eventType === 'ticket.created' || eventType === 'ticket.client_replied' ? 'admins' : 'creator'
}

function asLocale(value: unknown): EmailLocale | null {
  return value === 'en' || value === 'it' || value === 'de' ? value : null
}

/**
 * Language: the platform stores no per-person interface language, so the best
 * signal is the interface language recorded on the ticket when it was opened
 * (the creator's own), then the project's default_locale if en/it/de, else English.
 */
export function chooseEmailLocale(input: { interfaceLocale?: unknown; projectDefaultLocale?: unknown }): EmailLocale {
  const fromTicket = typeof input.interfaceLocale === 'string' ? asLocale(input.interfaceLocale.slice(0, 2).toLowerCase()) : null
  return fromTicket ?? asLocale(input.projectDefaultLocale) ?? 'en'
}

/** Env override first (comma list), else every auth user with platform_role 'abluo_admin'. */
export function chooseAdminEmails(
  envList: string | undefined | null,
  users: ReadonlyArray<{ email?: string | null; app_metadata?: Record<string, unknown> | null }>,
): string[] {
  const clean = (list: Array<string | null | undefined>) =>
    [...new Set(list.map((e) => (e ?? '').trim().toLowerCase()).filter((e) => /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(e)))]
  const fromEnv = clean((envList ?? '').split(','))
  if (fromEnv.length > 0) return fromEnv
  return clean(users.filter((u) => u.app_metadata?.platform_role === 'abluo_admin').map((u) => u.email))
}

export function ticketUrl(kind: RecipientKind, ticketId: string, projectSlug: string): string {
  return kind === 'admins'
    ? `${ADMIN_ORIGIN}/support/${encodeURIComponent(ticketId)}`
    : `${CLIENT_ORIGIN}/${encodeURIComponent(projectSlug)}/support/${encodeURIComponent(ticketId)}`
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m))
}

const KEY = {
  'ticket.created': 'created',
  'ticket.client_replied': 'clientReplied',
  'ticket.support_replied': 'supportReplied',
  'ticket.resolved': 'resolved',
  'ticket.waiting_for_user': 'waitingForUser',
} as const

export type TicketEmailInput = {
  eventType: TicketEventType
  locale: EmailLocale
  /** ABL-000124 */
  reference: string
  projectName: string
  url: string
}

export function renderTicketEmail(input: TicketEmailInput): { subject: string; html: string; text: string } {
  const m = BY_LOCALE[input.locale]
  const t = m[KEY[input.eventType]]
  const plain = { ref: input.reference, project: input.projectName.replace(/[\r\n]+/g, ' ').slice(0, 120) }
  const safe = { ref: esc(plain.ref), project: esc(plain.project) }
  const subject = fill(t.subject, plain)
  const text = [fill(t.heading, plain), '', fill(t.body, plain), '', `${m.button}: ${input.url}`, '', m.privacy].join('\n')
  const html = `<!doctype html><html lang="${input.locale}"><body style="margin:0;padding:32px 16px;background:#f6f6f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1c1a">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
<h1 style="font-size:20px;font-weight:600;margin:0 0 20px">${fill(esc(t.heading), safe)}</h1>
<p style="margin:0 0 16px;line-height:1.5">${fill(esc(t.body), safe)}</p>
<p style="margin:24px 0"><a href="${esc(input.url)}" style="display:inline-block;background:#1c1c1a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:500">${esc(m.button)}</a></p>
<p style="margin:0 0 4px;font-size:13px;color:#6b6b66">${esc(m.linkHint)}</p>
<p style="margin:0 0 24px;font-size:13px;word-break:break-all;color:#6b6b66">${esc(input.url)}</p>
<p style="margin:0;font-size:13px;color:#6b6b66">${esc(m.privacy)}</p>
</div></body></html>`
  return { subject, html, text }
}
