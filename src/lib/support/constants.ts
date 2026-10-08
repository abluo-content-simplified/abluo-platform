/**
 * Support mode constants (ADR-028 §8, docs/engineering/support-mode.md).
 * Browser-safe: no server imports.
 */

/** How long edit access lasts once the client allows it. The ONE place this is set (the DB only bounds it, 5–1440). */
export const SUPPORT_EDIT_MINUTES = 60

/** A support visit closes itself after this long, whatever happens (the cookie lives as long). */
export const SUPPORT_VISIT_MAX_MINUTES = 8 * 60

/** httpOnly cookie holding the open visit's id. Host-only: it never reaches a client's own host or a public site. */
export const SUPPORT_COOKIE = 'abluo_support'

/** Role perspectives an admin can look through. Owner is the default (Tom, 2026-10-08). */
export const SUPPORT_ROLES = ['owner', 'admin', 'editor'] as const
export type SupportRole = (typeof SUPPORT_ROLES)[number]
export const DEFAULT_SUPPORT_ROLE: SupportRole = 'owner'

export function isSupportRole(value: unknown): value is SupportRole {
  return typeof value === 'string' && (SUPPORT_ROLES as readonly string[]).includes(value)
}
