/**
 * Autosave engine for the client content wizard (ADR-025 D1/D2). Pure — no
 * React, no DOM — so it is tested with fake timers and an in-memory journal.
 *
 * Rules:
 *   • `set()` merges patch paths into one pending map (later values win) and
 *     journals it at once, then debounces (500 ms by default).
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

/**
 * What one send answered. A refusal may still carry `rev`: the send opened the
 * draft (a published document's first change) and the save after it did not
 * go through — the draft now exists at that revision, and the retry (or the
 * next save) must be sent against it, never against the revision held before
 * the draft existed (Digital Cards, 2026-11-09: that stale revision was
 * refused as "edited elsewhere").
 */
export type SendResult = { ok: true; rev: string } | { ok: false; error: string; rev?: string }

/** What `exclusive()` runs: gets the confirmed revision, returns its value and the revision the editor must continue from ('' = no draft any more). */
export type ExclusiveOp<T> = (rev: string) => Promise<{ value: T; rev?: string }>

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
   * Adopt the revision of a snapshot READ from the server — only when nothing
   * was saved since the read started (`since` = `confirmed` before the read)
   * and nothing is waiting or in flight. Otherwise the read is older than what
   * this editor already wrote: adopting it would roll the revision back and the
   * next save would be refused as "edited elsewhere", and applying its values
   * would wipe what the person just typed. Returns true when the snapshot is
   * current (the caller may show its values), false when it must be ignored.
   */
  adoptRead(rev: string, since: number): boolean
  /**
   * Publish / discard / lifecycle / reload: sends everything first, then runs
   * `op` with the confirmed revision while NO autosave is sent. Edits made
   * meanwhile are kept (journaled) and go out after `op`, against the revision
   * `op` returns — '' when the draft is gone (published, discarded): the next
   * change then opens a fresh draft. Resolves `{ ok: false }` (op not run)
   * when the flush could not save everything (offline, conflict).
   */
  exclusive<T>(op: ExclusiveOp<T>): Promise<{ ok: true; value: T } | { ok: false }>
  /** Saves the server has confirmed so far (a counter; see adoptRead). */
  readonly confirmed: number
  /** Something is waiting to be sent or in flight. */
  readonly busy: boolean
  /** An exclusive operation is running. */
  readonly held: boolean
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

/**
 * Pause after the last keystroke before saving. 800 → 500 ms (performance work
 * 2026-10-16, optimisation E) once a save itself took ~0.35 s on the server:
 * "Saved" now follows typing by about one second. One request stays in flight
 * at a time and edits made meanwhile are merged, so a shorter pause cannot
 * reorder or lose changes — it only sends slightly more requests while typing slowly.
 */
export const DEFAULT_DEBOUNCE_MS = 500
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
  let confirmed = 0
  let state: SaveState = 'idle'
  let disposed = false
  /** An exclusive operation is running: nothing is sent until it ends. */
  let held = false

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
    if (stopped() || held) return
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
      // The send opened the draft, then its save failed: continue from the draft's revision.
      if (!result.ok && typeof result.rev === 'string' && result.rev) rev = result.rev

      if (result.ok) {
        attempt = 0
        confirmed++
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

  /** Sends everything now. Resolves true when the server has confirmed all of it (false while an exclusive operation holds sends). */
  async function flush(): Promise<boolean> {
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
      if (held) return false
      await run()
      if (state === 'offline') return false
    }
    return !has(pending) && !inFlight
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
    flush,
    async exclusive<T>(op: ExclusiveOp<T>) {
      if (disposed || held) return { ok: false } as const
      if (!(await flush())) return { ok: false } as const
      held = true
      try {
        const out = await op(rev)
        if (typeof out?.rev === 'string') rev = out.rev
        return { ok: true, value: out.value } as const
      } finally {
        held = false
        if (has(pending) && !stopped()) schedule(0)
      }
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
    adoptRead(next, since) {
      if (disposed || held || inFlight || has(pending) || confirmed !== since) return false
      // '' = the snapshot has no draft (published / discarded): the next change opens one.
      if (typeof next === 'string') rev = next
      return true
    },
    get confirmed() {
      return confirmed
    },
    get busy() {
      return Boolean(inFlight) || has(pending)
    },
    get held() {
      return held
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
