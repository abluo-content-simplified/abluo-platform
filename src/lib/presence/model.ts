/**
 * ADR-030 A1 — how "Active now" is decided. Pure; shared by the heartbeat and
 * the admin Users page so the two can never drift apart.
 */

/** The dashboard says "I'm here" this often while the tab is visible. */
export const HEARTBEAT_MS = 2 * 60 * 1000

/** Seen within this window → "Active now". Two missed heartbeats plus slack. */
export const ACTIVE_NOW_MS = 5 * 60 * 1000

/** The most recent sign of life: the heartbeat, else the last sign-in. */
export function lastActiveAt(lastSeenAt: string | null | undefined, lastSignInAt: string | null | undefined): string | null {
  const a = lastSeenAt ? Date.parse(lastSeenAt) : NaN
  const b = lastSignInAt ? Date.parse(lastSignInAt) : NaN
  if (Number.isNaN(a) && Number.isNaN(b)) return null
  if (Number.isNaN(a)) return lastSignInAt ?? null
  if (Number.isNaN(b)) return lastSeenAt ?? null
  return a >= b ? (lastSeenAt as string) : (lastSignInAt as string)
}

/** True when the person had a dashboard open within ACTIVE_NOW_MS of `now`. */
export function isActiveNow(lastActive: string | null | undefined, now: number): boolean {
  if (!lastActive) return false
  const t = Date.parse(lastActive)
  return !Number.isNaN(t) && now - t >= -60_000 && now - t <= ACTIVE_NOW_MS
}
