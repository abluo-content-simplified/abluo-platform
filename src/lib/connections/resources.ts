// ── Connections — what can be shared, and the per-request permission check ────
//
// OUR responsibility (the OAuth library knows nothing about resources). A
// Connection grant names resources and fields; this module is the ONLY place
// that answers "may this Connection do X on resource Y?". Fail closed:
//   - an unknown resource → no
//   - a resource the Connection was not granted → no
//   - any action other than `read` → no (V1 is read-only; partner writes are
//     phase "Later" and will land as drafts)
//   - a project other than the Connection's own → no
//
// People permissions (`can()`, ADR-028) are deliberately NOT reused: a
// Connection is not a person, and nothing about members, billing, modules or
// platform settings can be expressed in a Connection grant. This is the
// "third subject kind" of ADR-031 §3 — kept structurally separate.

import type { ConnectionGrant, SharedResources } from './types'

export type ConnectionAction = 'read' | 'write'

interface ResourceDef {
  /** Always delivered (identity, link back, sync cursor) — cannot be unticked. */
  core: readonly string[]
  /** Public on the website; shareable, ticked by default on the consent screen. */
  public: readonly string[]
  /** Personal data (ADR-031 D3/D8.1): shareable only when explicitly ticked. */
  personal: readonly string[]
  /** Actions a Connection can ever hold on this resource. V1: read only. */
  actions: readonly ConnectionAction[]
}

/**
 * The contract's shareable resources (Event v1, Venue v1). Website-only fields
 * (live-stream URLs, featured flags) are NOT listed, so they can never be
 * granted. Step 5 maps these names to the API payload.
 */
export const SHAREABLE_RESOURCES = {
  event: {
    core: ['id', 'url', 'createdAt', 'updatedAt'],
    public: ['name', 'description', 'startDate', 'endDate', 'eventStatus', 'attendanceMode', 'location', 'image', 'offers', 'inLanguage'],
    personal: ['performers'],
    actions: ['read'],
  },
  eventVenue: {
    core: ['id', 'createdAt', 'updatedAt'],
    public: ['name', 'address', 'geo', 'timeZone', 'url'],
    personal: [],
    actions: ['read'],
  },
} as const satisfies Record<string, ResourceDef>

export type ShareableResource = keyof typeof SHAREABLE_RESOURCES

export function isShareableResource(name: unknown): name is ShareableResource {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(SHAREABLE_RESOURCES, name)
}

function grantableFields(resource: ShareableResource): Set<string> {
  const d = SHAREABLE_RESOURCES[resource] as ResourceDef
  return new Set([...d.public, ...d.personal])
}

/** Default selection on the consent screen: every public field, no personal ones. */
export function defaultFields(resource: ShareableResource): string[] {
  return [...(SHAREABLE_RESOURCES[resource] as ResourceDef).public]
}

export type ResourcesValidation = { ok: true; resources: SharedResources } | { ok: false; error: string }

/**
 * Validate and normalise what a consent asks to share. Unknown resources or
 * fields are refused (never silently dropped — the person must see exactly
 * what is shared). Core fields are added; duplicates removed; order stable.
 */
export function normalizeResources(input: unknown): ResourcesValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'resources_invalid' }
  const out: SharedResources = {}
  for (const [name, spec] of Object.entries(input as Record<string, unknown>)) {
    if (!isShareableResource(name)) return { ok: false, error: `resource_unknown:${name}` }
    const fields = (spec as { fields?: unknown } | null)?.fields
    if (!Array.isArray(fields)) return { ok: false, error: `fields_invalid:${name}` }
    const allowed = grantableFields(name)
    const core = (SHAREABLE_RESOURCES[name] as ResourceDef).core
    const picked: string[] = []
    for (const f of fields) {
      if (typeof f !== 'string') return { ok: false, error: `fields_invalid:${name}` }
      if (core.includes(f)) continue
      if (!allowed.has(f)) return { ok: false, error: `field_not_shareable:${name}.${f}` }
      if (!picked.includes(f)) picked.push(f)
    }
    out[name] = { fields: [...core, ...picked] }
  }
  if (Object.keys(out).length === 0) return { ok: false, error: 'resources_empty' }
  return { ok: true, resources: out }
}

/** Does `next` share anything `prev` did not? (Then consent must be shown again.) */
export function widensResources(prev: SharedResources, next: SharedResources): boolean {
  for (const [name, spec] of Object.entries(next)) {
    const before = prev[name]
    if (!before) return true
    if (spec.fields.some((f) => !before.fields.includes(f))) return true
  }
  return false
}

/**
 * THE per-request check for partner API calls. True only when the resource is
 * shareable, the Connection holds it, the action is allowed for that resource,
 * and the target project is the Connection's own.
 */
export function connectionCan(
  grant: ConnectionGrant | null | undefined,
  resource: string,
  action: ConnectionAction,
  projectId: string,
): boolean {
  if (!grant) return false
  if (grant.projectId !== projectId) return false
  if (!isShareableResource(resource)) return false
  if (!Object.prototype.hasOwnProperty.call(grant.resources, resource)) return false
  return ((SHAREABLE_RESOURCES[resource] as ResourceDef).actions as readonly string[]).includes(action)
}

/** The fields this Connection may receive for `resource` (empty when not granted). */
export function grantedFields(grant: ConnectionGrant, resource: string): string[] {
  if (!isShareableResource(resource)) return []
  const spec = grant.resources[resource]
  if (!spec) return []
  // Re-filter against the registry: a field later removed from the contract
  // (or a hand-edited row) is never delivered.
  const allowed = new Set<string>([...(SHAREABLE_RESOURCES[resource] as ResourceDef).core, ...grantableFields(resource)])
  return spec.fields.filter((f) => allowed.has(f))
}

/** Keep only granted fields of one contract object. */
export function projectFields<T extends Record<string, unknown>>(grant: ConnectionGrant, resource: string, item: T): Partial<T> {
  const keep = new Set(grantedFields(grant, resource))
  const out: Partial<T> = {}
  for (const [k, v] of Object.entries(item)) if (keep.has(k)) (out as Record<string, unknown>)[k] = v
  return out
}
