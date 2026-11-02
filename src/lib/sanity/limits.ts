// ── Sanity platform limits — one named constant per limit (C6 §6.11, REVIEW-step3 C-13) ──
//
// Pure, browser-safe. Every writer that builds a large transaction (bulk
// publish `publishManyTogether`, pack application, migration scripts) compares
// its estimate against THIS constant — never a literal of its own.

/**
 * Maximum size of one Mutations API request body.
 *
 * Source: Sanity documentation, "Technical limits" → "Mutation request body
 * size: 4 MB" (https://www.sanity.io/docs/content-lake/technical-limits),
 * read 2026-11-02. Expressed in bytes of the serialised JSON request body.
 * If Sanity changes the limit, change it here only.
 */
export const SANITY_MUTATION_MAX_BYTES = 4_000_000

/** Safety margin applied to every estimate (C6 §6.11 item 3: "with a 20 % margin"). */
export const SANITY_MUTATION_SAFETY_MARGIN = 0.2

const utf8 = new TextEncoder()

/**
 * Pure estimate of the request body for these mutations: the UTF-8 length of
 * `{"mutations":[…]}` as the client serialises it. Runs BEFORE a transaction
 * is built, so a refusal never costs a request.
 */
export function estimateMutationBytes(mutations: readonly unknown[]): number {
  return utf8.encode(JSON.stringify({ mutations })).length
}

export type MutationSizeCheck = { bytes: number; limit: number; budget: number; fits: boolean }

/**
 * Does a body of `bytes` fit the limit with the safety margin? `limit` is
 * injectable so tests can use a small value (C6 B-05); production callers
 * omit it.
 */
export function checkMutationSize(bytes: number, opts: { limit?: number; margin?: number } = {}): MutationSizeCheck {
  const limit = opts.limit ?? SANITY_MUTATION_MAX_BYTES
  const margin = opts.margin ?? SANITY_MUTATION_SAFETY_MARGIN
  const budget = Math.floor(limit * (1 - margin))
  return { bytes, limit, budget, fits: Number.isFinite(bytes) && bytes >= 0 && bytes <= budget }
}
