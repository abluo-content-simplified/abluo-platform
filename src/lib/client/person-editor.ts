/**
 * Pure rules behind the People editor (ADR-043 D8) — no React, no I/O, so they
 * are unit-tested (src/lib/client/__tests__/person-editor.test.ts):
 *   - which contacts are saved as typed (`contactProblem` mirrors the server's
 *     per-type validation, never stricter),
 *   - what stops "Publish" and where to fix it (`publishBlockers`),
 *   - the contact lists the editor sends (public → the draft, private → Supabase).
 */

export const CONTACT_KINDS = ['email', 'phone', 'whatsapp', 'instagram', 'linkedin', 'website', 'url'] as const
export type ContactKind = (typeof CONTACT_KINDS)[number]

export type ContactRow = {
  _key: string
  kind: ContactKind
  value: string
  label: string
  preferred: boolean
  visibility: 'public' | 'private'
}

// Mirrors of the server's checks (src/lib/api/persons.ts): same patterns, so a row that passes here passes there.
const EMAIL = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:]{2,}$/
const PHONE = /^\+?[0-9\s\-().]{5,30}$/
const HANDLE = /^@?[A-Za-z0-9._-]{1,100}$/
const HTTP = /^https?:\/\//i

export type ContactProblem = 'empty' | 'email' | 'phone' | 'handle' | 'url'

/** What is wrong with a contact as typed, or null when the server will accept it. */
export function contactProblem(kind: ContactKind, raw: string): ContactProblem | null {
  const value = raw.trim()
  if (!value) return 'empty'
  if (kind === 'email') return EMAIL.test(value) ? null : 'email'
  if (kind === 'phone' || kind === 'whatsapp') return PHONE.test(value) ? null : 'phone'
  if (kind === 'instagram' || kind === 'linkedin') return HANDLE.test(value) || /^https:\/\//i.test(value) ? null : 'handle'
  return HTTP.test(value) ? null : 'url'
}

/** Contacts that can be saved now (a half-typed address stays on screen, not on the server). */
export function savableContacts(rows: readonly ContactRow[], side: 'public' | 'private') {
  return rows
    .filter((c) => c.visibility === side && contactProblem(c.kind, c.value) === null)
    .map((c) => ({ _key: c._key, kind: c.kind, value: c.value.trim(), label: c.label.trim(), preferred: c.preferred }))
}

/** A stable string of a saved list, to tell whether anything changed since the last save. */
export function contactsSignature(list: readonly { _key: string; kind: string; value: string; label: string; preferred: boolean }[]): string {
  return JSON.stringify(list.map((c) => [c._key, c.kind, c.value, c.label, c.preferred]))
}

export type PublishBlocker = { id: 'slug'; locale: string }

/**
 * What keeps the person from being published, with where to fix it. The server
 * agrees: a person with their own page needs a web address in the main
 * language (`missing_slug`); the names are always present (they cannot be
 * saved empty).
 */
export function publishBlockers(input: { visibility: 'off' | 'listed' | 'page'; slug: Record<string, string>; defaultLocale: string; firstName: string; lastName: string }): PublishBlocker[] {
  const out: PublishBlocker[] = []
  if (input.visibility === 'page' && !input.slug[input.defaultLocale]?.trim()) out.push({ id: 'slug', locale: input.defaultLocale })
  return out
}

/** A suggestion for the web address: the lower-case name without accents or spaces ("anna-bianchi"). */
export function suggestSlug(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/** Two-letter language codes the "Languages spoken" field offers first (the site's own languages come first in the editor). */
export const COMMON_LANGUAGES = ['en', 'it', 'de', 'fr', 'es', 'pt', 'nl', 'ru', 'pl', 'ar', 'zh', 'ja'] as const
