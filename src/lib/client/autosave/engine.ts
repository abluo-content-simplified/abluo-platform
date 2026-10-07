/**
 * Autosave engine for the client content wizard (ADR-025 D1/D2). Pure — no
 * React, no DOM — so it is tested with fake timers and an in-memory journal.
 *
 * Rules:
 *   • `set()` merges patch paths into one pending map (later values win) and
 *     journals it at once, then debounces (800 ms by default).
 *   • One request in flight at a time, always sent with the latest revision.
 *     Edits made while a request is in flight wait for it, then go next.
 *   • `failed` / a thrown (network) error → "offline": the batch goes back into
 *     the queue and is retried with backoff. Nothing is ever dropped.
 *   • `conflict` → "conflict" ("Edited elsewhere"): the engine stops. It never
 *     retries over someone else's change; the UI offers Reload.
 *   • `invalid_field` / `invalid_value` (the server refused a value): a batch
 *     of several paths is split and re-sent one path at a time; the single path
 *     the server still refuses is dropped and reported (`onRejected`), so one
 *     bad value never blocks everything typed after it.
 *   • Any other refusal → "error": stops, keeps the journal.
 *   • `rekey(id)`: a lazily created draft gets its real id — the journal moves
 *     from the temporary key to the real one, and is kept there from then on.
 *   • The journal holds exactly the unconfirmed paths; it is cleared once the
 *     server confirms everything.
 */
import type { JournalStorage, PendingSet } from './journal'

export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'conflict' | 'error'

export type SendResult = { ok: true; rev: string } | { ok: false; error: string }

export type AutosaveOptions = {
  draftId: string
  rev: string
  send: (input: { rev: string; set: PendingSet }) => Promise<SendResult>
  storage?: JournalStorage | null
  debounceMs?: number
  /** Backoff between retries; the last value repeats. */
  retryDelaysMs?: number[]
  onState?: (state: SaveState) => void
  onRev?: (rev: string) => void
  /** The paths the server refused and that were dropped (cleared when the path is edited again). */
  onRejected?: (paths: string[]) => void
}

export type Autosave = {
  set(patch: PendingSet): void
  /** Sends everything now. Resolves true when the server has confirmed all of it. */
  flush(): Promise<boolean>
  /** Loads the journal, queues it, and returns it so the UI can apply it first. */
  replay(): Promise<PendingSet | null>
  /** Try again right away (e.g. the browser came back online). */
  retryNow(): void
  /** Forget local unconfirmed changes (after the user chose "Reload"). */
  discard(): Promise<void>
  /** Adopt a revision produced by another write path of this editor (e.g. the cover upload). */
  setRev(rev: string): void
  /**
   * The draft now has its real id: move the journal from the current key to
   * `nextKey` and journal under it from now on. Resolves once moved.
   */
  rekey(nextKey: string): Promise<void>
  readonly key: string
  readonly rejected: string[]
  readonly state: SaveState
  readonly rev: string
  readonly pending: PendingSet
  dispose(): void
}

export const DEFAULT_DEBOUNCE_MS = 800
export const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000]

/** Server refusals of a value (not of the request): isolate the path, never block the rest. */
const REJECTED_VALUE = new Set(['invalid_field', 'invalid_value'])

