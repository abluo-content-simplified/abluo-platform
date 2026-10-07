/**
 * Offline journal for the autosave engine (ADR-025 D2).
 *
 * A buffer, not a store: it holds the patch paths the server has NOT yet
 * confirmed, keyed by draft id, so a closed tab, a phone call or lost signal
 * never loses typing. Every method swallows its own errors — when IndexedDB is
 * missing, blocked (private mode) or full, the editor keeps working online.
 */

export type PendingSet = Record<string, unknown>

export interface JournalStorage {
  load(draftId: string): Promise<PendingSet | null>
  save(draftId: string, set: PendingSet): Promise<void>
  clear(draftId: string): Promise<void>
  /**
   * Moves the entry under `from` to `to` (merged over anything already under
   * `to`), then removes `from` — in one step where the storage allows it. Used
   * when a lazily created draft gets its real id.
   */
  rekey?(from: string, to: string): Promise<void>
}

/** In-memory journal — tests, and the fallback when IndexedDB is unavailable. */
export function createMemoryJournal(seed: Record<string, PendingSet> = {}): JournalStorage & { entries: Map<string, PendingSet> } {
  const entries = new Map<string, PendingSet>(Object.entries(seed))
  return {
    entries,
    async load(id) {
      const v = entries.get(id)
      return v ? { ...v } : null
    },
    async save(id, set) {
      entries.set(id, { ...set })
    },
    async clear(id) {
      entries.delete(id)
    },
    async rekey(from, to) {
      if (from === to) return
      const moved = entries.get(from)
      if (moved) entries.set(to, { ...(entries.get(to) ?? {}), ...moved })
      entries.delete(from)
    },
  }
}

const DB_NAME = 'abluo-autosave'
const STORE = 'journal'

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        try {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
        } catch {
          /* ignore */
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/** IndexedDB journal. Never throws; degrades to "nothing stored". */
export function createIdbJournal(): JournalStorage {
  let dbPromise: Promise<IDBDatabase | null> | null = null
  const db = () => (dbPromise ??= openDb())

  async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest | null, fallback: T): Promise<T> {
    try {
      const d = await db()
      if (!d) return fallback
      return await new Promise<T>((resolve) => {
        try {
          const tx = d.transaction(STORE, mode)
          const req = op(tx.objectStore(STORE))
          tx.oncomplete = () => resolve((req?.result as T) ?? fallback)
          tx.onerror = () => resolve(fallback)
          tx.onabort = () => resolve(fallback)
        } catch {
          resolve(fallback)
        }
      })
    } catch {
      return fallback
    }
  }

  return {
    async load(id) {
      const v = await run<unknown>('readonly', (s) => s.get(id), null)
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as PendingSet) : null
    },
    async save(id, set) {
      await run('readwrite', (s) => s.put(set, id), undefined)
    },
    async clear(id) {
      await run('readwrite', (s) => s.delete(id), undefined)
    },
    async rekey(from, to) {
      if (from === to) return
      // One readwrite transaction: read both, write the merge, delete the old key — all or nothing.
      await run(
        'readwrite',
        (s) => {
          const get = s.get(from)
          get.onsuccess = () => {
            const moved = get.result
            if (!moved || typeof moved !== 'object' || Array.isArray(moved)) return
            const prev = s.get(to)
            prev.onsuccess = () => {
              const base = prev.result && typeof prev.result === 'object' && !Array.isArray(prev.result) ? prev.result : {}
              s.put({ ...base, ...moved }, to)
              s.delete(from)
            }
          }
          return null
        },
        undefined
      )
    },
  }
}
