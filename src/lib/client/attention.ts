/**
 * "Needs your attention" on the dashboard Home (ADR-029 §3.3).
 *
 * Pure rules: each takes plain data a dashboard provider already read and
 * returns at most one item (counts are aggregated, so the list stays short
 * and calm). Rules never fetch. Each rule is gated by its own requirement
 * through the same check the tenant-surface registry uses (`surfaceAllowed`),
 * so a person never sees an item about something they cannot open or fix.
 *
 * Copy lives under `clientDashboard.home.attention.<rule>.{title,detail,action}`;
 * `params` fill the ICU placeholders.
 */
import { surfaceAllowed, type SurfaceGrant, type SurfaceRequirement } from '@/lib/client/surfaces'

export type AttentionSeverity = 'info' | 'warn'

export type AttentionItem = {
  /** Stable id (rule id, plus a suffix when a rule can yield two items). */
  id: string
  severity: AttentionSeverity
  /** Key under `clientDashboard.home` — the row's title. */
  titleKey: string
  /** Key under `clientDashboard.home` — the one-line detail. */
  detailKey: string
  /** Key under `clientDashboard.home` — the action link's label. */
  actionKey: string
  params: Record<string, string | number>
  href: string
}

/** A draft nobody touched for this many days is "waiting". */
export const STALE_DRAFT_DAYS = 14
/** A scheduled post going live within this many hours is worth a heads-up. */
export const SCHEDULED_SOON_HOURS = 48
/** A new contact request left unanswered longer than this turns the item to `warn`. */
export const REQUEST_WAITING_HOURS = 48
/** Rows shown before "Show N more". */
export const ATTENTION_MAX_SHOWN = 5

const HOUR_MS = 3600 * 1000
const DAY_MS = 24 * HOUR_MS

export type AttentionRuleId =
  | 'newRequests'
  | 'stalePostDrafts'
  | 'staleGalleryDrafts'
  | 'scheduledSoon'
  | 'missingLanguage'
  | 'missingAltText'
  | 'pendingInvites'

/** Who may see each rule's item. Same vocabulary as the surface registry. */
export const ATTENTION_RULES: Readonly<Record<AttentionRuleId, SurfaceRequirement>> = {
  newRequests: { module: 'forms', permission: 'forms.submission.read' },
  stalePostDrafts: { module: 'blog', permission: 'blog.post.write' },
  staleGalleryDrafts: { module: 'gallery', permission: 'gallery.gallery.write' },
  scheduledSoon: { module: 'blog', permission: 'blog.post.read' },
  missingLanguage: { module: 'blog', permission: 'blog.post.write' },
  missingAltText: { permission: 'media.library.manage' },
  pendingInvites: { anyPermission: ['users.invite', 'users.manage'] },
}

/** The rules this grant may see. Empty → Home leaves the attention block out. */
export function allowedAttentionRules(grant: SurfaceGrant): Set<AttentionRuleId> {
  return new Set(
    (Object.keys(ATTENTION_RULES) as AttentionRuleId[]).filter((id) => surfaceAllowed(grant, ATTENTION_RULES[id])),
  )
}

const keys = (rule: string) => ({
  titleKey: `attention.${rule}.title`,
  detailKey: `attention.${rule}.detail`,
  actionKey: `attention.${rule}.action`,
})

const time = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN)

/** New contact requests nobody has handled yet. `warn` once one has waited too long. */
export function newRequestsRule(
  rows: readonly { status: string; createdAt: string }[],
  href: string,
  now = Date.now(),
): AttentionItem | null {
  const open = rows.filter((r) => r.status === 'new')
  if (!open.length) return null
  const waiting = open.some((r) => now - time(r.createdAt) > REQUEST_WAITING_HOURS * HOUR_MS)
  return {
    id: 'newRequests',
    severity: waiting ? 'warn' : 'info',
    ...keys(waiting ? 'newRequestsWaiting' : 'newRequests'),
    params: { count: open.length, days: REQUEST_WAITING_HOURS / 24 },
    href,
  }
}

