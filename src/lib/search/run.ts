/**
 * Dashboard search (ADR-047) — the engine. Pure orchestration: the Sanity fetch
 * and the contact-request loader are injected, so it is testable without
 * network, and the server action only wires identity + clients.
 */
import type { DashboardSubmission } from '@/lib/api/client-dashboard'
import { resolveLocalized } from '@/lib/api/client-dashboard'
import { siteContext, siteUrlFor, PROJECT_KEY } from './site-url'
import { filterRequests, requestSnippet } from './requests-search'
import { buildSearchQuery, isSanitySearchDef, mergeRows, searchTermGroups, SITE_KEY, type MergedRow, type RawSearchRow, type SanitySearchDef, type SearchParams } from './sanity-search'
import { buildSnippetQuery, firstSnippet, needlesOf, rowTexts, textHasNeedle } from './snippet'
import { allSearchSources, type SearchSource } from './sources'
import {
  SEARCH_GROUP_LIMIT,
  SEARCH_KIND_ORDER,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MIN_CHARS,
  type SearchGroup,
  type SearchHit,
  type SearchKind,
  type SearchResponse,
} from './types'

export const SUBTITLE_MAX = 120

/** What the viewer may search on this project, decided by the caller from the grant. */
export type SearchAccess = {
  /** The module is installed on the project (undefined moduleId = platform surface, e.g. Media). */
  isEnabled: (moduleId: string | undefined) => boolean
  /** The viewer holds this read permission on the project. */
  can: (permission: string) => boolean
  /** Support visit without "show contact requests": requests are never searched. */
  hideContactRequests: boolean
}

export type SearchDeps = {
  /** Runs the one GROQ query (raw perspective, token client) and returns its object result. */
  fetchSanity: (query: string, params: SearchParams) => Promise<Record<string, unknown> | null>
  /** The Requests screen's loader, already scoped to the project (limit 500). */
  loadRequests: () => Promise<DashboardSubmission[]>
  sources?: SearchSource[]
}

export type SearchInput = {
  projectSlug: string
  q: string
  includeArchived?: boolean
  /** The viewer's interface locale. */
  locale: string
  access: SearchAccess
}

/** Trim, collapse whitespace and cap; null when too short. */
export function normalizeQuery(q: unknown): { q: string } | { error: 'too_short' } {
  const trimmed = typeof q === 'string' ? q.replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX_QUERY_LENGTH).trim() : ''
  return trimmed.length >= SEARCH_MIN_CHARS ? { q: trimmed } : { error: 'too_short' }
}

/** Only installed modules whose read permission the viewer holds. */
export function permittedSources(sources: SearchSource[], access: SearchAccess): SearchSource[] {
  return sources.filter(
    (s) =>
      access.isEnabled(s.moduleId) &&
      access.can(s.def.permission) &&
      !(s.def.source.type === 'contact-requests' && access.hideContactRequests)
  )
}

const clip = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > SUBTITLE_MAX ? `${t.slice(0, SUBTITLE_MAX - 1).trimEnd()}…` : t
}
const thumb = (url: unknown) => (typeof url === 'string' && url ? `${url}?w=96&h=96&fit=crop&auto=format` : undefined)

