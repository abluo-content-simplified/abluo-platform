/**
 * Admin Home — "Needs your attention" across every project (ADR-030 §5.1).
 *
 * Pure rules over data the admin providers already read (Supabase only, no
 * per-project Sanity reads, so Home stays fast). Each rule never fetches.
 * Items link to the admin project page. Copy lives under
 * `admin.home.attention.<rule>.{title,detail,action}`; `params` fill the
 * ICU placeholders. Severity uses the shared AttentionList vocabulary.
 */
import type { AttentionSeverity } from '@/lib/client/attention'

export type AdminAttentionRuleId = 'noOwner' | 'requestsWaiting' | 'invitationExpired' | 'invitationExpiring' | 'longPreview'

export type AdminAttentionItem = {
  id: string
  rule: AdminAttentionRuleId
  severity: AttentionSeverity
  /** Keys under `admin.home`. */
  titleKey: string
  detailKey: string
  actionKey: string
  params: Record<string, string | number>
  href: string
}

const HOUR_MS = 3600 * 1000
const DAY_MS = 24 * HOUR_MS

/** An invitation expiring within this many days is worth a heads-up. */
export const INVITATION_EXPIRING_DAYS = 3
/** Expired invitations older than this are no longer listed (they would pile up forever). */
export const INVITATION_EXPIRED_LOOKBACK_DAYS = 30
/** A project in preview for longer than this (since it was created) is flagged. */
export const LONG_PREVIEW_DAYS = 14
/** A new contact request unanswered for longer than this is flagged. */
export const REQUEST_WAITING_HOURS = 48

/** Rule priority inside a severity (lower first). */
const RULE_ORDER: Record<AdminAttentionRuleId, number> = {
  noOwner: 0,
  requestsWaiting: 1,
  invitationExpired: 2,
  invitationExpiring: 3,
  longPreview: 4,
}

const keys = (rule: AdminAttentionRuleId) => ({
  titleKey: `attention.${rule}.title`,
  detailKey: `attention.${rule}.detail`,
  actionKey: `attention.${rule}.action`,
})

/** The admin project page for a slug. */
export const adminProjectHref = (slug: string) => `/projects/${encodeURIComponent(slug)}`

export type AttentionProject = {
  id: string
  slug: string
  name: string
  status: string
  createdAt: string
  ownerCount: number
}

/** Projects nobody owns (no Owner on their client): nobody can manage them. Retired projects are skipped. */
export function noOwnerRule(projects: readonly AttentionProject[]): AdminAttentionItem[] {
  return projects
    .filter((p) => p.status !== 'inactive' && p.ownerCount === 0)
    .map((p) => ({
      id: `noOwner:${p.id}`,
      rule: 'noOwner' as const,
      severity: 'warn' as const,
      ...keys('noOwner'),
      params: { project: p.name },
      href: adminProjectHref(p.slug),
    }))
}

/** Preview projects that have not gone live LONG_PREVIEW_DAYS after they were created. */
export function longPreviewRule(projects: readonly AttentionProject[], now = Date.now()): AdminAttentionItem[] {
  return projects
    .filter((p) => p.status === 'preview')
    .map((p) => ({ p, days: Math.floor((now - Date.parse(p.createdAt)) / DAY_MS) }))
    .filter(({ days }) => Number.isFinite(days) && days > LONG_PREVIEW_DAYS)
    .map(({ p, days }) => ({
      id: `longPreview:${p.id}`,
      rule: 'longPreview' as const,
      severity: 'info' as const,
      ...keys('longPreview'),
      params: { project: p.name, days },
      href: adminProjectHref(p.slug),
    }))
}

export type AttentionInvitation = {
  id: string
  email: string
  expiresAt: string
  /** The project the invitation leads to (a client-wide invitation: one of the client's projects), or null. */
  target: { slug: string; name: string } | null
}

