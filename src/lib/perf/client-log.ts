import type { PerfReport } from './timing'

/**
 * Browser-console side of the PERF-1 timings (PERF-2, 2026-10-16).
 *
 * Server actions attach a `perf` field to their result ONLY when
 * `perfEnabled()` holds on the server (never in production, see timing.ts).
 * This helper therefore logs only when that field is present: the server is
 * the single switch, so a production bundle cannot be made to print timings
 * by a client-side flag, and there is nothing to leak (the field is op name,
 * outcome and millisecond counts). Gating on NEXT_PUBLIC_VERCEL_ENV as well
 * would add a second switch that can disagree with the server (PERF_TIMING
 * overrides), so it is deliberately not used.
 *
 *   [perf] catalogue.patch client=3412ms server=2980ms gap=432ms {auth: 310, …}
 *
 * `gap` = network + Next.js action overhead + serialisation.
 */
export function logPerf(label: string, clientMs: number, perf: PerfReport | undefined | null): void {
  if (!perf) return
  const gap = Math.round(clientMs) - perf.ms
  try {
    console.info('[perf]', `${label} client=${Math.round(clientMs)}ms server=${perf.ms}ms gap=${gap}ms outcome=${perf.outcome}`, perf.spans)
  } catch {
    /* console unavailable */
  }
}

/** Time one awaited server-action call and log it. Returns the result untouched. */
export async function timedAction<R>(label: string, call: () => Promise<R>): Promise<R> {
  const t0 = performance.now()
  const result = await call()
  logPerf(label, performance.now() - t0, (result as { perf?: PerfReport } | null | undefined)?.perf)
  return result
}