export async function runSearch(input: SearchInput, deps: SearchDeps): Promise<SearchResponse> {
  const norm = normalizeQuery(input.q)
  if ('error' in norm) return { ok: false, q: typeof input.q === 'string' ? input.q : '', error: norm.error }
  const { q } = norm
  const includeArchived = input.includeArchived === true
  const slug = input.projectSlug

  const sources = permittedSources(deps.sources ?? allSearchSources(), input.access)
  const sanityDefs = sources.map((s) => s.def).filter(isSanitySearchDef) as SanitySearchDef[]
  const requestsDef = sources.find((s) => s.def.source.type === 'contact-requests')?.def

  const termGroups = searchTermGroups(q)
  const needles = needlesOf(termGroups.flat())

  const [sanity, submissions] = await Promise.all([
    sanityDefs.length
      ? (() => {
          const built = buildSearchQuery(sanityDefs, slug, termGroups)
          return deps.fetchSanity(built.query, built.params)
        })()
      : Promise.resolve(null),
    requestsDef ? deps.loadRequests() : Promise.resolve([] as DashboardSubmission[]),
  ])

  const siteDefault = typeof sanity?.[SITE_KEY] === 'string' ? (sanity[SITE_KEY] as string) : input.locale
  const r = { text: (v: unknown) => resolveLocalized(v as never, input.locale, siteDefault) ?? '' }

  const siteCtx = siteContext(sanity?.[PROJECT_KEY], siteDefault)
  const groups = new Map<SearchKind, SearchGroup>()
  const seeAll = (def: SearchSource['def']) => `${def.listHref(slug)}?q=${encodeURIComponent(q)}`

  // Hits whose title does not show the match: they get a snippet from ONE second request.
  const needSnippet: { def: SanitySearchDef; hit: SearchHit; m: MergedRow }[] = []

  for (const def of sanityDefs) {
    const raw = sanity?.[def.kind]
    const merged = mergeRows(Array.isArray(raw) ? (raw as RawSearchRow[]) : [], includeArchived)
    if (!merged.length) continue
    const shown = merged.slice(0, SEARCH_GROUP_LIMIT)
    const hits: SearchHit[] = shown.map((m) => {
      const subtitle = def.source.subtitleOf ? clip(def.source.subtitleOf(m.row, r)) : ''
      const th = thumb(m.row.thumb)
      const title = def.source.titleOf(m.row, r) || m.id
      const siteUrl = m.site ? siteUrlFor(def, m.site, siteCtx, input.locale) : undefined
      const hit: SearchHit = {
        id: m.id,
        kind: def.kind,
        title,
        ...(subtitle && { subtitle }),
        ...(th && { thumbUrl: th }),
        href: def.href(slug, m.id),
        ...(m.updatedAt && { updatedAt: m.updatedAt }),
        ...(siteUrl && { siteUrl }),
        ...(m.draft && { draft: true }),
        ...(m.archived && { archived: true }),
      }
      if (!textHasNeedle(title, needles)) needSnippet.push({ def, hit, m })
      return hit
    })
    groups.set(def.kind, { kind: def.kind, hits, more: merged.length > SEARCH_GROUP_LIMIT, seeAllHref: seeAll(def) })
  }

  if (requestsDef) {
    const matched = filterRequests(submissions, q, includeArchived)
    if (matched.length) {
      const hits: SearchHit[] = matched.slice(0, SEARCH_GROUP_LIMIT).map((s) => {
        const snippet = requestSnippet(s, q)
        return {
        id: s.id,
        kind: requestsDef.kind,
        title: s.name || s.email || s.formId || s.id,
        ...(clip(s.name ? (s.email ?? '') : s.createdAt.slice(0, 10)) && { subtitle: clip(s.name ? (s.email ?? '') : s.createdAt.slice(0, 10)) }),
        href: requestsDef.href(slug, s.id),
        ...(s.createdAt && { updatedAt: s.createdAt }),
        ...(s.status === 'archived' && { archived: true }),
        ...(snippet && { snippet }),
        }
      })
      groups.set(requestsDef.kind, { kind: requestsDef.kind, hits, more: matched.length > SEARCH_GROUP_LIMIT, seeAllHref: seeAll(requestsDef) })
    }
  }

  if (needSnippet.length) {
    const byDef = new Map<SanitySearchDef, string[]>()
    for (const n of needSnippet) byDef.set(n.def, [...(byDef.get(n.def) ?? []), n.m.row._id])
    const built = buildSnippetQuery([...byDef].map(([def, ids]) => ({ def, ids })), slug)
    if (built) {
      // Snippets are a nicety: a failure here must never fail the search.
      const fetched = await deps.fetchSanity(built.query, built.params).catch(() => null)
      for (const { def, hit, m } of needSnippet) {
        const rows = fetched?.[def.kind]
        const row = Array.isArray(rows) ? (rows as RawSearchRow[]).find((x) => x._id === m.row._id) : undefined
        if (!row) continue
        const snippet = firstSnippet(rowTexts(def, row, input.locale, siteDefault), needles)
        if (snippet) hit.snippet = snippet
      }
    }
  }

  return { ok: true, q, groups: SEARCH_KIND_ORDER.flatMap((k) => (groups.has(k) ? [groups.get(k)!] : [])) }
}
