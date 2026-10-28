/**
 * Form notifications on the client dashboard's Settings page (Tom, 2026-10-28)
 * — the pure, browser-safe half: limits, email checks, labels, the add/remove
 * rules. The server half (reads, writes, audit, notice email) is
 * `./form-recipients-service.ts`.
 *
 * Data model (ADR-019, unchanged): the Sanity `project` document holds
 * `notifications.recipients[]` = `{ _key, topic, emails[], enabled }`, one
 * group per topic ("all" or blank = every form). Sending reads it at send time
 * (`./recipients.ts`), so a change here applies to the next message. An empty
 * `emails` list is allowed by the model and means "no email at all" for that
 * topic — the page warns before the last address goes.
 */

/** Per topic. No existing platform limit, so the agreed default. */
export const MAX_RECIPIENTS_PER_TOPIC = 5
/** RFC 5321 path limit. */
export const MAX_EMAIL_LENGTH = 254

/** The topic that matches every form (blank means the same, see recipients.ts). */
export const ALL_FORMS_TOPIC = 'all'

// Same shape as the forms' own email check (lib/forms/definitions.ts EMAIL_RE),
// and additionally refuses characters that could break a mail header or list.
const EMAIL_RE = /^[^\s@,;<>"'()[\]\\]+@[^\s@,;<>"'()[\]\\]+\.[^\s@,;<>"'()[\]\\]+$/

/** Trimmed and lowercased when it looks like one email address; null otherwise. */
export function normalizeRecipientEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const e = value.trim().toLowerCase()
  if (!e || e.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(e)) return null
  return e
}

export const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export type RecipientChangeError = 'invalid_email' | 'duplicate' | 'too_many' | 'not_found'

export type RecipientChange =
  | { ok: true; emails: string[]; email: string }
  | { ok: false; error: RecipientChangeError }

/** Adds one address to a topic's list (stored lowercased, like sending reads it). */
export function addRecipient(current: readonly string[], value: unknown): RecipientChange {
  const email = normalizeRecipientEmail(value)
  if (!email) return { ok: false, error: 'invalid_email' }
  if (current.some((e) => sameEmail(e, email))) return { ok: false, error: 'duplicate' }
  if (current.length >= MAX_RECIPIENTS_PER_TOPIC) return { ok: false, error: 'too_many' }
  return { ok: true, emails: [...current, email], email }
}

/** Removes one address (every spelling of it). Removing the last one is allowed: the page asks first. */
export function removeRecipient(current: readonly string[], value: unknown): RecipientChange {
  if (typeof value !== 'string' || !value.trim()) return { ok: false, error: 'not_found' }
  const next = current.filter((e) => !sameEmail(e, value))
  if (next.length === current.length) return { ok: false, error: 'not_found' }
  return { ok: true, emails: next, email: value.trim().toLowerCase() }
}

export const isAllFormsTopic = (topic: string | null | undefined) => !topic || topic === ALL_FORMS_TOPIC

/** "book-recommendation" → "Book recommendation": the label when no form names the topic. */
export function humanizeTopic(topic: string): string {
  const words = topic.replace(/[-_]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : topic
}

/** A localized title (`{ en, it, … }`) in the wanted language, else the site's, else English, else any. */
export function pickLocalized(value: unknown, locales: readonly string[]): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  for (const l of [...locales, 'en']) if (typeof v[l] === 'string' && (v[l] as string).trim()) return (v[l] as string).trim()
  for (const [k, s] of Object.entries(v)) if (!k.startsWith('_') && k !== 'translationStatus' && typeof s === 'string' && s.trim()) return s.trim()
  return null
}

export type FormForLabel = { formId?: string | null; notificationTopic?: string | null; title?: unknown }

/**
 * The human name of a topic: the title of the form(s) that send under it
 * (a form's topic is its `notificationTopic`, else its form id — same rule as
 * sending), else the topic made readable. Null for the every-form group (the
 * page has its own wording for it).
 */
export function topicLabel(topic: string | null | undefined, forms: readonly FormForLabel[], locales: readonly string[]): string | null {
  if (isAllFormsTopic(topic)) return null
  const titles: string[] = []
  for (const f of forms) {
    if ((f.notificationTopic || f.formId) !== topic) continue
    const title = pickLocalized(f.title, locales)
    if (title && !titles.includes(title)) titles.push(title)
  }
  return titles.length ? titles.join(', ') : humanizeTopic(topic as string)
}
