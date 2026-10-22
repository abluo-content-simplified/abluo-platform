/**
 * Announcements — notices Abluo writes in the admin (planned maintenance, a
 * known issue) and clients see as a banner on top of their dashboard between a
 * start and an end time (migration 045, ADR-030 follow-up).
 *
 * Pure and browser-safe, like `model.ts`: types, the active-window rule, the
 * dismissal rule, audience matching (the same model as product updates) and
 * input validation. The Supabase reads/writes live in `notices-feed.ts`
 * (client, own session + RLS) and `notices-admin.ts` (service role behind
 * requireAbluoAdmin).
 */
import {
  audienceModules,
  cleanLocalized,
  matchesAudience,
  pickLocalized,
  type LocalizedText,
  type ProductUpdateStatus,
  type WhatsNewLocale,
} from './model'

/** info: dismissible per person. warning: stays until it ends. */
export const NOTICE_TONES = ['info', 'warning'] as const
export type NoticeTone = (typeof NOTICE_TONES)[number]

/** A row of public.product_notices as Supabase returns it. */
export type NoticeRow = {
  id: string
  status: ProductUpdateStatus
  message: unknown
  tone: string
  starts_at: string
  ends_at: string
  audience: unknown
  created_at: string
  updated_at: string
}

export const NOTICE_COLUMNS = 'id, status, message, tone, starts_at, ends_at, audience, created_at, updated_at'

export const NOTICE_LIMITS = {
  message: 400,
  /** Notices a client sees at most. */
  feed: 10,
} as const

const isTone = (t: unknown): t is NoticeTone => (NOTICE_TONES as readonly unknown[]).includes(t)

const time = (iso: string | null | undefined): number => {
  const n = iso ? Date.parse(iso) : NaN
  return Number.isFinite(n) ? n : NaN
}

/** Between start (inclusive) and end (exclusive). Unparseable dates are never active. */
export function isNoticeActive(startsAt: string, endsAt: string, now: number): boolean {
  const start = time(startsAt)
  const end = time(endsAt)
  return Number.isFinite(start) && Number.isFinite(end) && start <= now && now < end
}

/** Only info notices can be closed; a warning stays until it ends. */
export function isNoticeDismissible(tone: NoticeTone): boolean {
  return tone === 'info'
}

/** What the banner renders: already in the viewer's language. */
export type ClientNotice = {
  id: string
  message: string
  lang: WhatsNewLocale
  tone: NoticeTone
  startsAt: string
  endsAt: string
  dismissible: boolean
}

/**
 * Published rows → the notices one viewer on one project sees right now:
 * published, inside their window, audience-matched, with a message, and not
 * dismissed (a dismissal only counts for info; a warning is always shown).
 * Warnings first, then the most recently started.
 */
export function buildClientNotices(
  rows: readonly NoticeRow[],
  opts: { locale: string; enabledModuleIds: readonly string[]; dismissedIds: ReadonlySet<string>; now: number },
): ClientNotice[] {
  const out: ClientNotice[] = []
  for (const row of rows) {
    if (row.status !== 'published') continue
    if (!isNoticeActive(row.starts_at, row.ends_at, opts.now)) continue
    if (!matchesAudience(row.audience, opts.enabledModuleIds)) continue
    const message = pickLocalized(row.message, opts.locale)
    if (!message) continue
    const tone: NoticeTone = isTone(row.tone) ? row.tone : 'info'
    const dismissible = isNoticeDismissible(tone)
    if (dismissible && opts.dismissedIds.has(row.id)) continue
    out.push({
      id: row.id,
      message: message.text,
      lang: message.locale,
      tone,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      dismissible,
    })
  }
  return out.sort((a, b) => {
    if (a.tone !== b.tone) return a.tone === 'warning' ? -1 : 1
    return time(b.startsAt) - time(a.startsAt)
  })
}

/** The same rule applied again in the browser (the banner ends without a reload). */
export function stillActive(notices: readonly ClientNotice[], now: number, dismissedNow: ReadonlySet<string> = new Set()): ClientNotice[] {
  return notices.filter((n) => isNoticeActive(n.startsAt, n.endsAt, now) && !(n.dismissible && dismissedNow.has(n.id)))
}

// ── Admin input ──────────────────────────────────────────────────────────────

export type NoticeInput = {
  message: LocalizedText
  tone: NoticeTone
  /** UTC ISO strings, or null while empty. */
  startsAt: string | null
  endsAt: string | null
  modules: string[]
}

export type NoticeError =
  | 'messageRequired'
  | 'messageTooLong'
  | 'toneInvalid'
  | 'startRequired'
  | 'endRequired'
  | 'endBeforeStart'
  | 'endInPast'
  | 'unknownModule'

export type NoticeValues = {
  message: LocalizedText
  tone: NoticeTone
  starts_at: string
  ends_at: string
  audience: { modules?: string[] }
}

/**
 * Validate and normalise what the admin typed. Errors are codes (the admin UI
 * translates them). A message in at least one language; a start and an end,
 * the end after the start; when publishing, the end must still be ahead.
 */
export function validateNotice(
  input: NoticeInput,
  opts: { knownModules: readonly string[]; publishing: boolean; now: number },
): { ok: true; values: NoticeValues } | { ok: false; errors: NoticeError[] } {
  const errors: NoticeError[] = []
  const message = cleanLocalized(input.message)
  if (Object.keys(message).length === 0) errors.push('messageRequired')
  if (Object.values(message).some((v) => (v ?? '').length > NOTICE_LIMITS.message)) errors.push('messageTooLong')
  if (!isTone(input.tone)) errors.push('toneInvalid')

  const start = time(input.startsAt)
  const end = time(input.endsAt)
  if (!Number.isFinite(start)) errors.push('startRequired')
  if (!Number.isFinite(end)) errors.push('endRequired')
  if (Number.isFinite(start) && Number.isFinite(end)) {
    if (end <= start) errors.push('endBeforeStart')
    else if (opts.publishing && end <= opts.now) errors.push('endInPast')
  }

  const modules = audienceModules({ modules: input.modules })
  if (modules.some((m) => !opts.knownModules.includes(m))) errors.push('unknownModule')

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    values: {
      message,
      tone: input.tone,
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(end).toISOString(),
      audience: modules.length ? { modules } : {},
    },
  }
}

export function nextNoticeStatus(intent: 'save' | 'publish' | 'archive' | 'draft', current: ProductUpdateStatus | null): ProductUpdateStatus {
  switch (intent) {
    case 'publish':
      return 'published'
    case 'archive':
      return 'archived'
    case 'draft':
      return 'draft'
    case 'save':
      return current ?? 'draft'
  }
}
