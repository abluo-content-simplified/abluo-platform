/**
 * Notification email templates — ADR-019.
 *
 * V1: an internal "new submission" alert to the form owner (NOT the visitor).
 * Code-owned + minimal; admin-editable templates are a later enhancement.
 * Pure (no I/O) so it is unit-testable.
 */

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
}

export function renderNewSubmissionEmail(input: NewSubmissionEmailInput): { subject: string; html: string; text: string } {
  const data = input.submissionData ?? {}
  const who = (data.name as string) || (data.email as string) || 'someone'
  const subject = `New ${input.topic} submission — ${who}`

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
    <h2 style="margin:0 0 4px;">New ${esc(input.topic)} submission</h2>
    <p style="margin:0 0 16px;color:#666;">A visitor completed and submitted the form${input.createdAt ? ` on ${esc(input.createdAt)}` : ''}.</p>
    <h3 style="margin:16px 0 4px;">Submission</h3>
    <table style="border-collapse:collapse;">${rows(dataRows)}</table>
    ${attribution.length ? `<h3 style="margin:16px 0 4px;">Attribution</h3><table style="border-collapse:collapse;">${rows(attribution)}</table>` : ''}
    <p style="margin:16px 0 0;color:#999;font-size:12px;">Submission ID: ${esc(input.submissionId)} · locale ${esc(input.locale)} · form ${esc(input.formId)}</p>
  </div>`.trim()

  const textLines = [
    `New ${input.topic} submission`,
    input.createdAt ? `Submitted: ${input.createdAt}` : '',
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
