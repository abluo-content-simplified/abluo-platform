// ── People module — shared constants (ADR-043) ────────────────────────────────
// Pure and browser-safe: imported by the schema (Studio bundle), the services
// (server) and the dashboard (client).

export const PEOPLE_MODULE_ID = 'people'

/** Contact method types (D2). Each has an optional label, public/private and a preferred flag. */
export const PERSON_CONTACT_KINDS = ['email', 'phone', 'whatsapp', 'instagram', 'linkedin', 'website', 'url'] as const
export type PersonContactKind = (typeof PERSON_CONTACT_KINDS)[number]

/** On the website (D4): Off · Listed · Listed + own page. */
export const PERSON_VISIBILITIES = ['off', 'listed', 'page'] as const
export type PersonVisibility = (typeof PERSON_VISIBILITIES)[number]
export const DEFAULT_PERSON_VISIBILITY: PersonVisibility = 'listed'

/** Permissions (contracts §1). */
export const PEOPLE_PERMISSIONS = {
  read: 'people.person.read',
  write: 'people.person.write',
  archive: 'people.person.archive',
  anonymise: 'people.person.anonymise',
  delete: 'people.person.delete',
  taxonomy: 'people.taxonomy.write',
} as const

/** The taxonomy kind that holds People "Groups" in Categories & Tags (ADR-033 Amendment J). */
export const PEOPLE_GROUP_KIND = 'category' as const

/** The display-name rule (contracts §2): displayName if set, else "first last". Honorific NOT included. */
type NameFields = { displayName?: unknown; firstName?: unknown; lastName?: unknown; honorific?: unknown }

export function personDisplayName(person: object | null | undefined): string {
  if (!person) return ''
  const p = person as NameFields
  const d = typeof p.displayName === 'string' ? p.displayName.trim() : ''
  if (d) return d
  return [p.firstName, p.lastName]
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .join(' ')
}

/** The website name: honorific (already locale-resolved) + display name. */
export function personFullName(person: object | null | undefined): string {
  const p = person as NameFields | null | undefined
  const name = personDisplayName(p)
  const h = typeof p?.honorific === 'string' ? p.honorific.trim() : ''
  return h && name ? `${h} ${name}` : name
}

/** Initials for the no-photo avatar (D7): first letters of first and last name (or of the display name's words). */
export function personInitials(person: object | null | undefined): string {
  const p = person as NameFields | null | undefined
  const first = typeof p?.firstName === 'string' ? p.firstName.trim() : ''
  const last = typeof p?.lastName === 'string' ? p.lastName.trim() : ''
  const pick = (s: string) => (s ? Array.from(s)[0]!.toLocaleUpperCase() : '')
  if (first || last) return `${pick(first)}${pick(last)}`
  const words = personDisplayName(p).split(/\s+/).filter(Boolean)
  return words.slice(0, 2).map(pick).join('')
}
