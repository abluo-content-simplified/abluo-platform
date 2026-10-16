/**
 * Independent pre-write reads of an autosave, run at the same time instead of
 * one after another (performance work 2026-10-16, optimisation C).
 *
 * Results come back in the order given. Every read is awaited (no promise is
 * left to reject unobserved), and if several fail, the FIRST one in the given
 * order is rethrown — so callers keep the same error precedence they had when
 * the reads ran sequentially (e.g. "not found" before "site misconfigured").
 * Validation of the results still happens after, in the caller's order.
 *
 * Only for reads with no side effects. Authorization (the grant check) must
 * already have passed before any of them starts.
 */
export async function readsInOrder<T extends readonly unknown[]>(reads: { [K in keyof T]: Promise<T[K]> }): Promise<T> {
  const settled = await Promise.allSettled(reads as readonly Promise<unknown>[])
  for (const r of settled) if (r.status === 'rejected') throw r.reason
  return settled.map((r) => (r as PromiseFulfilledResult<unknown>).value) as unknown as T
}
