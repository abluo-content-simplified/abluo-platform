/**
 * Pure helpers for NotificationsPane (Project Settings > Notifications).
 * Shape mirrors `project.notifications` in schema.ts; readers live in
 * src/lib/notifications (recipients.ts, branding.ts) and must stay compatible.
 */

export interface RecipientGroup {
  _key: string
  topic: string
  /** One email per entry, as the schema's `emails: string[]`. */
  emails: string[]
  enabled: boolean
}

export interface InternalEmailForm {
  fromName: string
  subjectTemplate: string
  /** locale code -> text */
  intro: Record<string, string>
  replyToSubmitter: boolean
}

export interface NotificationsForm {
  recipients: RecipientGroup[]
  internalEmail: InternalEmailForm
}

/** Raw stored shape (everything optional). */
export interface StoredNotifications {
  recipients?: Array<{ _key?: string; topic?: string; emails?: string[]; enabled?: boolean; [other: string]: unknown }>
  internalEmail?: {
    fromName?: string
    subjectTemplate?: string
    intro?: Record<string, unknown>
    replyToSubmitter?: boolean
  }
}

/** A language code key of a localized object ('en', 'pt-BR'); `_type`, `translationStatus` and the like are not. */
export function isLocaleKey(key: string): boolean {
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(key)
}

let keyCounter = 0
export function newKey(): string {
  keyCounter += 1
  return `k${Date.now().toString(36)}${keyCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function newRecipientGroup(): RecipientGroup {
  // Schema defaults: topic 'all', enabled true.
  return { _key: newKey(), topic: 'all', emails: [], enabled: true }
}

/** Stored doc -> editable form. Schema defaults: replyToSubmitter true, enabled true. */
export function toForm(stored: StoredNotifications | null | undefined): NotificationsForm {
  const intro: Record<string, string> = {}
  for (const [k, v] of Object.entries(stored?.internalEmail?.intro ?? {})) {
    if (isLocaleKey(k) && typeof v === 'string') intro[k] = v
  }
  return {
    recipients: (stored?.recipients ?? []).map((r) => ({
      _key: r._key || newKey(),
      topic: r.topic ?? 'all',
      emails: Array.isArray(r.emails) ? r.emails.filter((e): e is string => typeof e === 'string') : [],
      enabled: r.enabled !== false,
    })),
    internalEmail: {
      fromName: stored?.internalEmail?.fromName ?? '',
      subjectTemplate: stored?.internalEmail?.subjectTemplate ?? '',
      intro,
      replyToSubmitter: stored?.internalEmail?.replyToSubmitter !== false,
    },
  }
}

/** Split a free-text box ("a@x.com, b@y.com\nc@z.com") into trimmed, de-duplicated emails. */
export function parseEmails(text: string): string[] {
  const out: string[] = []
  for (const part of text.split(/[\s,;]+/)) {
    const e = part.trim()
    if (e && !out.some((x) => x.toLowerCase() === e.toLowerCase())) out.push(e)
  }
  return out
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function invalidEmails(emails: string[]): string[] {
  return emails.filter((e) => !EMAIL_RE.test(e))
}

/**
 * Editable form -> value to store at `notifications`. Merges over the stored
 * object so unknown keys (e.g. intro.translationStatus) survive. Empty strings
 * are dropped so "empty = default" holds (ADR-019 Amendment A).
 */
export function toStored(form: NotificationsForm, previous?: StoredNotifications | null): Record<string, unknown> {
  const prevIntro = (previous?.internalEmail?.intro ?? {}) as Record<string, unknown>
  const intro: Record<string, unknown> = { ...prevIntro }
  for (const [code, text] of Object.entries(form.internalEmail.intro)) {
    const t = text.trim()
    if (t) intro[code] = t
    else delete intro[code]
  }
  // Drop the localized object entirely when no text remains.
  const hasText = Object.entries(intro).some(([k, v]) => isLocaleKey(k) && typeof v === 'string' && v)
  const internalEmail: Record<string, unknown> = { ...(previous?.internalEmail ?? {}) }
  const setOrDrop = (key: string, value: string) => {
    const v = value.trim()
    if (v) internalEmail[key] = v
    else delete internalEmail[key]
  }
  setOrDrop('fromName', form.internalEmail.fromName)
  setOrDrop('subjectTemplate', form.internalEmail.subjectTemplate)
  if (hasText) internalEmail.intro = { ...intro, _type: 'localizedText' }
  else delete internalEmail.intro
  internalEmail.replyToSubmitter = form.internalEmail.replyToSubmitter

  return {
    ...(previous ?? {}),
    recipients: form.recipients.map((r) => ({
      // Unknown keys of a stored recipient survive (matched by _key).
      ...((previous?.recipients ?? []).find((p) => p._key === r._key) ?? {}),
      _key: r._key,
      topic: r.topic.trim() || 'all',
      emails: r.emails,
      enabled: r.enabled,
    })),
    internalEmail,
  }
}

export interface NotificationsPatchPlan {
  id: string
  /** Set only on the published document: the save fails when it changed since it was loaded. */
  ifRevisionId?: string
  set: { notifications: Record<string, unknown> }
}

/**
 * The patches of one save: the published project (guarded by the loaded revision) and, when a draft of it
 * exists, the same `notifications` value on the draft, so publishing that draft later cannot bring back old values.
 */
export function notificationsPatchPlan(projectId: string, revision: string | null, draftExists: boolean, next: Record<string, unknown>): NotificationsPatchPlan[] {
  const plan: NotificationsPatchPlan[] = [{ id: projectId, ...(revision ? { ifRevisionId: revision } : {}), set: { notifications: next } }]
  if (draftExists) plan.push({ id: `drafts.${projectId}`, set: { notifications: next } })
  return plan
}

/** Did a commit fail because the document changed (Sanity answers 409 / "revision ID mismatch")? */
export function isRevisionConflict(error: unknown): boolean {
  const e = error as { statusCode?: number; response?: { statusCode?: number }; message?: string } | null
  return e?.statusCode === 409 || e?.response?.statusCode === 409 || /revision/i.test(e?.message ?? '')
}
