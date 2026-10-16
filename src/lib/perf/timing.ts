/**
 * Request timing for the dashboards (PERF-1, 2026-10-15).
 *
 * Purpose: measure where a save / publish / editor load / upload spends its
 * time BEFORE optimising anything. One structured log line per traced
 * operation, readable in the Vercel runtime logs:
 *
 *   [perf] {"op":"catalogue.patch","ms":812,"spans":[["auth",310],["readPair",120],…]}
 *
 * Design:
 * - `traced(op, fn)` opens a trace for one server operation (server action,
 *   page render, route handler). `span(name, fn)` times a step inside it.
 * - Context travels through AsyncLocalStorage, so `span()` can wrap shared
 *   helpers (the auth resolver, Sanity reads) without changing signatures.
 *   Outside a trace `span()` is a plain pass-through: zero behaviour change.
 * - Logging is ON outside production (dev / preview / local) and OFF in
 *   production unless `PERF_TIMING=1` is set. It never logs values, ids or
 *   user data — only step names and milliseconds.
 * - Spans record durations only; they never catch, retry or reorder work, so
 *   permission checks and project isolation run exactly as before.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

type Trace = { op: string; start: number; spans: Array<[string, number]> }

const store = new AsyncLocalStorage<Trace>()

export function perfEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.PERF_TIMING === '1') return true
  if (env.PERF_TIMING === '0') return false
  return env.VERCEL_ENV !== 'production'
}

const now = () => performance.now()

/**
 * What the browser may see (PERF-2): op name, outcome, total ms and named span
 * ms. Nothing else — no ids, values or user data. Only ever produced when
 * `perfEnabled()`; in production no `perf` field exists anywhere.
 */
export type PerfReport = { op: string; ms: number; outcome: string; spans: Record<string, number> }

function report(trace: Trace, outcome: string): PerfReport {
  const spans: Record<string, number> = {}
  for (const [name, ms] of trace.spans) spans[name] = (spans[name] ?? 0) + ms
  return { op: trace.op, ms: Math.round(now() - trace.start), outcome, spans }
}

/** Snapshot of the open trace so far, or undefined (no trace / perf off). */
export function currentPerf(outcome = 'ok'): PerfReport | undefined {
  if (!perfEnabled()) return undefined
  const trace = store.getStore()
  return trace ? report(trace, outcome) : undefined
}

/**
 * Attach the open trace's snapshot to a server-action result as `perf`, so the
 * browser console can show it. Returns the result untouched when perf is off.
 * Call it inside `traced()`, as the last step before returning.
 */
export function withPerf<R extends object>(result: R, outcome?: string): R & { perf?: PerfReport } {
  const perf = currentPerf(outcome ?? ('ok' in result && (result as { ok?: unknown }).ok === false ? 'failed' : 'ok'))
  return perf ? { ...result, perf } : result
}

/** Time one step of the current trace. A pass-through when no trace is open. */
export async function span<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const trace = store.getStore()
  if (!trace) return fn()
  const t0 = now()
  try {
    return await fn()
  } finally {
    trace.spans.push([name, Math.round(now() - t0)])
  }
}

/** Open a trace for one operation and log its steps when it settles. */
export async function traced<T>(op: string, fn: () => Promise<T>): Promise<T> {
  if (!perfEnabled() || store.getStore()) return fn()
  return runTrace(op, fn)
}

/**
 * A trace of its own for work that outlives the request — `after()` callbacks
 * (ADR-035 background processing). Inherits nothing from the request's trace,
 * which has already been logged by the time this runs.
 */
export async function tracedDetached<T>(op: string, fn: () => Promise<T>): Promise<T> {
  if (!perfEnabled()) return fn()
  return runTrace(op, fn)
}

async function runTrace<T>(op: string, fn: () => Promise<T>): Promise<T> {
  const trace: Trace = { op, start: now(), spans: [] }
  let outcome = 'ok'
  try {
    return await store.run(trace, fn)
  } catch (error) {
    // Next.js control flow (redirect / notFound) is thrown; record, never swallow.
    outcome = 'threw'
    throw error
  } finally {
    const line = { op, ms: Math.round(now() - trace.start), outcome, spans: trace.spans }
    console.info(`[perf] ${JSON.stringify(line)}`)
  }
}

/**
 * Lap timer for code that is easier to mark than to wrap (long awaited
 * chains). `lap(name)` records the time since the previous lap (or since the
 * stopwatch started) as `<prefix>.<name>`. A no-op outside a trace.
 */
export function stopwatch(prefix: string): (name: string) => void {
  const trace = store.getStore()
  if (!trace) return () => {}
  let last = now()
  return (name: string) => {
    const t = now()
    trace.spans.push([`${prefix}.${name}`, Math.round(t - last)])
    last = t
  }
}
