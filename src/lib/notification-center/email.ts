/**
 * The digest email (ADR-050 D11). Pure: language choice and rendering. It
 * never takes a subject line, a message or a file — the input has no field for
 * them — so nothing written in a conversation can reach an inbox. Texts from
 * messages/{locale}.json → `notificationEmail`.
 */
import en from '../../../messages/en.json'
import it from '../../../messages/it.json'
import de from '../../../messages/de.json'
import fr from '../../../messages/fr.json'
import { withEnglishFallback } from '@/lib/i18n/with-fallback'

export type DigestLocale = 'en' | 'it' | 'de' | 'fr'
const BY_LOCALE = { en: en.notificationEmail, it: it.notificationEmail, de: de.notificationEmail, fr: withEnglishFallback(en.notificationEmail, (fr as Record<string, unknown>).notificationEmail) } as const

export const ADMIN_ORIGIN = 'https://admin.abluo.app'
export const CLIENT_ORIGIN = 'https://abluo.app'

export function digestLocale(profileLocale: unknown, projectLocale?: unknown): DigestLocale {
  for (const v of [profileLocale, projectLocale]) {
    const two = typeof v === 'string' ? v.slice(0, 2).toLowerCase() : ''
    if (two === 'en' || two === 'it' || two === 'de' || two === 'fr') return two
  }
  return 'en'
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const fill = (t: string, vars: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m))

export function renderDigest(input: { locale: DigestLocale; count: number; url: string }): { subject: string; html: string; text: string } {
  const m = BY_LOCALE[input.locale]
  const t = input.count === 1 ? m.one : m.other
  const vars = { count: String(input.count) }
  const subject = fill(t.subject, vars)
  const heading = fill(t.heading, vars)
  const text = [heading, '', m.body, '', `${m.button}: ${input.url}`, '', m.privacy].join('\n')
  const html = `<!doctype html><html lang="${input.locale}"><body style="margin:0;padding:32px 16px;background:#f6f6f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1c1a">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
<h1 style="font-size:20px;font-weight:600;margin:0 0 20px">${esc(heading)}</h1>
<p style="margin:0 0 16px;line-height:1.5">${esc(m.body)}</p>
<p style="margin:24px 0"><a href="${esc(input.url)}" style="display:inline-block;background:#1c1c1a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:500">${esc(m.button)}</a></p>
<p style="margin:0 0 4px;font-size:13px;color:#6b6b66">${esc(m.linkHint)}</p>
<p style="margin:0 0 24px;font-size:13px;word-break:break-all;color:#6b6b66">${esc(input.url)}</p>
<p style="margin:0;font-size:13px;color:#6b6b66">${esc(m.privacy)}</p>
</div></body></html>`
  return { subject, html, text }
}
