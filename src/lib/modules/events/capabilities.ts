// ── Events module — project capabilities (ADR-038 D6) ────────────────────────
//
// WHAT the client of one project can use in their dashboard's Events screen.
// Configured by Abluo in Studio → Modules → Events (one setting per capability,
// never per field). Three separate concerns, never mixed:
//   configuration (this file)  — what the project can use;
//   permissions (ADR-028)      — who may use it (`events.event.write`, …);
//   presentation               — how the website shows it (sections, design system).
//
// Rules:
//   - Defaults reproduce the dashboard as it was before capabilities existed, so
//     an installation saved before these settings existed behaves exactly as before.
//   - Switching a capability off hides it in the client dashboard and makes the
//     server refuse changes to it. Stored content is never deleted or changed and
//     keeps rendering on the website. Studio (Abluo) always shows everything.
//   - Pure: no I/O, importable from Studio, server, dashboard and tests.

export type AttendanceMode = 'inPerson' | 'online' | 'mixed'
export type VenueManagement = 'off' | 'abluoManaged' | 'tenantManaged'
export type RegistrationCapability = 'off' | 'externalLink'

export type EventCapabilities = {
  /** Which "where people attend" choices the client can pick. Always at least one. */
  attendance: Readonly<Record<AttendanceMode, boolean>>
  /** off = no venue picker; abluoManaged = pick venues Abluo saved; tenantManaged = the client also creates and edits them. */
  venues: VenueManagement
  hosts: boolean
  fullDescription: boolean
  programme: boolean
  gallery: boolean
  pricing: boolean
  registration: RegistrationCapability
  /** Repeating events — Phase 2. Fixed off until the scheduling work ships. */
  recurrence: false
}

export const DEFAULT_EVENT_CAPABILITIES: EventCapabilities = Object.freeze({
  attendance: Object.freeze({ inPerson: true, online: true, mixed: true }),
  venues: 'abluoManaged',
  hosts: false,
  fullDescription: false,
  programme: false,
  gallery: false,
  pricing: false,
  registration: 'externalLink',
  recurrence: false,
}) as EventCapabilities

/** The manifest config field ids that hold the capabilities (registry.ts → events). */
export const EVENT_CAPABILITY_CONFIG_IDS = [
  'capInPerson',
  'capOnline',
  'capHybrid',
  'capVenues',
  'capHosts',
  'capFullDescription',
  'capProgramme',
  'capGallery',
  'capPricing',
  'capRegistration',
] as const

const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback

/** The project's capabilities from its stored Events config; anything missing or invalid → the default. */
export function resolveEventCapabilities(config: Record<string, unknown> | null | undefined): EventCapabilities {
  const c = config ?? {}
  const d = DEFAULT_EVENT_CAPABILITIES
  let attendance = {
    inPerson: bool(c.capInPerson, d.attendance.inPerson),
    online: bool(c.capOnline, d.attendance.online),
    mixed: bool(c.capHybrid, d.attendance.mixed),
  }
  // Never zero ways to attend: all off reads as the default.
  if (!attendance.inPerson && !attendance.online && !attendance.mixed) attendance = { ...d.attendance }
  return {
    attendance,
    venues: pick(c.capVenues, ['off', 'abluoManaged', 'tenantManaged'] as const, d.venues),
    hosts: bool(c.capHosts, d.hosts),
    fullDescription: bool(c.capFullDescription, d.fullDescription),
    programme: bool(c.capProgramme, d.programme),
    gallery: bool(c.capGallery, d.gallery),
    pricing: bool(c.capPricing, d.pricing),
    registration: pick(c.capRegistration, ['off', 'externalLink'] as const, d.registration),
    recurrence: false,
  }
}

/** True when a place can be at a physical location (in person or hybrid allowed). */
export function physicalPlacesAllowed(caps: EventCapabilities): boolean {
  return caps.attendance.inPerson || caps.attendance.mixed
}

/**
 * The ONE map from a dashboard-editable event field to the capability that
 * governs it. `null` = always available (core fields). A field missing here is
 * not editable from the dashboard at all (the editor's own allowlist decides).
 */
export const EVENT_FIELD_CAPABILITY: Readonly<Record<string, (caps: EventCapabilities) => boolean>> = Object.freeze({
  title: () => true,
  shortDescription: () => true,
  location: () => true,
  categories: () => true,
  startDate: () => true,
  endDate: () => true,
  visibility: () => true,
  eventStatus: () => true,
  attendanceMode: () => true, // the VALUE is checked by attendanceModeAllowed
  place: (caps) => physicalPlacesAllowed(caps), // a venue VALUE also needs caps.venues !== 'off'
  registrationUrl: (caps) => caps.registration === 'externalLink',
  registrationLabel: (caps) => caps.registration === 'externalLink',
  fullDescription: (caps) => caps.fullDescription,
  hosts: (caps) => caps.hosts,
  schedule: (caps) => caps.programme,
  priceOptions: (caps) => caps.pricing,
  gallery: (caps) => caps.gallery,
})

/** May the client change this field (the top-level field name of a patch path)? */
export function eventFieldAllowed(caps: EventCapabilities, field: string): boolean {
  const rule = EVENT_FIELD_CAPABILITY[field]
  return rule ? rule(caps) : false
}

/**
 * May the client set this attendance mode? Keeping the value the event already
 * has is always allowed — switching a capability off never forces an edit.
 */
export function attendanceModeAllowed(caps: EventCapabilities, mode: string, current: string | null | undefined): boolean {
  if (mode === (current ?? 'inPerson')) return true
  return (mode === 'inPerson' || mode === 'online' || mode === 'mixed') && caps.attendance[mode]
}

/** May the client pick (or keep) this place token? Same keep-what-you-have rule. */
export function placeTokenAllowed(caps: EventCapabilities, token: string, current: string): boolean {
  if (token === current) return true
  if (token === '') return true
  if (!physicalPlacesAllowed(caps)) return false
  if (token.startsWith('venue:')) return caps.venues !== 'off'
  return token.startsWith('location:')
}
