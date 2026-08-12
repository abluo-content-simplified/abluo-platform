/**
 * Resend email channel — ADR-019 (first ChannelProvider).
 *
 * App-level transactional send via the Resend HTTP API (distinct from the
 * Supabase-SMTP path used for auth emails). Sends from the verified
 * mail.abluo.app domain, so it can reach any recipient.
 *
 * Env: RESEND_API_KEY (required to send). NOTIFY_FROM_EMAIL optional override.
 */
const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const FROM_ADDRESS = 'no-reply@mail.abluo.app'
const DEFAULT_FROM = `Abluo <${FROM_ADDRESS}>`

/** Strips characters that could break or inject into the From display name. */
function sanitizeDisplayName(name: string): string {
  return name.replace(/["<>\r\n]/g, '').trim()
}

export interface SendResult {
  ok: boolean
  id?: string
  error?: string
}

export async function sendEmail(params: {
  to: string[]
  subject: string
  html: string
  text?: string
  /** Tenant sender display name; composed onto the verified from-address. */
  fromName?: string
  /** Reply-To address (e.g. the submitter, so a reply reaches the lead). */
  replyTo?: string
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY is not configured' }
  if (!params.to.length) return { ok: false, error: 'no recipients' }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: params.fromName
          ? `${sanitizeDisplayName(params.fromName)} <${FROM_ADDRESS}>`
          : process.env.NOTIFY_FROM_EMAIL || DEFAULT_FROM,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
        ...(params.replyTo ? { reply_to: params.replyTo } : {}),
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `resend ${res.status}: ${body.slice(0, 300)}` }
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string }
    return { ok: true, id: data.id }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