/** Open invitations that expired recently or expire within INVITATION_EXPIRING_DAYS. One item each. */
export function invitationRules(invitations: readonly AttentionInvitation[], now = Date.now()): AdminAttentionItem[] {
  const out: AdminAttentionItem[] = []
  for (const i of invitations) {
    const at = Date.parse(i.expiresAt)
    if (Number.isNaN(at)) continue
    const href = i.target ? adminProjectHref(i.target.slug) : '/projects'
    const project = i.target?.name ?? '—'
    if (at <= now) {
      if (now - at > INVITATION_EXPIRED_LOOKBACK_DAYS * DAY_MS) continue
      out.push({
        id: `invitationExpired:${i.id}`,
        rule: 'invitationExpired',
        severity: 'warn',
        ...keys('invitationExpired'),
        params: { email: i.email, project, days: Math.max(0, Math.floor((now - at) / DAY_MS)) },
        href,
      })
    } else if (at - now <= INVITATION_EXPIRING_DAYS * DAY_MS) {
      out.push({
        id: `invitationExpiring:${i.id}`,
        rule: 'invitationExpiring',
        severity: 'info',
        ...keys('invitationExpiring'),
        params: { email: i.email, project, days: Math.max(0, Math.ceil((at - now) / DAY_MS)) },
        href,
      })
    }
  }
  return out
}

export type AttentionRequest = { projectId: string; createdAt: string }

/**
 * Contact requests still "new" after REQUEST_WAITING_HOURS — one item per
 * project with how many and how long the oldest has waited. `requests` are
 * the unanswered (status "new") requests only.
 */
export function requestsWaitingRule(
  requests: readonly AttentionRequest[],
  projects: readonly Pick<AttentionProject, 'id' | 'slug' | 'name'>[],
  now = Date.now(),
): AdminAttentionItem[] {
  const byId = new Map(projects.map((p) => [p.id, p]))
  const waiting = new Map<string, { count: number; oldest: number }>()
  for (const r of requests) {
    const at = Date.parse(r.createdAt)
    if (Number.isNaN(at) || now - at <= REQUEST_WAITING_HOURS * HOUR_MS) continue
    const w = waiting.get(r.projectId) ?? { count: 0, oldest: at }
    w.count++
    w.oldest = Math.min(w.oldest, at)
    waiting.set(r.projectId, w)
  }
  const out: AdminAttentionItem[] = []
  for (const [projectId, w] of waiting) {
    const p = byId.get(projectId)
    if (!p) continue
    out.push({
      id: `requestsWaiting:${projectId}`,
      rule: 'requestsWaiting',
      severity: 'warn',
      ...keys('requestsWaiting'),
      params: { project: p.name, count: w.count, days: Math.floor((now - w.oldest) / DAY_MS) },
      href: adminProjectHref(p.slug),
    })
  }
  return out
}

/** warn before info, then rule priority, then the id (stable). */
export function sortAdminAttention(items: readonly AdminAttentionItem[]): AdminAttentionItem[] {
  return [...items].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'warn' ? -1 : 1
    if (a.rule !== b.rule) return RULE_ORDER[a.rule] - RULE_ORDER[b.rule]
    return a.id.localeCompare(b.id)
  })
}

/** Every rule at once, sorted. */
export function buildAdminAttention(
  input: { projects: readonly AttentionProject[]; invitations: readonly AttentionInvitation[] | null; requests: readonly AttentionRequest[] | null },
  now = Date.now(),
): AdminAttentionItem[] {
  return sortAdminAttention([
    ...noOwnerRule(input.projects),
    ...(input.requests ? requestsWaitingRule(input.requests, input.projects, now) : []),
    ...(input.invitations ? invitationRules(input.invitations, now) : []),
    ...longPreviewRule(input.projects, now),
  ])
}

/** Unanswered requests: in total, and the ones that arrived in the last 7 days. */
export function unansweredRequestCounts(requests: readonly Pick<AttentionRequest, 'createdAt'>[], now = Date.now()): { total: number; week: number } {
  const since = now - 7 * DAY_MS
  return { total: requests.length, week: requests.filter((r) => Date.parse(r.createdAt) >= since).length }
}

/** Open invitations that have not expired yet. */
export function pendingInvitationCount(invitations: readonly Pick<AttentionInvitation, 'expiresAt'>[], now = Date.now()): number {
  return invitations.filter((i) => Date.parse(i.expiresAt) > now).length
}
