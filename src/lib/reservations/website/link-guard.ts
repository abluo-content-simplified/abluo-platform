// ── Reservations website — the rate-limited token lookup (ADR-044 D11) ───────
//
// The ONLY way the two public pages (and their actions) turn a link token into
// a booking or a pass. PURE (the store is injected).
//
//  - A malformed token never reaches the database and looks exactly like an
//    unknown one.
//  - Every lookup first reserves an attempt for the visitor's address
//    (reservations_reserve_link_attempt: failed and pending attempts count; a
//    successful one does not), so a guessing run is stopped after a handful.
//  - The row's project is ALWAYS compared with the project the site serves: a
//    token of another site, an anonymised row and an unknown token are all
//    answered `invalid` — nothing tells which one it was.
//  - `limited` / `unavailable` say nothing about any link; they only say "not
//    now". No token, hash or address is ever returned or logged.
import { hashToken, isWellFormedToken } from '../tokens'
import type { Result } from '../server/errors'
import type { BookingRow, PassRow } from '../server/types'
import type { ServiceStore } from '../service/types'

/** 10 failed lookups per address per 15 minutes (the ADR-040 password prompt allows 5; links are only opened, not typed). */
export const LINK_RATE = { windowSeconds: 15 * 60, perIp: 10 } as const

export type LinkLookup<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'invalid' }
  | { kind: 'limited'; retryAfterSeconds: number }
  | { kind: 'unavailable' }

type Lookupable = { projectId: string; anonymisedAt: string | null }
type LinkStore = Pick<ServiceStore, 'reserveLinkAttempt' | 'finishLinkAttempt' | 'getBookingByTokenHash' | 'getPassByTokenHash'>

export type LinkInput = {
  /** The project this site serves (resolved from the host, never from the link). */
  projectId: string
  token: unknown
  /** Salted hash of the visitor's address; null = no salt configured → refuse (fail closed). */
  ipHash: string | null
}

async function lookup<T extends Lookupable>(
  store: Pick<LinkStore, 'reserveLinkAttempt' | 'finishLinkAttempt'>,
  input: LinkInput,
  read: (tokenHash: string) => Promise<Result<T | null>>,
): Promise<LinkLookup<T>> {
  if (!isWellFormedToken(input.token)) return { kind: 'invalid' }
  if (!input.ipHash) return { kind: 'unavailable' }

  const attempt = await store.reserveLinkAttempt(input.projectId, input.ipHash, LINK_RATE.windowSeconds, LINK_RATE.perIp)
  if (!attempt.ok) return { kind: 'unavailable' }
  if (!attempt.value.allowed || attempt.value.attemptId === null) return { kind: 'limited', retryAfterSeconds: attempt.value.retryAfterSeconds }
  const attemptId = attempt.value.attemptId

  let row: Result<T | null>
  try {
    row = await read(hashToken(input.token))
  } catch {
    row = { ok: false, error: { kind: 'unavailable' } }
  }
  const found = row.ok && row.value && row.value.projectId === input.projectId && !row.value.anonymisedAt ? row.value : null
  // The attempt stops counting once it succeeded. A failure to record it is not the visitor's problem.
  await store.finishLinkAttempt(attemptId, found !== null).catch(() => undefined)
  if (!row.ok) return { kind: 'unavailable' }
  return found ? { kind: 'ok', value: found } : { kind: 'invalid' }
}

export const lookupBookingLink = (store: LinkStore, input: LinkInput): Promise<LinkLookup<BookingRow>> =>
  lookup(store, input, (hash) => store.getBookingByTokenHash(hash))

export const lookupPassLink = (store: LinkStore, input: LinkInput): Promise<LinkLookup<PassRow>> =>
  lookup(store, input, (hash) => store.getPassByTokenHash(hash))
