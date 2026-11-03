// ── People module — website helpers (ADR-043 D4, D7) ──────────────────────────
//
// Pure. The rules the website components and the profile route share:
//   • is the People module installed for this site (placement gating),
//   • the per-language profile base path (module config `profileSegment`),
//   • which source a team section / byline reads (refs, group, inline),
//   • the profile route dispatch and the redirect/archived outcomes.
//
// The base path is NEVER hardcoded: it is the module config. A value that is
// not one lowercase url-safe segment, or that is a platform route word, is
// ignored (no dispatch, no links) — the config surface has no validator yet,
// so the route defends itself.

import { isReservedSlug } from '@/lib/platform/reserved-slugs'
import { PEOPLE_MODULE_ID } from './model'
import { getModuleConfig, type ProjectModuleConfig } from '@/lib/modules/config'
import type { PersonPublic } from './projection'

/** One lowercase url-safe segment: `team`, `insegnanti`, `our-people`. */
export const PROFILE_SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const PROFILE_SEGMENT_MAX_LENGTH = 64

/**
 * Module gating, same contract as isSectionTypeAvailable: an unresolved module
 * list (null) fails open; a resolved list must contain `people`.
 */
export function isPeopleModuleOn(enabledModuleIds: readonly string[] | null | undefined): boolean {
  return enabledModuleIds == null || enabledModuleIds.includes(PEOPLE_MODULE_ID)
}

/** A usable segment or null. */
export function cleanProfileSegment(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().replace(/^\/+|\/+$/g, '').toLowerCase()
  if (!v || v.length > PROFILE_SEGMENT_MAX_LENGTH) return null
  if (!PROFILE_SEGMENT_PATTERN.test(v)) return null
  if (isReservedSlug(v)) return null
  return v
}

/** Per-language profile segments from a raw `profileSegment` localizedString (invalid entries dropped). */
export function cleanProfileSegments(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [loc, v] of Object.entries(raw as Record<string, unknown>)) {
    if (loc.startsWith('_')) continue
    const s = cleanProfileSegment(v)
    if (s) out[loc] = s
  }
  return out
}

/** Every language's profile segment for this site (module installed or not → {} when absent). */
export function profileSegments(moduleConfig: ProjectModuleConfig): Record<string, string> {
  return cleanProfileSegments(getModuleConfig(moduleConfig, PEOPLE_MODULE_ID)?.profileSegment)
}

/** The profile base path in one language, or null (module off, nothing configured). No locale fallback. */
export function profileSegmentFor(moduleConfig: ProjectModuleConfig, locale: string): string | null {
  return profileSegments(moduleConfig)[locale] ?? null
}

/** What the website needs to link a person: the site base and the language's profile segment. */
export interface PersonLinkContext {
  siteBase: string
  segment: string | null
}

/** The profile URL path of a person, or null (no page, no slug in this language, no segment). */
export function personHref(
  person: Pick<PersonPublic, 'hasPage' | 'slug'>,
  ctx: PersonLinkContext | null | undefined,
): string | null {
  const slug = person.slug?.current
  if (!ctx?.segment || !person.hasPage || !slug) return null
  return `${ctx.siteBase}/${ctx.segment}/${slug}`
}

// ── Placement sources (CONTRACTS §6.3 fallback rule) ──────────────────────────

export type TeamSource =
  | { kind: 'people'; people: PersonPublic[] }
  | { kind: 'inline' }

/**
 * `peopleCount > 0` ⇒ the hand-picked people (never inline members, even if
 * none of them is listable); else `groupFilter` ⇒ the group's people; else
 * inline `members`. Module not installed ⇒ inline members.
 */
export function teamSource(
  section: {
    people?: PersonPublic[] | null
    peopleCount?: number | null
    groupFilter?: string | null
    groupPeople?: PersonPublic[] | null
  },
  peopleOn: boolean,
): TeamSource {
  if (!peopleOn) return { kind: 'inline' }
  if ((section.peopleCount ?? 0) > 0) return { kind: 'people', people: section.people ?? [] }
  if (section.groupFilter) return { kind: 'people', people: section.groupPeople ?? [] }
  return { kind: 'inline' }
}

