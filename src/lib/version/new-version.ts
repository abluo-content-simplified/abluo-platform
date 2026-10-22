/**
 * "New version" notice — the pure rules (browser-safe).
 *
 * The page knows the commit it was built from (NEXT_PUBLIC_GIT_COMMIT_SHA,
 * baked in at build time). `/api/version` reports the commit of the build that
 * answers. When the two are both real and differ, a newer build is live.
 * Anything unusual (offline, an error, 'local' / 'unknown' / empty) is NOT a
 * new version: the notice never appears by accident.
 */

/** Check at most this often when the tab regains focus. */
export const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000
export const VERSION_FOCUS_MIN_GAP_MS = 30 * 1000

const PLACEHOLDERS = new Set(['', 'local', 'unknown', 'undefined', 'null'])

/** A commit id worth comparing: not a placeholder. */
export function isRealCommit(value: unknown): value is string {
  return typeof value === 'string' && !PLACEHOLDERS.has(value.trim().toLowerCase())
}

/**
 * The commit out of an `/api/version` body (full id preferred, else the short
 * one), or null when the body is not usable.
 */
export function commitFromVersionResponse(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const { commitLong, commit } = body as { commitLong?: unknown; commit?: unknown }
  if (isRealCommit(commitLong)) return commitLong.trim()
  if (isRealCommit(commit)) return commit.trim()
  return null
}

/** Equal when one is the other's prefix (a short id against a full one). */
function sameCommit(a: string, b: string): boolean {
  const x = a.trim().toLowerCase()
  const y = b.trim().toLowerCase()
  return x.startsWith(y) || y.startsWith(x)
}

/** True only when both commits are real and clearly different. */
export function isNewVersionAvailable(current: unknown, latest: unknown): boolean {
  if (!isRealCommit(current) || !isRealCommit(latest)) return false
  return !sameCommit(current, latest)
}

/** Should a focus event trigger a check now? Not if one just ran. */
export function shouldCheckOnFocus(lastCheckedAt: number | null, now: number, minGapMs: number = VERSION_FOCUS_MIN_GAP_MS): boolean {
  return lastCheckedAt === null || now - lastCheckedAt >= minGapMs
}