/** Drafts (posts or galleries) untouched for STALE_DRAFT_DAYS or more. Oldest first names the example. */
export function staleDraftsRule(
  kind: 'post' | 'gallery',
  drafts: readonly { updatedAt: string; title: string }[],
  href: string,
  now = Date.now(),
): AttentionItem | null {
  const stale = drafts
    .filter((d) => {
      const at = time(d.updatedAt)
      return !Number.isNaN(at) && now - at >= STALE_DRAFT_DAYS * DAY_MS
    })
    .sort((a, b) => time(a.updatedAt) - time(b.updatedAt))
  if (!stale.length) return null
  const rule = kind === 'post' ? 'stalePostDrafts' : 'staleGalleryDrafts'
  return { id: rule, severity: 'info', ...keys(rule), params: { count: stale.length, title: stale[0].title, days: STALE_DRAFT_DAYS }, href }
}

/** Posts going live within SCHEDULED_SOON_HOURS. `when` formats the soonest one ("in 5 hr."). */
export function scheduledSoonRule(
  posts: readonly { status: string; publishedAt?: string | null; title: string }[],
  href: string,
  when: (iso: string) => string,
  now = Date.now(),
): AttentionItem | null {
  const soon = posts
    .filter((p) => {
      if (p.status !== 'scheduled') return false
      const at = time(p.publishedAt)
      return !Number.isNaN(at) && at > now && at - now <= SCHEDULED_SOON_HOURS * HOUR_MS
    })
    .sort((a, b) => time(a.publishedAt) - time(b.publishedAt))
  if (!soon.length) return null
  return {
    id: 'scheduledSoon',
    severity: 'info',
    ...keys('scheduledSoon'),
    params: { count: soon.length, title: soon[0].title, when: when(soon[0].publishedAt!) },
    href,
  }
}

/**
 * Live posts that lack title + body in one of the site's languages. Only on
 * multilingual sites (`siteLanguages` has two or more).
 */
export function missingLanguageRule(
  posts: readonly { status: string; completeLanguages: readonly string[]; title: string }[],
  siteLanguages: readonly string[],
  href: string,
): AttentionItem | null {
  if (siteLanguages.length < 2) return null
  const missing = posts.filter((p) => p.status === 'published' && siteLanguages.some((l) => !p.completeLanguages.includes(l)))
  if (!missing.length) return null
  return { id: 'missingLanguage', severity: 'info', ...keys('missingLanguage'), params: { count: missing.length, title: missing[0].title }, href }
}

/** Photos without a description (alt text) in the site's main language. */
export function missingAltTextRule(count: number, href: string): AttentionItem | null {
  if (count <= 0) return null
  return { id: 'missingAltText', severity: 'info', ...keys('missingAltText'), params: { count }, href }
}

/** Invitations still waiting to be accepted (info) and ones that ran out (warn). */
export function invitationRules(people: readonly { status: string }[], href: string): AttentionItem[] {
  const pending = people.filter((p) => p.status === 'invited').length
  const expired = people.filter((p) => p.status === 'expired').length
  const out: AttentionItem[] = []
  if (expired) out.push({ id: 'expiredInvites', severity: 'warn', ...keys('expiredInvites'), params: { count: expired }, href })
  if (pending) out.push({ id: 'pendingInvites', severity: 'info', ...keys('pendingInvites'), params: { count: pending }, href })
  return out
}

/** `warn` before `info`; otherwise the order the rules were given in. Drops nulls. */
export function sortAttention(items: readonly (AttentionItem | null | undefined)[]): AttentionItem[] {
  const list = items.filter((i): i is AttentionItem => !!i)
  return list
    .map((item, n) => ({ item, n }))
    .sort((a, b) => (a.item.severity === b.item.severity ? a.n - b.n : a.item.severity === 'warn' ? -1 : 1))
    .map((x) => x.item)
}

/** The rows to show now and how many wait behind "Show N more". */
export function splitAttention<T>(items: readonly T[], max = ATTENTION_MAX_SHOWN): { shown: T[]; more: number } {
  // Showing "1 more" instead of the row itself would be silly: show it.
  if (items.length <= max + 1) return { shown: [...items], more: 0 }
  return { shown: items.slice(0, max), more: items.length - max }
}