export function createAutosave(opts: AutosaveOptions): Autosave {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const delays = opts.retryDelaysMs?.length ? opts.retryDelaysMs : DEFAULT_RETRY_DELAYS_MS
  const storage = opts.storage ?? null

  let rev = opts.rev
  let key = opts.draftId
  /** Paths of a refused multi-path batch, re-sent one at a time. */
  let suspects: string[] = []
  let rejected: string[] = []
  /** Storage writes run one after another, so a re-key and the next journal write never race. */
  let storageChain: Promise<unknown> = Promise.resolve()
  let queued = 0
  const enqueue = (op: () => Promise<unknown>): Promise<unknown> => {
    const start = () => {
      let p: Promise<unknown>
      try {
        p = Promise.resolve(op())
      } catch (error) {
        p = Promise.reject(error)
      }
      return p.catch(() => undefined).finally(() => {
        queued--
      })
    }
    // Nothing queued: write right away (synchronously started); otherwise after the queue.
    const next = queued === 0 ? start() : storageChain.then(start)
    queued++
    storageChain = next
    return next
  }
  let pending: PendingSet = {}
  let inFlight: Promise<void> | null = null
  let inFlightSet: PendingSet = {}
  let timer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let attempt = 0
  let state: SaveState = 'idle'
  let disposed = false

  const has = (s: PendingSet) => Object.keys(s).length > 0

  function setState(next: SaveState) {
    if (next === state) return
    state = next
    try {
      opts.onState?.(next)
    } catch {
      /* UI callback errors never break saving */
    }
  }

  function journal() {
    if (!storage) return
    const unconfirmed = { ...inFlightSet, ...pending }
    const id = key
    void enqueue(() => (has(unconfirmed) ? storage.save(id, unconfirmed) : storage.clear(id)))
  }

  function setRejected(next: string[]) {
    rejected = next
    try {
      opts.onRejected?.([...next])
    } catch {
      /* ignore */
    }
  }

  const stopped = () => state === 'conflict' || state === 'error' || disposed

  function clearTimers() {
    if (timer) clearTimeout(timer)
    if (retryTimer) clearTimeout(retryTimer)
    timer = retryTimer = null
  }

  function schedule(ms: number) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void run()
    }, ms)
  }

  async function run(): Promise<void> {
    if (stopped()) return
    if (inFlight) return inFlight
    if (!has(pending)) return
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    let batch: PendingSet
    const suspect = suspects.find((p) => p in pending)
    if (suspect !== undefined) {
      // Isolating a refused batch: one path per request.
      batch = { [suspect]: pending[suspect] }
      const rest = { ...pending }
      delete rest[suspect]
      pending = rest
      suspects = suspects.filter((p) => p !== suspect)
    } else {
      suspects = []
      batch = pending
      pending = {}
    }
    inFlightSet = batch
    setState('saving')

    inFlight = (async () => {
      let result: SendResult
      try {
        result = await opts.send({ rev, set: batch })
      } catch {
        result = { ok: false, error: 'network' }
      }
      inFlight = null
      inFlightSet = {}
      if (disposed) return

      if (result.ok) {
        attempt = 0
        rev = result.rev
        try {
          opts.onRev?.(rev)
        } catch {
          /* ignore */
        }
        journal()
        if (has(pending)) {
          if (!timer) await run()
        } else {
          setState('saved')
        }
        return
      }

      if (REJECTED_VALUE.has(result.error)) {
        const paths = Object.keys(batch)
        if (paths.length > 1) {
          // Find the refused path: re-send the batch one path at a time, right away.
          pending = { ...batch, ...pending }
          suspects = paths
          journal()
          await run()
          return
        }
        // One path, refused on its own: drop it (unless it was retyped meanwhile) and carry on.
        attempt = 0
        if (!(paths[0] in pending) && !rejected.includes(paths[0])) setRejected([...rejected, paths[0]])
        journal()
        if (has(pending)) await run()
        else setState('saved')
        return
      }

      // Not saved: the batch goes back UNDER anything typed since.
      pending = { ...batch, ...pending }
      journal()
      if (result.error === 'conflict') return setState('conflict')
      if (result.error === 'failed' || result.error === 'network') {
        setState('offline')
        const delay = delays[Math.min(attempt, delays.length - 1)]
        attempt++
        if (retryTimer) clearTimeout(retryTimer)
        retryTimer = setTimeout(() => {
          retryTimer = null
          void run()
        }, delay)
        return
      }
      setState('error')
    })()
    return inFlight
  }

  return {
    set(patch) {
      if (disposed || !patch || !has(patch)) return
      pending = { ...pending, ...patch }
      if (rejected.length && rejected.some((p) => p in patch)) setRejected(rejected.filter((p) => !(p in patch)))
      journal()
      if (stopped()) return
      if (state !== 'offline') setState('saving')
      schedule(debounceMs)
    },
    async flush() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      // At most a few rounds: in flight → its follow-up → done.
      for (let i = 0; i < 5; i++) {
        if (stopped()) return false
        if (inFlight) {
          await inFlight
          continue
        }
        if (!has(pending)) return state !== 'offline' || attempt === 0
        await run()
        if (state === 'offline') return false
      }
      return !has(pending) && !inFlight
    },
    async replay() {
      if (!storage) return null
      let saved: PendingSet | null = null
      try {
        saved = await storage.load(key)
      } catch {
        saved = null
      }
      if (!saved || !has(saved)) return null
      pending = { ...saved, ...pending }
      if (!stopped()) {
        setState('saving')
        schedule(0)
      }
      return saved
    },
    retryNow() {
      if (stopped() || inFlight || !has(pending)) return
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      attempt = 0
      void run()
    },
    async discard() {
      clearTimers()
      pending = {}
      suspects = []
      const id = key
      if (storage) await enqueue(() => storage.clear(id))
    },
    setRev(next) {
      if (typeof next === 'string' && next) rev = next
    },
    async rekey(nextKey) {
      if (!nextKey || nextKey === key) return
      const from = key
      key = nextKey
      if (!storage) return
      await enqueue(async () => {
        if (storage.rekey) return storage.rekey(from, nextKey)
        const [moved, existing] = await Promise.all([storage.load(from), storage.load(nextKey)])
        if (moved && has(moved)) await storage.save(nextKey, { ...(existing ?? {}), ...moved })
        await storage.clear(from)
      })
      // And whatever is unconfirmed right now, under the new key.
      journal()
      await storageChain
    },
    get key() {
      return key
    },
    get rejected() {
      return [...rejected]
    },
    get state() {
      return state
    },
    get rev() {
      return rev
    },
    get pending() {
      return { ...inFlightSet, ...pending }
    },
    dispose() {
      disposed = true
      clearTimers()
    },
  }
}

/** Applies dotted patch paths (`title.en`, `categories`, `wizard.step`) to a plain object, immutably. */
export function applyPatch<T extends Record<string, unknown>>(target: T, set: PendingSet): T {
  const out: Record<string, unknown> = { ...target }
  for (const [path, value] of Object.entries(set)) {
    const [head, ...rest] = path.split('.')
    if (!rest.length) {
      out[head] = value
      continue
    }
    const child = out[head] && typeof out[head] === 'object' && !Array.isArray(out[head]) ? (out[head] as Record<string, unknown>) : {}
    out[head] = applyPatch(child, { [rest.join('.')]: value })
  }
  return out as T
}