/**
 * Posts (`authors` / `authorCount`) and events (`hostPeople` / `hostPeopleCount`):
 * stored references win, even when none of them renders; else the legacy field.
 */
export function namedPeople(
  people: PersonPublic[] | null | undefined,
  storedCount: number | null | undefined,
  peopleOn: boolean,
): PersonPublic[] | null {
  if (!peopleOn || (storedCount ?? 0) <= 0) return null
  return people ?? []
}

// ── Profile route ─────────────────────────────────────────────────────────────

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** `[segment, slug]` under this language's profile segment → the slug; anything else → null (falls through to the page lookup). */
export function planPeopleRoute(
  segments: readonly string[],
  segment: string | null | undefined,
): { slug: string } | null {
  if (!segment || segments.length !== 2) return null
  const [first, slug] = segments.map(safeDecode)
  if (!slug || first.toLowerCase() !== segment) return null
  return { slug }
}

export type PersonRouteOutcome<P> =
  | { kind: 'found'; person: P }
  | { kind: 'redirect'; slug: string }
  | { kind: 'archived' }
  | { kind: 'none' }

/** The slug-lookup fetcher shape both the route and the tests use. */
export type PeopleFetch = <T>(query: string, params: Record<string, unknown>) => Promise<T>

/**
 * Requirements 2–3 of the routable pattern for a person: primary lookup with NO
 * slug fallback, then the redirect lookup, then the archived check (D4: an
 * archived person's page 308s away). The three lookups are passed in so each
 * `fetchForTenant` call site keeps a literal/imported query (see route.ts).
 */
export async function resolvePersonRoute<P>(
  lookups: {
    bySlug: () => Promise<P | null>
    byOldSlug: () => Promise<{ currentSlug?: string | null } | null>
    archived: () => Promise<boolean | null>
  },
  slug: string,
): Promise<PersonRouteOutcome<P>> {
  const person = await lookups.bySlug()
  if (person) return { kind: 'found', person }
  const old = await lookups.byOldSlug()
  if (old?.currentSlug && old.currentSlug !== slug) return { kind: 'redirect', slug: old.currentSlug }
  if (await lookups.archived()) return { kind: 'archived' }
  return { kind: 'none' }
}

/** Where an archived person's old URL goes: the people page when the site has one at the segment, else the site root. */
export function archivedTarget(opts: { siteBase: string; segment: string; pageAtSegmentExists: boolean }): string {
  return opts.pageAtSegmentExists ? `${opts.siteBase}/${opts.segment}` : opts.siteBase || '/'
}

// ── Small reads for the profile page ──────────────────────────────────────────

/** A page whose slug (this language) is the profile segment — the site's people page. */
export const PEOPLE_PAGE_EXISTS_QUERY = /* groq */ `
  count(*[_type == "page" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && slug[$locale].current == $segment]) > 0
`

/** Group labels (Categories & Tags, module people) — key + localized label map. */
export const PEOPLE_GROUP_LABELS_QUERY = /* groq */ `
  *[_type == "taxonomyTerm" && projectSlug == $projectSlug && module == "people" && kind == "category" && !(_id in path("drafts.**"))] | order(order asc, key asc){ key, label }
`

/** Resolve group keys to labels in one language; unknown keys are dropped (never show a raw key). */
export function groupLabels(
  keys: readonly string[] | null | undefined,
  terms: readonly { key?: string | null; label?: unknown }[] | null | undefined,
  locale: string,
  defaultLocale: string,
): string[] {
  if (!keys?.length || !terms?.length) return []
  const byKey = new Map<string, unknown>()
  for (const t of terms) if (t?.key) byKey.set(t.key, t.label)
  const out: string[] = []
  for (const k of keys) {
    const label = byKey.get(k)
    if (!label || typeof label !== 'object') continue
    const m = label as Record<string, unknown>
    const pick = [m[locale], m[defaultLocale], m.en].find((v): v is string => typeof v === 'string' && v.trim() !== '')
    if (pick) out.push(pick)
  }
  return out
}
