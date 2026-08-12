/**
 * Notification email templates — ADR-019.
 *
 * V1: an internal "new submission" alert to the form owner (NOT the visitor).
 * Code-owned + minimal; admin-editable templates are a later enhancement.
 * Pure (no I/O) so it is unit-testable.
 */

export const DEFAULT_SUBJECT_TEMPLATE = 'New {topic} submission — {who}'

/** Renders a subject from a template with {topic}/{who}/{formId} tokens (default when unset). */
export function renderSubject(
  template: string | undefined,
  tokens: { topic: string; who: string; formId: string },
): string {
  const t = (template && template.trim()) || DEFAULT_SUBJECT_TEMPLATE
  return t
    .replace(/\{topic\}/g, tokens.topic)
    .replace(/\{who\}/g, tokens.who)
    .replace(/\{formId\}/g, tokens.formId)
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function flatten(data: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(data ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v ?? '')])
}

export interface NewSubmissionEmailInput {
  formId: string
  topic: string
  locale: string
  submissionId: string
  submissionData: Record<string, unknown>
  source: Record<string, unknown>
  createdAt?: string | null
  // ── Personalization (ADR-019 Amendment A) — all optional ──
  /** Tenant sender display name, shown as a brand line above the heading. */
  fromName?: string
  /** Localized intro line under the heading (replaces the default sentence). */
  intro?: string
  /** Subject template with {topic}/{who}/{formId} tokens; default when unset. */
  subjectTemplate?: string
  /** Tenant logo URL (https CDN) shown at the top of the email. */
  logoUrl?: string
}

export function renderNewSubmissionEmail(input: NewSubmissionEmailInput): { subject: string; html: string; text: string } {
  const data = input.submissionData ?? {}
  const who = (data.name as string) || (data.email as string) || 'someone'
  const subject = renderSubject(input.subjectTemplate, { topic: input.topic, who, formId: input.formId })

  const dataRows = flatten(data)
  // Surface the marketing/attribution highlights from source.
  const src = input.source ?? {}
  const attribution: Array<[string, string]> = [
    ['UTM source', src.utm_source as string],
    ['UTM medium', src.utm_medium as string],
    ['UTM campaign', src.utm_campaign as string],
    ['Referrer', (src.referrer as string) || (src.referrer_domain as string)],
    ['Page', src.page_url as string],
    ['Country', src.country as string],
    ['Entry point', src.source as string],
  ].filter(([, v]) => v) as Array<[string, string]>

  const rows = (pairs: Array<[string, string]>) =>
    pairs
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top;">${esc(k)}</td><td style="padding:4px 0;">${esc(v)}</td></tr>`,
      )
      .join('')

  const html = `
  <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px;color:#111;max-width:640px;">
    ${input.logoUrl && /^https:\/\//.test(input.logoUrl) ? `<img src="${esc(input.logoUrl)}" alt="${esc(input.fromName ?? '')}" style="max-height:36px;margin:0 0 12px;display:block;border:0;" />` : ''}
    ${input.fromName ? `<p style="margin:0 0 8px;font-weight:600;font-size:15px;">${esc(input.fromName)}</p>` : ''}
    <h2 style="margin:0 0 4px;">New ${esc(input.topic)} submission</h2>
    <p style="margin:0 0 16px;color:#666;">${input.intro ? esc(input.intro) : `A visitor completed and submitted the form${input.createdAt ? ` on ${esc(input.createdAt)}` : ''}.`}</p>
    <h3 style="margin:16px 0 4px;">Submission</h3>
    <table style="border-collapse:collapse;">${rows(dataRows)}</table>
    ${attribution.length ? `<h3 style="margin:16px 0 4px;">Attribution</h3><table style="border-collapse:collapse;">${rows(attribution)}</table>` : ''}
    <p style="margin:16px 0 0;color:#999;font-size:12px;">Submission ID: ${esc(input.submissionId)} · locale ${esc(input.locale)} · form ${esc(input.formId)}</p>
  </div>`.trim()

  const textLines = [
    input.fromName ? input.fromName : '',
    `New ${input.topic} submission`,
    input.intro ? input.intro : (input.createdAt ? `Submitted: ${input.createdAt}` : ''),
    '',
    'Submission:',
    ...dataRows.map(([k, v]) => `  ${k}: ${v}`),
    attribution.length ? '\nAttribution:' : '',
    ...attribution.map(([k, v]) => `  ${k}: ${v}`),
    '',
    `Submission ID: ${input.submissionId} · locale ${input.locale} · form ${input.formId}`,
  ].filter((l) => l !== '')

  return { subject, html, text: textLines.join('\n') }
}
