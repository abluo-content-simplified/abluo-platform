/**
 * The invitation email — ADR-028 §6. Pure: builds subject, HTML and text.
 * Sent as "<Inviter> via Abluo" <no-reply@mail.abluo.app> with Reply-To =
 * the inviter, so a reply reaches a person, never an unread inbox.
 */
import { extrasLabel, fill, getInvitationMessages, invitationLocale, roleLabel } from './messages'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export type InvitationEmailInput = {
  locale: string
  inviterName: string
  placeName: string
  role: string
  extras: readonly string[]
  url: string
  expiresAt: Date
}

export function renderInvitationEmail(input: InvitationEmailInput): { subject: string; html: string; text: string } {
  const locale = invitationLocale(input.locale)
  const m = getInvitationMessages(locale)
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(input.expiresAt)
  const role = roleLabel(m, input.role)
  const extras = input.extras.length ? extrasLabel(m, input.extras) : ''
  const plain = { inviter: input.inviterName, place: input.placeName, role, date }
  const html = Object.fromEntries(Object.entries(plain).map(([k, v]) => [k, esc(v)]))

  const subject = fill(m.email.subject, plain)
  const lines = [
    fill(m.email.heading, plain),
    '',
    fill(m.email.body, plain),
    ...(extras ? [fill(m.accept.withExtras, { extras })] : []),
    '',
    `${m.email.button}: ${input.url}`,
    '',
    fill(m.email.expiry, plain),
    m.email.ignore,
    fill(m.email.replyHint, plain),
  ]
  const p = (s: string) => `<p style="margin:0 0 16px;line-height:1.5">${s}</p>`
  const htmlBody = `<!doctype html><html lang="${locale}"><body style="margin:0;padding:32px 16px;background:#f6f6f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1c1a">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
<h1 style="font-size:20px;font-weight:600;margin:0 0 20px">${fill(esc(m.email.heading), html)}</h1>
${p(fill(esc(m.email.body), html))}
${extras ? p(esc(fill(m.accept.withExtras, { extras }))) : ''}
<p style="margin:24px 0"><a href="${esc(input.url)}" style="display:inline-block;background:#1c1c1a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:500">${esc(m.email.button)}</a></p>
<p style="margin:0 0 4px;font-size:13px;color:#6b6b66">${esc(m.email.linkHint)}</p>
<p style="margin:0 0 24px;font-size:13px;word-break:break-all;color:#6b6b66">${esc(input.url)}</p>
<p style="margin:0 0 8px;font-size:13px;color:#6b6b66">${fill(esc(m.email.expiry), html)}</p>
<p style="margin:0 0 8px;font-size:13px;color:#6b6b66">${esc(m.email.ignore)}</p>
<p style="margin:0;font-size:13px;color:#6b6b66">${fill(esc(m.email.replyHint), html)}</p>
</div></body></html>`
  return { subject, html: htmlBody, text: lines.join('\n') }
}
